import type { PageServerLoad } from './$types';
import type { Recording } from '$lib/types';
import { config } from '$lib/server/config';
import { listAll } from '$lib/server/store/recordings';

/** 카드 하나에 보여줄 개수. */
const CARD_SIZE = 5;

/**
 * 시각 문자열 내림차순 비교자. 값이 없거나 파싱할 수 없으면 맨 뒤로 보낸다.
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
 * 연달아 누르거나(favoritedAt) 한 배치 임포트로 여러 녹음이 한 번에 들어오면
 * (createdAt — buildJobs가 배치 전체에 같은 시각 하나를 찍는다, runner.ts)
 * 이 값이 완전히 같아질 수 있다. 이 함수는 동률에서 일부러 추가 비교자를
 * 두지 않는다 — 대신 두 가지 사실에 기댄다:
 *   1) Array.prototype.sort는 ES2019+ 명세상 안정 정렬이다.
 *   2) load()에 넘어오는 배열은 listAll이 이미 recordedAt 내림차순으로
 *      정렬해 돌려준 것이고, 아래에서는 filter/slice로만 통과시킨 뒤 이
 *      비교자로 다시 정렬한다.
 * 그래서 1차 키(favoritedAt/createdAt)가 같은 항목들은 안정 정렬 덕분에
 * listAll이 준 순서 — 즉 recordedAt 내림차순 — 를 그대로 유지한다.
 * "동률이면 더 최근에 녹음된 쪽이 앞"이라는 의미 있는 규칙이 코드 한 줄
 * 없이 성립하는 이유다. listAll의 정렬 계약이 바뀌면(예: 오름차순으로
 * 뒤집힌다면) 이 규칙도 조용히 달라지므로, page.server.test.ts의 동률
 * 테스트가 그 변화를 잡아내는 안전장치다.
 */
function byTimeDesc(key: 'favoritedAt' | 'createdAt') {
  return (a: Recording, b: Recording) => {
    const ta = a[key] === null ? NaN : Date.parse(a[key] as string);
    const tb = b[key] === null ? NaN : Date.parse(b[key] as string);
    const aBad = Number.isNaN(ta);
    const bBad = Number.isNaN(tb);
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;
    return tb - ta;
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
    recent: all.slice().sort(byTimeDesc('createdAt')).slice(0, CARD_SIZE)
  };
};
