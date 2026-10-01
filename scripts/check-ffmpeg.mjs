/**
 * Windows 패키징 전에 동봉할 ffmpeg가 제자리에 있는지 확인한다.
 * 사용: node scripts/check-ffmpeg.mjs x64 arm64
 *
 * 왜 필요한가: electron-builder는 extraResources의 원본 폴더가 없으면
 * "file source doesn't exist" 경고 한 줄만 남기고 성공(exit 0)으로 끝난다
 * (실측). 그러면 ffmpeg가 0개 든 exe가 나오고, 앱은 정상으로 켜지지만
 * 가져온 녹음의 변환이 전부 실패한다. ffmpeg 폴더는 182MB라 저장소에 올리지
 * 않으므로, 새로 클론한 곳에서 빌드하면 이 일이 그대로 일어난다.
 *
 * 공유(shared) 빌드는 ffmpeg.exe가 수백 KB짜리 껍데기이고 실제 코드는 DLL에
 * 있다 — exe만 옮기고 DLL을 빠뜨리면 Windows에서 실행 자체가 안 된다.
 * 그래서 exe가 작으면 DLL도 요구한다.
 */
import fs from 'node:fs';
import path from 'node:path';

const RELEASE = 'autobuild-2026-09-28-13-06';
const BUILD = 'ffmpeg-n9.0.2-14-gebafaee10a';
const ASSET = { x64: 'win64', arm64: 'winarm64' };
// 정적 빌드의 ffmpeg.exe는 수십 MB다. 이보다 작으면 공유 빌드로 본다.
const STATIC_MIN_BYTES = 20 * 1024 * 1024;
const REQUIRED_DLLS = ['avcodec', 'avformat', 'avutil', 'swresample'];

const archs = process.argv.slice(2);
if (archs.length === 0 || archs.some((a) => !(a in ASSET))) {
  console.error(`사용법: node scripts/check-ffmpeg.mjs <${Object.keys(ASSET).join('|')}> ...`);
  process.exit(2);
}

/** Windows 실행 파일(PE)은 'MZ'로 시작한다. 이름만 같은 다른 파일을 걸러낸다. */
function isWindowsExecutable(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    return head.toString('latin1') === 'MZ';
  } finally {
    fs.closeSync(fd);
  }
}

const problems = [];
for (const arch of archs) {
  const dir = path.join('ffmpeg', `win-${arch}`);
  const zip = `${BUILD}-${ASSET[arch]}-gpl-shared-9.0.zip`;
  const howTo =
    `  받을 곳: https://github.com/BtbN/FFmpeg-Builds/releases/download/${RELEASE}/${zip}\n` +
    `  zip 안 bin 폴더의 파일을 전부 ${dir}${path.sep} 에 넣는다 (ffplay.exe는 빼도 된다)`;

  const missing = ['ffmpeg.exe', 'ffprobe.exe'].filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) {
    problems.push(`[${arch}] ${dir}에 ${missing.join(', ')}이(가) 없습니다.\n${howTo}`);
    continue;
  }
  const notPe = ['ffmpeg.exe', 'ffprobe.exe'].filter((f) => !isWindowsExecutable(path.join(dir, f)));
  if (notPe.length) {
    problems.push(`[${arch}] ${notPe.join(', ')}이(가) Windows 실행 파일이 아닙니다.\n${howTo}`);
    continue;
  }
  if (fs.statSync(path.join(dir, 'ffmpeg.exe')).size < STATIC_MIN_BYTES) {
    const files = fs.readdirSync(dir);
    const lacking = REQUIRED_DLLS.filter((d) => !files.some((f) => f.startsWith(`${d}-`) && f.endsWith('.dll')));
    if (lacking.length) {
      problems.push(
        `[${arch}] 공유 빌드인데 DLL이 빠졌습니다: ${lacking.map((d) => `${d}-*.dll`).join(', ')}\n${howTo}`
      );
      continue;
    }
  }
  console.log(`[check-ffmpeg] OK — ${dir}`);
}

if (problems.length) {
  console.error(`[check-ffmpeg] 동봉할 ffmpeg가 준비되지 않았습니다.\n\n${problems.join('\n\n')}`);
  process.exit(1);
}
