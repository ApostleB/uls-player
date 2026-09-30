/**
 * ffmpeg·ffprobe 실행 파일의 경로.
 *
 * 기본값은 이름뿐이라 PATH에서 찾는다 — 서버 배포는 지금까지처럼
 * 시스템에 설치된 ffmpeg를 쓴다. Electron 패키지는 동봉한 바이너리의
 * 절대경로를 FFMPEG_PATH/FFPROBE_PATH로 넘긴다.
 *
 * AppConfig에 넣지 않은 이유: probe()·convert()·generatePeaks()가 모두
 * cfg를 받지 않는다. config로 넘기려면 세 시그니처와 모든 호출부·테스트가
 * 함께 바뀌는데, 얻는 것 없이 변경 면적만 넓어진다. 모듈 상수는
 * config.ts의 `export const config = loadConfig(process.env)`와 같은
 * 패턴이라 이 저장소에 이미 있는 방식이다.
 */
function fromEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  // 빈 문자열을 "지정함"으로 받으면 spawn이 ENOENT로 죽는다.
  // config.ts의 num()이 쓰는 규약과 같게 맞춘다.
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export const FFMPEG = fromEnv('FFMPEG_PATH', 'ffmpeg');
export const FFPROBE = fromEnv('FFPROBE_PATH', 'ffprobe');
