#!/usr/bin/env node
/**
 * 패키징 검증: build/ 산출물의 모든 "bare import"(상대경로도 node: 접두사도
 * 아닌, 즉 npm 패키지를 가리키는 import/require)가 Windows 패키지의
 * resources/ 배치만으로 해석되는지 확인한다.
 *
 * 왜 필요한가 — Task 5 리뷰에서 나온 archiver 결함의 재발 방지:
 * SvelteKit adapter-node는 라우트마다 서버 청크를 나누고, 그 청크는 해당
 * 라우트가 실제로 요청될 때만 로드된다(/api/download가 그 예). 그래서
 * "서버가 기동하는가"만 확인해서는 그런 지연 로드 청크 안에서만 쓰이는
 * 외부 패키지가 빠진 것을 알아채지 못한다 — 실제로 archiver가 그렇게 빠진
 * 채로 기동 확인만 통과했었다(앱은 뜨지만 일괄 내려받기를 누르는 순간
 * /api/download가 500으로 죽었다).
 *
 * 이 스크립트는 서버를 띄우는 대신 build/ 트리 전체의 정적 import/require
 * 선언을 정적으로 훑는다. 그렇게 찾은 외부 패키지 이름 중, Node 내장
 * 모듈도 아니고 BUNDLED_EXCEPTIONS(=resources/node_modules에 실제로
 * 동봉하는 패키지)에도 없는 것이 하나라도 있으면 빌드를 실패시킨다.
 * archiver처럼 "동봉하지 않고 번들에 인라인하는" 패키지는 vite.config.ts의
 * ssr.noExternal에 들어가 rollup이 build/ 안으로 직접 풀어 넣으므로, 이
 * 스크립트에서는 애초에 bare import로 보이지 않아야 정상이다.
 */
import { builtinModules } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const BUILD_DIR = path.resolve('build');

// electron-builder.yml의 extraResources로 resources/node_modules 아래에
// 실제로 동봉하는 패키지 목록. 여기 없는 외부 패키지는 반드시 번들에
// 인라인되어 있어야 한다 — 하나라도 늘리려면 electron-builder.yml의
// extraResources도 함께 고쳐야 한다.
const BUNDLED_EXCEPTIONS = new Set(['better-sqlite3']);

const CORE_MODULES = new Set(builtinModules);

function collectJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectJsFiles(full, out);
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// 코멘트 줄을 먼저 걷어낸다. 이유: 번들 안에는 라이브러리 원본의 JSDoc
// 타입 주석이 그대로 살아남아 있고(`/** @param {import('svelte').X} */`류),
// 그 안의 `import('패키지')`는 타입 참조일 뿐 런타임 import가 아니다 — 실측
// 확인: 이 필터 없이 돌리면 svelte, @sveltejs/kit, $app 같은 것들이 전부
// "해석 안 되는 외부 모듈"로 잘못 잡힌다. 이 프로젝트가 기계 생성한
// 번들에서는 JSDoc 블록이 항상 그 줄 맨 앞이 `*`, `/*`, `//`로 시작하므로
// (실제 코드 줄은 그렇게 시작하지 않는다) 그 줄들만 통째로 버린다.
function stripCommentLines(src) {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'));
    })
    .join('\n');
}

// `import 'x'`, `import y from 'x'`, `import { a, b } from 'x'`,
// `export { a } from 'x'`, `require('x')`, `import('x')` 형태를 잡는다.
// 줄 단위로 매칭해 import~from 사이를 `.`(개행 불포함)로 제한함으로써,
// 코멘트를 걷어낸 뒤에도 한 문(statement)을 넘어서는 오탐 매칭을 막는다.
const LINE_IMPORT_RE =
  /^\s*(?:import|export)\s+(?:[^'"\n]*?\sfrom\s+)?["']([^"']+)["']\s*;?\s*$|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/;

// 진짜 npm 패키지명 형태인지 확인한다. SvelteKit 런타임 헬퍼 중에는
// `` `import('${import_path}')` ``처럼 "import(...)로 보이는 JS 소스 문자열
// 자체를 만들어내는" 코드가 있다(클라이언트 하이드레이션 코드 생성용) —
// 실제 모듈 지정자가 아니라 템플릿 리터럴의 텍스트일 뿐인데, 위의 줄 단위
// 정규식은 따옴표 문자만 보므로 `${import_path}` 같은 걸 그대로 붙잡는다.
// 실제 npm 패키지명은 `$`, `{`, `}`, 백틱을 쓸 수 없으므로, 이 형태를
// 벗어나면 폐기한다.
const VALID_PKG_NAME_RE = /^(@[a-zA-Z0-9][\w.-]*\/)?[a-zA-Z0-9][\w.-]*$/;

function bareSpecifiers(files) {
  const found = new Set();
  for (const file of files) {
    const src = stripCommentLines(readFileSync(file, 'utf8'));
    for (const line of src.split('\n')) {
      const m = LINE_IMPORT_RE.exec(line);
      if (!m) continue;
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
      // 스코프 패키지(@scope/name)는 두 세그먼트까지, 아니면 첫 세그먼트만
      // 패키지명으로 본다 — 'archiver/lib/foo' 같은 서브패스도 패키지
      // 단위로 판정하기 위해서다.
      const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!VALID_PKG_NAME_RE.test(pkgName)) continue;
      found.add(pkgName);
    }
  }
  return found;
}

if (!statSync(BUILD_DIR, { throwIfNoEntry: false })) {
  console.error(`[check-packaged-imports] ${BUILD_DIR}가 없습니다 — 먼저 npm run build를 돌리세요.`);
  process.exit(1);
}

const files = collectJsFiles(BUILD_DIR);
const bare = bareSpecifiers(files);
const unresolved = [...bare].filter((name) => !CORE_MODULES.has(name) && !BUNDLED_EXCEPTIONS.has(name));

if (unresolved.length > 0) {
  console.error(
    `[check-packaged-imports] 실패 — build/가 패키징 후 resources/ 배치만으로는 해석되지 않는 ` +
      `외부 모듈을 참조합니다: ${unresolved.join(', ')}\n` +
      `  - vite.config.ts의 ssr.noExternal에 추가해 번들에 인라인하거나,\n` +
      `  - electron-builder.yml의 extraResources로 resources/node_modules에 동봉하고\n` +
      `    이 스크립트의 BUNDLED_EXCEPTIONS에도 추가하세요.`
  );
  process.exit(1);
}

const bundled = [...bare].filter((name) => BUNDLED_EXCEPTIONS.has(name));
console.log(
  `[check-packaged-imports] OK — 남은 외부 모듈은 ${bundled.length > 0 ? bundled.join(', ') : '(없음)'}뿐이고 ` +
    `(resources/node_modules로 동봉), 그 외는 Node 내장 모듈이거나 번들에 인라인됐습니다.`
);
