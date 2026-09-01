import type { Filter, Recording, TagMode } from './types';

export const EMPTY_FILTER: Filter = { q: '', tags: [], tagMode: 'and', from: '', to: '' };

/** recordedAt의 날짜 부분만 뽑는다. 오프셋이 붙어 있으므로 앞 10글자가 로컬 날짜다. */
function localDate(recordedAt: string): string {
  return recordedAt.slice(0, 10);
}

export function applyFilter(recs: Recording[], f: Filter): Recording[] {
  const q = f.q.trim().toLowerCase();
  const tags = f.tags.filter(Boolean);

  return recs.filter((r) => {
    if (q && !r.title.toLowerCase().includes(q)) return false;

    if (tags.length) {
      const has = (t: string) => r.tags.includes(t);
      if (f.tagMode === 'and' ? !tags.every(has) : !tags.some(has)) return false;
    }

    const d = localDate(r.recordedAt);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;

    return true;
  });
}

export function filterFromParams(params: URLSearchParams): Filter {
  const mode = params.get('mode');
  return {
    q: params.get('q') ?? '',
    tags: (params.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    tagMode: (mode === 'or' ? 'or' : 'and') as TagMode,
    from: params.get('from') ?? '',
    to: params.get('to') ?? ''
  };
}

export function filterToParams(f: Filter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.tags.length) p.set('tags', f.tags.join(','));
  if (f.tagMode === 'or') p.set('mode', 'or');
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  return p;
}
