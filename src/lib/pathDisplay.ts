/**
 * 긴 경로를 가운데에서 줄인다. 끝만 남기면 어느 저장소에 있는지 모르고,
 * 앞만 남기면 어느 파일인지 모른다 — 경로를 보여주는 이유가 둘 다이므로
 * 양끝을 남긴다. 파일명이 저장소 위치보다 급하다고 보고, 자리가 아주
 * 부족하면 뒤쪽을 우선한다.
 */
export function middleEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(-max);

  const tail = Math.ceil((max - 1) / 2);
  const head = max - 1 - tail;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}
