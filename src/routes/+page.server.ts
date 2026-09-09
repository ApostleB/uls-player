import type { PageServerLoad } from './$types';
import type { Recording } from '$lib/types';
import { config } from '$lib/server/config';
import { listAll, compareByRecordedAtDesc } from '$lib/server/store/recordings';

/** 카드 하나에 보여줄 개수. */
const CARD_SIZE = 5;

/**
 * 시각 문자열(favoritedAt/createdAt) 내림차순 비교자. 값이 없거나 파싱할 수
 * 없으면 맨 뒤로 보낸다.
 *
 * 문자열 비교(localeCompare)를 쓰면 안 된다. 이 저장소의 nowIso()는 UTC가
 * 아니라 서버의 로컬 오프셋으로 시각을 찍는다(예: `2026-09-02T20:18:02+09:00`).
 * 서버를 다른 시간대로 옮기면 그 뒤에 찍힌 값은 오프셋이 달라지고, 오프셋이
 * 섞인 문자열은 사전순과 시간순이 어긋난다 — `...T01:00:00+00:00`(=10시 KST)이
 * `...T09:00:00+09:00`(=9시 KST)보다 사전순으로는 앞이지만 실제로는 나중이다.
 * 같은 이유로 store/recordings.ts의 compareByRecordedAtDesc도 문자열이 아니라
 * epoch ms로 비교한다.
 *
 * 동률(같은 초): nowIso()는 초 단위까지만 찍으므로, 즐겨찾기 별을 빠르게
 * 연달아 누르면(favoritedAt) 값이 완전히 같아질 수 있고, 한 배치 임포트로
 * 여러 녹음이 한 번에 들어오면(createdAt) 그 값은 사실상 항상 같아진다 —
 * `runner.ts`의 `buildJobs`가 for 루프 밖에서 `nowIso()`를 한 번만 불러
 * 배치 전체 레코딩에 같은 createdAt을 붙이기 때문이다.
 *
 * 이 비교자는 그 동률(또는 둘 다 파싱 불가한 경우)을 **명시적으로**
 * recordedAt 내림차순으로 가른다 — store/recordings.ts의
 * compareByRecordedAtDesc를 그대로 재사용한다(epoch ms 비교와 id 폴백까지
 * 이미 갖추고 있다). 예전에는 이 순서가 "Array.prototype.sort가 안정
 * 정렬이고, listAll이 이미 recordedAt 내림차순으로 정렬해 준 배열을
 * 넘긴다"는, 코드 어디에도 적히지 않은 두 가지 사실에 기대어 *우연히*
 * 성립했다 — listAll의 정렬 계약이 바뀌면 이 페이지는 그 변화를 알아채지
 * 못한 채 조용히 따라 바뀌었을 것이다. 지금은 이 폴백이 비교자 자신의
 * 규칙이므로, listAll이 어떤 순서로 배열을 넘기든(정렬돼 있지 않아도)
 * 결과는 항상 같다. 자세한 내용은 docs/known-issues.md 참고.
 */
function byTimeDesc(key: 'favoritedAt' | 'createdAt') {
  return (a: Recording, b: Recording) => {
    const ta = a[key] === null ? NaN : Date.parse(a[key] as string);
    const tb = b[key] === null ? NaN : Date.parse(b[key] as string);
    const aBad = Number.isNaN(ta);
    const bBad = Number.isNaN(tb);
    if (aBad && bBad) return compareByRecordedAtDesc(a, b);
    if (aBad) return 1;
    if (bBad) return -1;
    if (ta !== tb) return tb - ta;
    return compareByRecordedAtDesc(a, b);
  };
}

export const load: PageServerLoad = async () => {
  // listAll이 이미 deletedAt !== null을 걸러 준다.
  const all = await listAll(config);

  return {
    favorites: all
      .filter((r) => r.favoritedAt !== null)
      .sort(byTimeDesc('favoritedAt'))
      .slice(0, CARD_SIZE),
    // 이름과 달리 "createdAt 내림차순"만으로 정해지는 순서가 아니다: 배치
    // 임포트로 들어온 녹음은 전부 같은 createdAt을 갖고(위 byTimeDesc
    // 주석 참고), 실제로 이 저장소는 그 상태가 예외가 아니라 정상이다 —
    // 동률 폴백(recordedAt 내림차순)이 이 카드의 순서를 사실상 정하는
    // 경우가 흔하다. docs/known-issues.md 참고.
    recent: all.slice().sort(byTimeDesc('createdAt')).slice(0, CARD_SIZE)
  };
};
