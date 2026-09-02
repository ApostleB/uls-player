import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { loadPeaks } from '$lib/server/store/waveforms';

// 녹음 id는 store가 randomUUID()로 발급한다. params.id는 SvelteKit이 라우팅
// 이후 decodeURIComponent를 거쳐 넘겨주므로 '%2f' 같은 인코딩된 구분자도
// 실제 '/'로 살아남는다 — UUID 형태가 아닌 id는 경로 조작 시도일 수 있으니
// 파일시스템에 닿기 전에 걷어낸다. 존재하지 않는 id와 구분되지 않도록
// 400이 아니라 404로 응답한다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params }) => {
  if (!UUID_RE.test(params.id)) throw error(404, '파형이 아직 없습니다');

  const peaks = await loadPeaks(config, params.id);
  if (!peaks) throw error(404, '파형이 아직 없습니다');

  // 재시도(POST /api/jobs/retry)가 같은 id로 peaks를 다시 만들 수 있으므로
  // immutable로 1년을 박아두면 재시도 이전 파형이 브라우저에 영구히
  // 고착된다. 짧은 max-age + must-revalidate로 바꿔 만료 후에는 반드시
  // 서버에 다시 물어보게 한다.
  return json(peaks, { headers: { 'cache-control': 'public, max-age=60, must-revalidate' } });
};
