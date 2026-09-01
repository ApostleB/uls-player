import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { PendingItem } from '$lib/server/jobs/runner';
import { config } from '$lib/server/config';
import { scanFolder } from '$lib/server/scan';
import { buildJobs, getQueue } from '$lib/server/jobs/runner';
import { allTags } from '$lib/server/store/recordings';

export const load: PageServerLoad = async () => ({
  tags: (await allTags(config)).map((t) => t.tag),
  formats: config.formats.map((f) => f.name)
});

export const actions: Actions = {
  scan: async ({ request }) => {
    const folder = String((await request.formData()).get('folder') ?? '').trim();
    if (!folder) return fail(400, { message: '폴더 경로를 입력하세요' });

    try {
      return { items: await scanFolder(config, folder) };
    } catch (err) {
      return fail(400, { message: `폴더를 읽을 수 없습니다: ${(err as Error).message}` });
    }
  },

  enqueue: async ({ request }) => {
    const raw = String((await request.formData()).get('payload') ?? '');
    let pending: PendingItem[];
    try {
      pending = JSON.parse(raw) as PendingItem[];
    } catch {
      return fail(400, { message: '보낼 항목을 읽을 수 없습니다' });
    }
    if (pending.length === 0) return fail(400, { message: '선택된 항목이 없습니다' });

    const { jobs } = buildJobs(config, pending);
    getQueue(config).enqueue(jobs);
    return { queued: jobs.length };
  }
};
