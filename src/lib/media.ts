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
