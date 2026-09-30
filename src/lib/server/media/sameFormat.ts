import type { ProbeResult } from './probe';

type Source = Pick<ProbeResult, 'formatName' | 'codecName'> & {
  /**
   * mp3가 가변 비트레이트인가(mp3Header.ts의 isVbrMp3). mp3가 아닌
   * 원본에는 의미가 없지만, 파일 IO 없이 순수하게 판정하는 이 함수가
   * 항상 호출자에게 파일을 열어 보라고 요구하지 않도록 필수 필드로 둔다 —
   * 호출자(runner.ts)가 mp3일 때만 실제로 계산해서 넘긴다.
   */
  vbr: boolean;
};

/**
 * 출력 포맷별 "원본이 이미 이 포맷이다"의 조건.
 *
 * 컨테이너와 코덱을 **둘 다** 본다. 하나만 보면 틀린다:
 * - 확장자(=컨테이너 추정)만 보면, 이름만 .mp3인 AAC가 "mp3"로 복사돼
 *   재생되지 않는 파일이 생긴다.
 * - 코덱만 보면, AIFF(pcm_s16be)가 .wav 이름으로 복사돼 실제로는
 *   AIFF인 "wav"가 생긴다.
 *
 * mp3는 그 둘이 맞아도 VBR이면 복사하지 않는다 — 복사한 VBR mp3는
 * 재생기 탐색이 부정확해진다(10분 파일 기준 Electron 최대 1.3초, Firefox
 * 최대 22초 어긋남, 실측). CBR mp3만 복사 대상이다. wav는 PCM이라 이
 * 문제가 없으므로 vbr을 보지 않는다.
 *
 * 여기 없는 포맷은 항상 변환한다 — 모르는 것을 복사해서 잘못된 파일을
 * 만드는 것보다, 한 번 더 인코딩하는 편이 안전하다.
 */
const RULES: Record<string, (s: Source) => boolean> = {
  mp3: (s) => s.formatName === 'mp3' && s.codecName === 'mp3' && !s.vbr,
  wav: (s) => s.formatName === 'wav' && s.codecName.startsWith('pcm_')
};

export function isSameFormat(outputFormat: string, source: Source): boolean {
  const rule = RULES[outputFormat];
  return rule ? rule(source) : false;
}
