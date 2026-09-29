import path from 'node:path';

export interface ServerEnvOptions {
  /** 서버가 바인딩할 포트. ORIGIN도 이 포트를 가리킨다. */
  port: number;
  /** 앱 전용 데이터 폴더(Electron의 userData). data/·media/의 부모가 된다. */
  userDataDir: string;
  /** 동봉한 ffmpeg/ffprobe가 든 폴더. null이면 PATH에 맡긴다. */
  binariesDir: string | null;
  /** 기반이 되는 환경변수. 보통 process.env. */
  base: NodeJS.ProcessEnv;
  /** 실행 플랫폼. 인자로 받는 이유는 win32 분기를 macOS에서 테스트하기 위해서다. */
  platform: NodeJS.Platform;
}

/** adapter-node의 요청 본문 한도. 기본값 512KB면 업로드가 첫 파일부터 막힌다. */
const BODY_SIZE_LIMIT = String(4 * 1024 ** 3);

/** 빈 문자열은 "지정하지 않음"으로 본다 — config.ts의 num()과 같은 규약. */
function unset(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

/**
 * 서버 자식 프로세스에게 넘길 환경변수를 만든다.
 *
 * 규칙이 두 갈래다.
 *
 * - HOST/PORT/ORIGIN/ELECTRON_RUN_AS_NODE는 **셸이 이긴다.** 포트는 실행마다
 *   달라지고, ORIGIN이 실제 바인딩 주소와 어긋나면 SvelteKit의 CSRF 검사가
 *   form POST를 전부 403으로 막는다(가져오기 저장, 일괄 내려받기).
 * - DATA_DIR/MEDIA_DIR/FFMPEG_PATH/FFPROBE_PATH는 **바깥이 이긴다.** 셸이
 *   넣는 것은 기본값일 뿐이고, 사용자가 라이브러리를 다른 드라이브로
 *   옮기고 싶을 때 환경변수만으로 되게 둔다.
 */
export function buildServerEnv(o: ServerEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...o.base,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '127.0.0.1',
    PORT: String(o.port),
    ORIGIN: `http://127.0.0.1:${o.port}`,
    BODY_SIZE_LIMIT
  };

  if (unset(o.base.DATA_DIR)) env.DATA_DIR = path.join(o.userDataDir, 'data');
  if (unset(o.base.MEDIA_DIR)) env.MEDIA_DIR = path.join(o.userDataDir, 'media');

  if (o.binariesDir !== null) {
    const suffix = o.platform === 'win32' ? '.exe' : '';
    if (unset(o.base.FFMPEG_PATH)) {
      env.FFMPEG_PATH = path.join(o.binariesDir, `ffmpeg${suffix}`);
    }
    if (unset(o.base.FFPROBE_PATH)) {
      env.FFPROBE_PATH = path.join(o.binariesDir, `ffprobe${suffix}`);
    }
  }

  return env;
}
