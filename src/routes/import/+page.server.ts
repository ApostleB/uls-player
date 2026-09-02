import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { PendingItem } from '$lib/server/jobs/runner';
import type { ScanItem } from '$lib/types';
import { config } from '$lib/server/config';
import { scanFolder } from '$lib/server/scan';
import { buildJobs, getQueue } from '$lib/server/jobs/runner';
import { allTags } from '$lib/server/store/recordings';
import { freeBytes, estimateBytes, DiskShortage } from '$lib/server/disk';

export const load: PageServerLoad = async () => ({
  tags: (await allTags(config)).map((t) => t.tag),
  formats: config.formats.map((f) => f.name)
});

/** 브라우저가 보내는 건 사용자가 편집한 필드뿐이다 — sourcePath 등 서버가
 * 신뢰해야 하는 값은 여기 없다. */
interface ClientItem {
  sourceName: string;
  title: string;
  description: string;
  tags: string[];
}

function isClientItem(v: unknown): v is ClientItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.sourceName === 'string' &&
    typeof o.title === 'string' &&
    typeof o.description === 'string' &&
    Array.isArray(o.tags) &&
    o.tags.every((t) => typeof t === 'string')
  );
}

export const actions: Actions = {
  // 이 프로젝트는 로컬 1인용 도구라 사용자가 입력한 아무 폴더나 그대로
  // 읽는 것 자체가 기능이다(외장 디스크·iCloud 동기화 폴더 등을 직접
  // 가리켜야 하므로 경로를 화이트리스트로 제한할 수 없다). 여러 사용자가
  // 쓰는 서버로 배포한다면 이 액션에 경로 화이트리스트나 인증을 반드시
  // 추가해야 한다 — scanFolder 자체는 읽기 전용이라 서버 파일을 실제로
  // 옮기거나 저장하지는 않지만(그건 enqueue 쪽 문제였다), 임의 경로의
  // 메타데이터를 읽어 응답으로 돌려준다는 점은 배포 형태가 바뀌면
  // 다시 검토해야 한다.
  scan: async ({ request }) => {
    const folder = String((await request.formData()).get('folder') ?? '').trim();
    if (!folder) return fail(400, { message: '폴더 경로를 입력하세요' });

    try {
      return { items: await scanFolder(config, folder), folder };
    } catch (err) {
      return fail(400, { message: `폴더를 읽을 수 없습니다: ${(err as Error).message}` });
    }
  },

  enqueue: async ({ request }) => {
    const fd = await request.formData();
    const folder = String(fd.get('folder') ?? '').trim();
    if (!folder) return fail(400, { message: '폴더 경로가 없습니다' });

    const raw = String(fd.get('items') ?? '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(400, { message: '보낼 항목을 읽을 수 없습니다' });
    }
    if (!Array.isArray(parsed) || !parsed.every(isClientItem)) {
      return fail(400, { message: '보낼 항목 형식이 올바르지 않습니다' });
    }
    const items = parsed as ClientItem[];
    if (items.length === 0) return fail(400, { message: '선택된 항목이 없습니다' });

    // sourcePath·recordedAt·audioStreamIndex 등은 절대 클라이언트를 믿지
    // 않는다. 브라우저가 보낸 ScanItem을 그대로 buildJobs에 넘기면 요청을
    // 직접 조작해 임의 경로를 media/original로 복사시키고 인증 없는
    // /api/media/<id>/original로 내려받게 만들 수 있었다(Task 12가 파형
    // 라우트에서 이미 고친 것과 같은 신뢰 경계 실수). 여기서는 서버가 폴더를
    // 다시 스캔해서 얻은 자기 자신의 ScanItem으로만 PendingItem을 만든다 —
    // 재스캔 비용은 252개 기준 0.7초 안팎이라 매번 다시 해도 싸다. 그리고
    // scan 시점과 save 시점 사이에 폴더 내용이 바뀌었을 가능성(파일
    // 삭제·중복 재등록 등)도 이 재스캔이 함께 잡아준다 — 그 사이 상태가
    // 바뀌었는데 예전 스캔 결과를 그대로 믿고 변환하는 것도 별도의
    // 버그였다.
    let scanned: ScanItem[];
    try {
      scanned = await scanFolder(config, folder);
    } catch (err) {
      return fail(400, { message: `폴더를 다시 읽을 수 없습니다: ${(err as Error).message}` });
    }
    const bySourceName = new Map(scanned.map((s) => [s.sourceName, s]));

    const pending: PendingItem[] = [];
    let skipped = 0;
    for (const item of items) {
      const scan = bySourceName.get(item.sourceName);
      // 재스캔에서 더 이상 안 보이거나(삭제·이름변경), 그 사이 에러
      // 상태이거나 중복으로 판정된 항목은 조용히 흘려보내지 않고 센다 —
      // 사용자가 고른 개수보다 적게 등록됐다는 걸 화면이 알 수 있어야 한다.
      if (!scan || scan.error !== null || scan.duplicate) {
        skipped++;
        continue;
      }
      pending.push({ scan, title: item.title, description: item.description, tags: item.tags });
    }

    if (pending.length === 0) {
      return fail(400, {
        message: '가져올 수 있는 항목이 없습니다 (다시 스캔한 결과와 일치하는 항목이 없습니다)'
      });
    }

    // 변환을 시작하기 전에 여유 공간을 확인한다. 중간에 꽉 차면
    // 반쯤 변환된 파일들이 남아 정리가 어렵다.
    const need = estimateBytes(config, pending.map((p) => p.scan.bytes));
    try {
      const free = await freeBytes(config.mediaDir);
      if (need > free) return fail(507, { message: new DiskShortage(need, free).message });
    } catch {
      // 여유를 잴 수 없으면 막지 않고 진행한다
    }

    const { jobs } = buildJobs(config, pending);
    getQueue(config).enqueue(jobs);
    return { queued: jobs.length, skipped };
  }
};
