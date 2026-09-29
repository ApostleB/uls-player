/**
 * 루트 package.json에 "type": "module"이 있어서, 그대로 두면 Node가
 * dist-electron 아래의 .js를 ESM으로 읽는다. tsc가 낸 것은 CommonJS다.
 *
 * "가장 가까운 package.json이 이긴다"는 Node의 규칙을 이용해 이 디렉터리
 * 하나만 CommonJS로 되돌린다. 샌드박스 preload가 ESM을 지원하지 않으므로
 * CommonJS 출력은 선택이 아니라 요구사항이다.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist-electron');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);
console.log('dist-electron/package.json 작성: {"type":"commonjs"}');
