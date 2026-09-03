import type { PageServerLoad } from './$types';
import { config } from '$lib/server/config';
import { listAll, allTags } from '$lib/server/store/recordings';

export const load: PageServerLoad = async () => ({
  recordings: await listAll(config),
  tags: await allTags(config),
  formats: config.formats.map((f) => f.name)
});
