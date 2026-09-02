import path from 'node:path';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { PendingItem } from '$lib/server/jobs/runner';
import type { ScanItem } from '$lib/types';
import { config } from '$lib/server/config';
import { scanFolder } from '$lib/server/scan';
import { saveUploads, UploadTooLarge, isUploadStaging, scheduleStagingCleanup } from '$lib/server/upload';
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

  // 브라우저가 올린 파일을 임시 폴더에 쓰고, 그 폴더를 scan과 똑같이
  // scanFolder에 태운다 — 이후 편집·enqueue 흐름은 폴더 스캔 결과와
  // 구별할 수 없다. saveUploads가 File.name(전적으로 클라이언트가
  // 통제하는 값)을 파일시스템 경로로 바꾸는 지점이라 신뢰 경계가 여기
  // 있다 — 실제 검증은 upload.ts 쪽에 있고, 여기서는 결과만 받는다.
  //
  // 응답에 folder를 반드시 같이 실어 보낸다. +page.svelte의 $effect가
  // `form.folder`를 읽어 hidden folder 값을 갱신하는데, 이게 없으면
  // 화면에 남아있던 이전 folder 값(또는 최초 진입이면 빈 문자열)이 그대로
  // enqueue로 넘어가 서버가 방금 만든 임시 폴더가 아닌 엉뚱한 곳을
  // 재스캔하게 된다 — scan 액션과 같은 모양을 맞춰야 하는 이유다.
  upload: async ({ request }) => {
    // request.formData()는 SvelteKit(정확히는 undici)이 멀티파트 바디
    // 전체를 파싱하며 메모리에 올린 뒤에야 반환한다 — 이 버퍼링 자체는
    // 우리가 바꿀 수 없는 프레임워크 제약이다(직접 스트리밍 멀티파트
    // 파서를 짜지 않는 한). 그래서 그 전에 Content-Length로 요청 전체
    // 크기부터 거른다. MAX_UPLOAD_MB(파일 하나의 한도)와는 다른 축이다 —
    // 파일 하나하나는 한도 아래여도 여러 개를 한 요청에 몰아넣으면(스펙의
    // 대표 시나리오인 3.1GB 초기 마이그레이션을 한 번에 올리는 경우 포함)
    // 합이 서버 메모리를 다 먹어치울 수 있다.
    //
    // Content-Length가 아예 없는 요청은 이 사전 검사 자체를 우회한다 —
    // curl로 직접 이 액션을 두드려보면(1차 리뷰에서 실제로 그렇게
    // 검증했다) 헤더를 안 보내는 요청을 쉽게 만들 수 있다. 반면 브라우저의
    // 네이티브 멀티파트 POST(<form enctype="multipart/form-data">나
    // fetch(form))는 바디 크기를 미리 다 아는 상태라 항상 Content-Length를
    // 싣는다 — 그러니 이 헤더를 요구해도 정상적인 사용자에게는 비용이
    // 없다. 없으면 요청 크기를 미리 알 방법이 없어 위 사전 검사가
    // 통째로 무력화되므로, 아예 받지 않는다.
    const totalLimitBytes = config.maxUploadTotalMb * 1024 * 1024;
    const contentLengthHeader = request.headers.get('content-length');
    const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    // 헤더가 아예 없거나(null) 값이 숫자가 아니면(예: 손으로 조작한 헤더)
    // 어느 쪽이든 "요청 크기를 신뢰할 수 없다"는 같은 사정이라 같은
    // 411로 묶는다 — 둘 다 아래 크기 검사를 우회할 수 있다는 점은 같다.
    if (!Number.isFinite(contentLength)) {
      return fail(411, {
        message:
          '유효한 Content-Length 헤더가 없는 업로드 요청은 받지 않습니다 ' +
          '(요청 전체 크기를 미리 확인할 수 없으면 메모리 보호를 우회할 수 있습니다).'
      });
    }
    if (contentLength > totalLimitBytes) {
      const gotMb = (contentLength / 1024 / 1024).toFixed(1);
      return fail(413, {
        message:
          `업로드 요청이 너무 큽니다(${gotMb}MB). ` +
          `파일당 한도는 ${config.maxUploadMb}MB, 요청 전체 한도는 ${config.maxUploadTotalMb}MB입니다.`
      });
    }

    let files: File[];
    try {
      const form = await request.formData();
      files = form.getAll('files').filter((v): v is File => v instanceof File);
    } catch (err) {
      // 예: filename*=UTF-8''... 같은 깨진 인코딩처럼 undici가 멀티파트
      // 자체를 못 읽는 경우. 여기서 잡지 않으면 액션 밖으로 새어나가
      // 500으로 끝난다 — 원인이 사용자가 보낸 요청 형식이니 400이 맞다.
      return fail(400, { message: `업로드 요청을 읽을 수 없습니다: ${(err as Error).message}` });
    }

    let folder: string;
    try {
      folder = await saveUploads(config, files);
    } catch (err) {
      const status = err instanceof UploadTooLarge ? 413 : 400;
      return fail(status, { message: (err as Error).message });
    }

    return { items: await scanFolder(config, folder), folder };
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

    // 1차 통과: 재스캔 매치 여부만 본다. existingSourceNames(scan.duplicate가
    // 근거로 삼는 것)는 recordings.json만 읽는데, 그 파일은 파이프라인
    // 맨 끝에서만 갱신된다(runner.ts) — 그래서 이 통과만으로는 "지금
    // 변환 중인" 항목을 아직 걸러내지 못한다(바로 아래 2차 통과가 담당).
    // candidates가 여기서 비면(=재스캔과 아예 매치되는 게 없으면) 큐를
    // 건드릴 이유조차 없으므로 getQueue를 부르지 않고 곧장 실패한다 —
    // "전부 건너뛰면 조용히 0개를 올리지 않고 깨끗하게 실패한다" 테스트가
    // 지키는 불변식이다.
    const candidates: { item: ClientItem; scan: ScanItem }[] = [];
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
      candidates.push({ item, scan });
    }

    if (candidates.length === 0) {
      return fail(400, {
        message: '가져올 수 있는 항목이 없습니다 (다시 스캔한 결과와 일치하는 항목이 없습니다)'
      });
    }

    // 2차 통과: 큐가 이미 알고 있는(=지금 진행 중이거나 이미 끝난)
    // sourceName은 다시 올리지 않는다. Must Fix 2: 252개를 저장하고 변환이
    // 도는 동안(수 분) 저장 버튼을 다시 누르면, 재스캔은 여전히
    // duplicate:false를 돌려준다(recordings.json이 아직 안 바뀌었으므로) —
    // 그대로 두면 504개(원래 252 + 이번에 또 큐에 오른 252)가 되고 원본이
    // 통째로 다시 복사된다. 큐의 snapshot()에서 sourcePath의 basename이
    // sourceName과 같은 잡을 찾아, failed가 아닌 상태(pending·running·done)면
    // "이미 처리 중이거나 처리됨"으로 보고 건너뛴다. failed는 제외한다 —
    // 실패한 잡은 사용자가 여기서 다시 올려 새로 시도할 수 있어야 한다
    // (retryFailed()가 있긴 하지만, 다시 가져오기 화면에서 재제출하는
    // 것까지 막을 이유는 없다).
    const queue = getQueue(config);
    const inFlight = new Set(
      queue
        .snapshot()
        .filter((j) => j.status !== 'failed')
        .map((j) => path.basename(j.sourcePath))
    );

    const pending: PendingItem[] = [];
    for (const { item, scan } of candidates) {
      if (inFlight.has(item.sourceName)) {
        skipped++;
        continue;
      }
      pending.push({ scan, title: item.title, description: item.description, tags: item.tags });
    }

    if (pending.length === 0) {
      return fail(400, {
        message: '가져올 수 있는 항목이 없습니다 (선택한 항목이 모두 이미 처리 중이거나 등록되어 있습니다)'
      });
    }

    // 변환을 시작하기 전에 여유 공간을 확인한다. 중간에 꽉 차면
    // 반쯤 변환된 파일들이 남아 정리가 어렵다. pending은 이미 위에서
    // in-flight 항목을 뺀 뒤이므로, 어차피 건너뛸 항목의 용량까지
    // 과대평가해서 불필요하게 507을 내는 일이 없다.
    const need = estimateBytes(config, pending.map((p) => p.scan.bytes));
    try {
      const free = await freeBytes(config.mediaDir);
      if (need > free) return fail(507, { message: new DiskShortage(need, free).message });
    } catch {
      // 여유를 잴 수 없으면 막지 않고 진행한다
    }

    const { jobs } = buildJobs(config, pending);
    queue.enqueue(jobs);

    // folder가 saveUploads가 만든 스테이징 폴더라면(브라우저 업로드 경로),
    // 이 배치의 잡이 전부 끝나는 대로 지운다 — isUploadStaging이 사용자가
    // "폴더 경로 입력"으로 직접 가리킨 실제 폴더는 절대 건드리지 않게
    // 막는다. 잡은 비동기로(큐 동시성만큼씩) 나중에 실행되므로 여기서
    // 동기적으로 지울 수 없다 — scheduleStagingCleanup이 큐 구독으로
    // 완료를 기다렸다가 지운다(이유는 upload.ts의 주석 참고).
    if (isUploadStaging(folder)) {
      scheduleStagingCleanup(
        queue,
        folder,
        jobs.map((j) => j.id)
      );
    }

    return { queued: jobs.length, skipped };
  }
};
