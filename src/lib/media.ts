/**
 * 미디어 파일의 저장 경로 규칙. 이 규칙은 이 파일에만 존재해야 한다 —
 * 서버는 파일을 열 때, 화면은 경로를 보여줄 때 같은 함수를 부른다.
 * 규칙이 두 벌이면 언젠가 갈라지고, 그러면 화면이 존재하지 않는 경로를
 * 자신 있게 보여준다. "보여주는 경로가 실제로 여는 경로와 같다"가
 * 경로 표시 기능의 전부다.
 *
 * node:path를 쓰지 않는다 — 이 모듈은 브라우저에서도 불린다. mediaDir는
 * 서버의 config가 path.resolve로 만든 절대 경로라, 여기서 할 일은
 * 구분자로 잇는 것뿐이다.
 */

/**
 * 포맷 이름으로 실제 파일 확장자를 정한다. 변환본은 포맷 이름이 곧
 * 확장자지만(mp3 → .mp3), 원본은 무엇이 들어올지 몰라 files 항목에
 * 따로 적어둔다.
 */
export function mediaFileExt(format: string, entry: { ext?: string } | undefined): string {
  return format === 'original' ? (entry?.ext ?? 'bin') : format;
}

/** mediaDir/포맷/아이디.확장자. */
export function mediaFilePath(
  mediaDir: string,
  recordingId: string,
  format: string,
  ext: string
): string {
  const base = mediaDir.endsWith('/') ? mediaDir.slice(0, -1) : mediaDir;
  return `${base}/${format}/${recordingId}.${ext}`;
}

/**
 * 파일명 전체(제목+구분자+날짜+확장자)가 넘지 않을 바이트 수. 255바이트는
 * 흔한 파일 시스템 한도(ext4, APFS, NTFS)지만, 다운로드 시 브라우저나
 * OS가 " (1)" 같은 걸 덧붙이는 경우가 있어 240으로 15바이트 여유를 둔다.
 *
 * 글자수가 아니라 바이트로 재는 이유: 이 앱의 제목은 전부 한글이고,
 * UTF-8에서 한글 한 글자는 3바이트다. 글자수 기준 상한은 실제 파일
 * 시스템이 강제하는 바이트 상한과 다른 단위라 의미가 없다.
 */
const MAX_FILENAME_BYTES = 240;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * UTF-8 바이트 기준으로 문자열을 자르되, 멀티바이트 글자를 반으로
 * 쪼개지 않는다. 자른 바이트 열이 유효한 UTF-8이 될 때까지 끝에서부터
 * 한 바이트씩 물러난다 — 글자 하나는 최대 4바이트라 몇 번 안에 끝난다.
 */
function truncateToUtf8Bytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;

  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let end = maxBytes; end >= 0; end--) {
    try {
      return decoder.decode(bytes.slice(0, end));
    } catch {
      // 멀티바이트 글자 중간에서 잘렸다 — 한 바이트 더 물러난다.
    }
  }
  return '';
}

/**
 * 다운로드 파일명을 만든다 — `제목_녹음일자.확장자`.
 *
 * 제목은 사용자가 자유롭게 적는 값이라 그대로 파일명에 넣을 수 없다.
 * 경로 구분자와 OS가 거부하는 글자를 하이픈으로 바꾸고, 숨김 파일이
 * 되거나(앞 마침표) 일부 OS가 잘라내는(뒤 마침표) 형태를 피한다.
 *
 * recordedAt은 UTC 오프셋이 붙은 문자열이라 앞 10글자가 이미 로컬
 * 날짜다 — Date로 다시 파싱하면 오프셋만큼 어긋날 수 있어 문자열을
 * 그대로 자른다.
 */
export function downloadFileName(title: string, recordedAt: string, ext: string): string {
  const date = recordedAt.slice(0, 10);

  const sanitized = title
    // 제어문자와 파일명에 못 쓰는 글자. Windows가 거부하는 집합이 가장
    // 넓어서 그것을 기준으로 잡는다.
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');

  // 제목이 쓸 수 있는 바이트는 전체 한도에서 `_날짜.확장자` 몫을 뺀
  // 나머지다 — 확장자 길이가 qta/m4a/mp3/wav로 다르니 고정폭으로 잡지
  // 않는다.
  const fixedSuffix = `_${date}.${ext}`;
  const titleByteBudget = Math.max(0, MAX_FILENAME_BYTES - byteLength(fixedSuffix));

  // 바이트로 잘라내면 잘린 지점에 원래 제목 중간에 있던 마침표나
  // 공백이 새로 끝자리로 드러날 수 있다 — 앞뒤 마침표를 이미 뗀
  // 뒤에 자르기 때문이다. 자른 다음 한 번 더 떨어낸다.
  const safe = truncateToUtf8Bytes(sanitized, titleByteBudget).replace(/[.\s]+$/, '');

  return safe ? `${safe}_${date}.${ext}` : `${date}.${ext}`;
}
