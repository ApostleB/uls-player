import type { ProbeResult } from './probe';

type Source = Pick<ProbeResult, 'formatName' | 'codecName'>;

/**
 * 출력 포맷별 "원본이 이미 이 포맷이다"의 조건.
 *
 * 컨테이너와 코덱을 **둘 다** 본다. 하나만 보면 틀린다:
 * - 확장자(=컨테이너 추정)만 보면, 이름만 .mp3인 AAC가 "mp3"로 복사돼
 *   재생되지 않는 파일이 생긴다.
 * - 코덱만 보면, AIFF(pcm_s16be)가 .wav 이름으로 복사돼 실제로는
 *   AIFF인 "wav"가 생긴다.
 *
 * 여기 없는 포맷은 항상 변환한다 — 모르는 것을 복사해서 잘못된 파일을
 * 만드는 것보다, 한 번 더 인코딩하는 편이 안전하다.
 */
const RULES: Record<string, (s: Source) => boolean> = {
  mp3: (s) => s.formatName === 'mp3' && s.codecName === 'mp3',
  wav: (s) => s.formatName === 'wav' && s.codecName.startsWith('pcm_')
};

export function isSameFormat(outputFormat: string, source: Source): boolean {
  const rule = RULES[outputFormat];
  return rule ? rule(source) : false;
}
