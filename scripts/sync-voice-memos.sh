#!/usr/bin/env bash
#
# 음성 메모 원본을 작업용 폴더(.inbox)로 동기화한다.
#
# 원본은 샌드박스 앱 그룹 컨테이너라 macOS TCC가 보호한다. 이 스크립트를
# 실행하는 앱(터미널 또는 Claude)에 전체 디스크 접근 권한이 없으면
# "Operation not permitted"로 끝난다. 권한 외에 다른 우회 방법은 없다.
#
# 음성 메모 앱을 종료한 뒤 실행할 것 — 열려 있으면 CloudRecordings.db가
# 쓰기 중일 수 있고, 그 순간의 사본은 -wal과 어긋날 수 있다.
set -euo pipefail

SRC="${VOICE_MEMOS_SRC:-$HOME/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings}"
DEST="${VOICE_MEMOS_DEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.inbox}"

if [ ! -r "$SRC" ]; then
  echo "원본을 읽을 수 없다: $SRC" >&2
  echo >&2
  echo "시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근에서" >&2
  echo "이 스크립트를 실행하는 앱을 켠 다음, 그 앱을 완전히 종료했다 다시 열 것." >&2
  echo "(권한은 앱 재시작 후에 적용된다)" >&2
  exit 1
fi

mkdir -p "$DEST"

# --update: 대상이 더 새것이면 건너뛴다. 첫 실행만 전체를 가져오고
# 그 뒤로는 새로 녹음된 것만 온다.
# -a가 mtime을 보존하므로 그 비교가 정확하고, 녹음 시각도 사본에 남는다.
# -v는 실제로 옮긴 파일만 찍는다 — 두 번째 실행부터는 조용하다.
rsync -av --update \
  --include='*/' \
  --include='*.m4a' --include='*.qta' --include='*.wav' --include='*.caf' \
  --include='CloudRecordings.db' \
  --include='CloudRecordings.db-wal' \
  --include='CloudRecordings.db-shm' \
  --exclude='*' \
  "$SRC/" "$DEST/"

echo
echo "대상: $DEST"
echo "오디오 $(find "$DEST" -type f \( -name '*.m4a' -o -name '*.qta' -o -name '*.wav' -o -name '*.caf' \) | wc -l | tr -d ' ')개"
