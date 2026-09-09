/**
 * pm2 설정. `pm2 start ecosystem.config.cjs`로 띄운다.
 *
 * 확장자가 .cjs인 이유: package.json에 "type": "module"이 있어서 .js는
 * ES 모듈로 해석되는데, pm2는 설정 파일을 require로 읽는다.
 */
module.exports = {
  apps: [
    {
      name: 'uls-player',
      script: 'build/index.js',
      // 설정 파일이 있는 곳을 기준으로 잡는다 — 서버마다 경로가 달라도
      // 이 파일을 고칠 필요가 없다.
      cwd: __dirname,

      /**
       * adapter-node로 만든 서버는 .env 파일을 스스로 읽지 않는다.
       * SvelteKit의 .env 로딩은 개발·빌드 시점의 Vite 기능이고, 프로덕션
       * 프로세스는 실제 환경변수만 본다 — 그래서 Node의 --env-file로
       * 직접 읽힌다(Node 20.6+).
       *
       * .env에 반드시 들어가야 하는 것:
       *   DATA_DIR, MEDIA_DIR   저장 위치. 상대경로면 실행 위치에 따라
       *                         데이터가 딴 곳에 생긴다
       *   ORIGIN                실제 접속 주소. 빠뜨리면 SvelteKit의 CSRF
       *                         검사가 form POST를 전부 403으로 막는다 —
       *                         이 앱에서는 가져오기 저장과 일괄 내려받기다
       *   BODY_SIZE_LIMIT       adapter-node의 요청 본문 한도. 기본값이
       *                         512KB라 이걸 안 올리면 업로드가 첫 파일부터
       *                         막힌다. 앱의 MAX_UPLOAD_TOTAL_MB와 맞춘다
       */
      node_args: '--env-file=.env',

      // 앱 자체는 로컬만 듣고, 외부 노출은 앞단 nginx가 맡는다.
      env: { HOST: '127.0.0.1', PORT: '3000' },

      /**
       * 클러스터 모드를 쓰면 안 된다 — 반드시 단일 프로세스여야 한다.
       *
       * 이 앱은 변환 잡 큐를 프로세스 메모리에 들고 있고(hooks.server.ts가
       * 시작 시 한 번 미완료 잡을 복구한다), 저장소는 recordings.json 파일
       * 하나다. 인스턴스를 여러 개 띄우면 각자 자기 큐를 돌려 같은 파일을
       * 중복 변환하고, JSON을 통째로 다시 쓰다가 서로의 편집을 덮어쓴다.
       */
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      restart_delay: 5000,

      /**
       * max_memory_restart를 일부러 두지 않는다.
       *
       * 업로드 처리는 멀티파트 바디 전체를 메모리에 올린 뒤에야 반환한다 —
       * SvelteKit이 쓰는 undici의 request.formData() 제약이라 앱이 어쩔 수
       * 없다(src/routes/import/+page.server.ts의 upload 액션 주석 참고).
       * 즉 한 번에 4GB를 올리면 그만큼의 RAM이 필요하다.
       *
       * 여기에 메모리 한도를 걸면 pm2가 업로드 도중에 프로세스를 죽인다 —
       * 전송이 통째로 날아가고 사용자에게는 원인이 보이지 않는다. 한도를
       * 두려면 한 번에 올릴 배치 크기보다 확실히 크게 잡을 것.
       *
       * 실질적인 업로드 배치 상한은 설정값(MAX_UPLOAD_TOTAL_MB)이 아니라
       * 서버 RAM이다.
       */

      // pm2 자체 로그. 앱 로그는 stdout/stderr로 나간다.
      merge_logs: true,
      time: true
    }
  ]
};
