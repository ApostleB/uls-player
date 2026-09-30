#!/usr/bin/env bash
# 변환 처리량 측정. 앱의 파일당 파이프라인(mp3 인코딩 → wav 인코딩 → 파형
# 디코드)을 ffmpeg로 그대로 흉내 내, 동시 수와 인코더 레벨에 따른 시간을
# 잰다. 앱 자체가 아니라 흉내이므로 수치는 "이 설정에서 ffmpeg가 이만큼
# 걸린다"로 읽는다 — 설정을 바꿀 때 전후를 비교하는 용도다.
#
# 쓰는 법: scripts/bench-convert.sh <폴더> <동시 수> [mp3 레벨]
#   예) scripts/bench-convert.sh media/original 4
#       scripts/bench-convert.sh media/original 11 7
#
# macOS·Linux용이다. 폴더의 오디오 파일 앞 24개를 쓴다.
set -euo pipefail

DIR="${1:?폴더를 지정하세요}"
JOBS="${2:?동시 수를 지정하세요}"
LEVEL="${3:-}"
COUNT=24

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

find "$DIR" -maxdepth 1 -type f \( -name '*.qta' -o -name '*.m4a' -o -name '*.mp3' -o -name '*.wav' \) \
  | sort | head -n "$COUNT" > "$OUT/list"
N=$(wc -l < "$OUT/list" | tr -d ' ')
[ "$N" -gt 0 ] || { echo "오디오 파일이 없습니다: $DIR" >&2; exit 1; }

export OUT LEVEL
one() {
  f="$1"; o="$OUT/$(basename "$f")"
  # 앱의 기본 설정과 같은 값이다(src/lib/server/config.ts의 FORMAT_DEFAULTS).
  # 레벨 인자를 배열로 만들지 않는 이유: macOS 기본 bash(3.2)는 set -u
  # 상태에서 빈 배열을 펼치면 "unbound variable"로 죽는다.
  if [ -n "$LEVEL" ]; then
    ffmpeg -y -v error -i "$f" -map 0:a:0 -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 \
      -compression_level "$LEVEL" "$o.mp3"
  else
    ffmpeg -y -v error -i "$f" -map 0:a:0 -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 "$o.mp3"
  fi
  ffmpeg -y -v error -i "$f" -map 0:a:0 -c:a pcm_s16le -ar 44100 -ac 1 "$o.wav"
  ffmpeg -v error -i "$f" -map 0:a:0 -ac 1 -ar 8000 -f s16le - > /dev/null
}
export -f one

# 시각은 python3로 잰다. macOS의 date는 %N(나노초)을 모르면서도 종료 코드
# 0으로 "N"을 그대로 찍어, `date … || 대안` 식의 폴백이 걸리지 않는다.
now() { python3 -c 'import time; print(time.time())'; }

START=$(now)
xargs -P "$JOBS" -I{} bash -c 'one "$@"' _ {} < "$OUT/list"
END=$(now)

python3 -c "print('파일 $N개, 동시 $JOBS, 레벨 ${LEVEL:-기본}: %.1f초' % ($END - $START))"
