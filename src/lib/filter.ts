import type { Filter, Recording, SearchScope, TagMode } from './types';
import { recordingExtensions } from './extensions';

export const EMPTY_FILTER: Filter = {
  q: '', scope: 'all', tags: [], tagMode: 'and', ext: [], from: '', to: ''
};
Object.freeze(EMPTY_FILTER.tags);
Object.freeze(EMPTY_FILTER.ext);
Object.freeze(EMPTY_FILTER);

const SCOPES: readonly SearchScope[] = ['all', 'title', 'description', 'tags'];

/** recordedAt의 날짜 부분만 뽑는다. 오프셋이 붙어 있으므로 앞 10글자가 로컬 날짜다. */
function localDate(recordedAt: string): string {
  return recordedAt.slice(0, 10);
}

/** q는 이미 trim + 소문자로 정규화된 상태로 들어온다. */
function matchesQuery(r: Recording, q: string, scope: SearchScope): boolean {
  const hit = (s: string) => s.toLowerCase().includes(q);
  switch (scope) {
    case 'title':
      return hit(r.title);
    case 'description':
      return hit(r.description);
    // 칩 필터의 정확 일치와 달리 개별 태그에 부분 일치한다 —
    // 기억나는 조각으로 찾는 것이 검색의 목적이다.
    case 'tags':
      return r.tags.some(hit);
    case 'all':
      return hit(r.title) || hit(r.description) || r.tags.some(hit);
  }
}

export function applyFilter(recs: Recording[], f: Filter): Recording[] {
  const q = f.q.trim().toLowerCase();
  const tags = f.tags.filter(Boolean);
  const exts = f.ext.filter(Boolean);

  return recs.filter((r) => {
    if (q && !matchesQuery(r, q, f.scope)) return false;

    if (tags.length) {
      const has = (t: string) => r.tags.includes(t);
      if (f.tagMode === 'and' ? !tags.every(has) : !tags.some(has)) return false;
    }

    if (exts.length) {
      const owned = recordingExtensions(r);
      if (!exts.every((e) => owned.includes(e))) return false;
    }

    const d = localDate(r.recordedAt);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;

    return true;
  });
}

export function filterFromParams(params: URLSearchParams): Filter {
  const mode = params.get('mode');
  const scope = params.get('scope');
  const trimmed = (name: string) =>
    params.getAll(name).map((s) => s.trim()).filter(Boolean);

  return {
    q: params.get('q') ?? '',
    scope: (SCOPES.includes(scope as SearchScope) ? scope : 'all') as SearchScope,
    tags: trimmed('tags'),
    tagMode: (mode === 'or' ? 'or' : 'and') as TagMode,
    ext: trimmed('ext'),
    from: params.get('from') ?? '',
    to: params.get('to') ?? ''
  };
}

export function filterToParams(f: Filter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  // 기본값은 싣지 않는다 — q=만 있는 기존 링크가 그대로 동작해야 한다.
  if (f.scope !== 'all') p.set('scope', f.scope);
  // Append each tag as a separate parameter; commas are tag content, never separators.
  for (const tag of f.tags) {
    p.append('tags', tag);
  }
  if (f.tagMode === 'or') p.set('mode', 'or');
  for (const ext of f.ext) {
    p.append('ext', ext);
  }
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  return p;
}
