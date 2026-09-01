import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { loadPeaks } from '$lib/server/store/waveforms';

export const GET: RequestHandler = async ({ params }) => {
  const peaks = await loadPeaks(config, params.id);
  if (!peaks) throw error(404, '파형이 아직 없습니다');
  return json(peaks, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
};
