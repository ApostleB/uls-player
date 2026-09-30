# npm ci는 devDependencies까지 전부 설치한다. --omit=dev를 못 쓰는 이유:
# vite·@sveltejs/kit 등 빌드에 필요한 전부가 devDependencies에 있어서,
# --omit=dev로 걸러내면 바로 다음의 npm run build 자체가 실패한다.
#
# Electron Windows 패키징 브랜치가 늘린 devDependencies(electron·
# electron-builder, 리눅스 서버에는 쓸 일이 없다)가 그래서 이 서버에도
# 그대로 설치된다 — 락파일 차집합 실측: 264개 패키지 추가, 그중 241개는
# optionalDependencies 분기 없이 리눅스에서도 무조건 설치된다.
#
# 그래도 배포가 깨지지는 않는다: electron 44는 postinstall이 없다
# (node_modules/electron/package.json에 scripts 키 자체가 없음 — 실측
# 확인) — 즉 설치 후 Chromium 바이너리를 내려받는 단계가 아예 돌지
# 않는다. npm ci 시간과 디스크 사용량만 늘 뿐, 서버 동작에는 영향이 없다.
git pull && npm ci && npm run build && pm2 restart uls-player --update-env
