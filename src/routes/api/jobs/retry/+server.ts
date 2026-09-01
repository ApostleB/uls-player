import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { config } from '$lib/server/config';
import { getQueue } from '$lib/server/jobs/runner';

export const POST: RequestHandler = async () => {
  getQueue(config).retryFailed();
  return json({ ok: true });
};
