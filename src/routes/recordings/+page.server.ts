import type { PageServerLoad } from './$types';
import { config } from '$lib/server/config';
import { listAll, allTags } from '$lib/server/store/recordings';

export const load: PageServerLoad = async () => ({
  recordings: await listAll(config),
  tags: await allTags(config),
  formats: config.formats.map((f) => f.name),
  // 경로 문자열 하나만 내려보낸다. 녹음마다 포맷별 경로를 미리 만들어
  // 실으면, 252개 × 포맷 수만큼의 쓰지도 않을 문자열이 매 요청에
  // 따라온다 — 실제로 필요한 것은 지금 재생 중인 하나뿐이라, 화면이
  // 이 값과 mediaFilePath로 그때 만든다.
  mediaDir: config.mediaDir
});
