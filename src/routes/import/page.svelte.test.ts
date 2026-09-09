import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';
import type { JobItem, ScanItem } from '$lib/types';

// "전체 선택" 버튼 하나만 좁게 검증한다. 이 버튼은 브리프의 코드를 그대로
// 옮기면 Row에 없는 r.error(항상 undefined)를 검사해서, 클릭할 때마다
// 모든 행이 항상 해제되는 버그가 있었다(r.scan.error로 고침). 그 버그가
// 리뷰까지 살아남은 건 이 경로를 검증하는 테스트가 하나도 없었기 때문이라,
// 폼 제출·SSE 등 다른 기능은 건드리지 않고 이 핸들러만 실제 DOM 상호작용으로
// 확인한다.
function scanItem(over: Partial<ScanItem> & { sourceName: string }): ScanItem {
  return {
    sourcePath: `/tmp/${over.sourceName}`,
    title: over.sourceName,
    appleAutoTitle: null,
    recordedAt: '2026-07-11T18:15:30+09:00',
    durationSec: 12,
    ext: 'qta',
    bytes: 100,
    audioStreamIndex: 0,
    duplicate: false,
    error: null,
    ...over
  };
}

describe('+page.svelte — 전체 선택', () => {
  it('에러 없는 행만 선택하고, 에러 행은 계속 해제 상태로 둔다', async () => {
    const items: ScanItem[] = [
      scanItem({ sourceName: 'ok1.qta' }),
      scanItem({ sourceName: 'ok2.qta' }),
      scanItem({ sourceName: 'bad.qta', error: '깨진 파일' })
    ];

    render(Page, {
      data: { tags: [], formats: ['mp3'] },
      form: { items, folder: '/tmp/fake' }
    });

    // 스캔 직후 기본값: 에러 없는 두 행만 선택돼 있다.
    await expect.element(page.getByText('2개 선택됨 / 전체 3개')).toBeInTheDocument();

    // 전체 해제 → 0개.
    await page.getByRole('button', { name: '전체 해제' }).click();
    await expect.element(page.getByText('0개 선택됨 / 전체 3개')).toBeInTheDocument();

    // 전체 선택 → 에러 없는 두 행만 다시 선택돼야 한다. 고쳐지기 전
    // (r.error 참조)에는 이 클릭이 아무것도 선택하지 못해 "0개 선택됨"이
    // 그대로 남았다.
    await page.getByRole('button', { name: '전체 선택' }).click();
    await expect.element(page.getByText('2개 선택됨 / 전체 3개')).toBeInTheDocument();
  });
});

/** 서버 응답 없이 EventSource 메시지 전달을 직접 통제하기 위한 가짜
 * 구현. 실제 EventSource는 재연결·네트워크 계층을 갖고 있어 결정론적으로
 * 프레임을 흘려보내기 어렵다 — 이 스텁은 onmessage 핸들러를 그대로
 * 노출해서 테스트가 원하는 시점에 원하는 스냅샷을 밀어넣을 수 있게 한다.
 * onMount가 마운트 즉시 진짜 EventSource를 만들므로(Must Fix 3), 이
 * 스텁을 전역에 꽂아두지 않는 테스트는 실제 네트워크 연결을 시도하게
 * 된다 — 그래서 아래 모든 describe가 이 스텁을 공통으로 쓴다. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  close() {
    this.closed = true;
  }
}

function job(over: Partial<JobItem> & { id: string; status: JobItem['status'] }): JobItem {
  return {
    recordingId: over.id,
    sourcePath: `/tmp/${over.id}`,
    title: over.id,
    formats: { mp3: over.status },
    error: over.status === 'failed' ? '변환 실패' : null,
    ...over
  };
}

// 파일 전체 공통: onMount가 마운트 즉시 EventSource를 여므로(Must Fix 3),
// 이 파일의 모든 테스트가 이 스텁을 필요로 한다. fetch는 describe마다
// 필요한 동작이 달라(응답 없음·성공·실패 등) 각 describe 안에서 개별
// 스텁한다.
beforeEach(() => {
  FakeEventSource.instances.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Must Fix 2(클라이언트 절반): 저장 버튼은 서버 응답이 올 때까지 비활성화돼야
 * 한다. 개선 전 코드는 disabled를 !selected.length로만 계산해서, 제출
 * 중에도(변환은 수 분 걸릴 수 있다) 버튼이 계속 눌려 있었다 — 사용자가
 * 연타하면 서버가 매번 재스캔해서 같은 항목을 duplicate:false로 보고,
 * 중복 잡이 쌓일 여지를 만들었다.
 *
 * enhance가 실제 폼 액션 서버 없이도 동작하도록 fetch를 직접 감아
 * "응답이 영원히 안 오는" 상태를 흉내낸다 — enhance의 제출 콜백은 fetch를
 * 부르기 전에 동기적으로 먼저 실행되므로(SvelteKit 소스: submit()을
 * await한 뒤에야 fetch), 버튼이 클릭 즉시(응답을 기다리지 않고도)
 * 비활성화되는지를 이 방법으로 결정론적으로 확인할 수 있다.
 */
describe('+page.svelte — 저장 제출 중 버튼 비활성화 (Must Fix 2)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); // 절대 resolve하지 않는다
  });

  it('제출을 시작하면 곧바로(응답을 기다리지 않고) 저장 버튼이 비활성화된다', async () => {
    const items: ScanItem[] = [scanItem({ sourceName: 'ok1.qta' })];
    render(Page, {
      data: { tags: [], formats: ['mp3'] },
      form: { items, folder: '/tmp/fake' }
    });

    const button = page.getByRole('button', { name: /1개 저장 및 변환/ });
    await expect.element(button).not.toBeDisabled();

    await button.click();

    await expect.element(button).toBeDisabled();
  });
});

/**
 * Must Fix 3: 진행 패널은 저장(enqueue) 시에만 SSE를 열었다 — 그래서
 * 새로고침하면(패널을 다시 그릴 잡 목록을 load가 안 준다) 통째로
 * 사라졌다. 마운트 시 곧바로 스트림을 여는지를, 폼 제출을 전혀 하지
 * 않은(=form prop이 없는, 새로고침을 흉내낸) 상태로 확인한다.
 */
describe('+page.svelte — 마운트 시 SSE 연결 (Must Fix 3)', () => {
  it('저장을 누르지 않아도(새로고침 등) 마운트되자마자 진행 상황 스트림을 연다', async () => {
    render(Page, { data: { tags: [], formats: ['mp3'] }, form: null });

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(FakeEventSource.instances[0].url).toContain('/api/jobs/events');
  });
});

/**
 * Must Fix 3: 재시도 버튼은 fetch 응답을 확인하지 않는 fire-and-forget
 * 호출이었고, 모든 잡이 끝나 스트림이 닫힌 뒤에는 재연결도 하지 않았다 —
 * 그래서 재시도가 서버에서 실제로 성공해도 화면은 실패 스냅샷에 멈춰
 * 있었다.
 */
describe('+page.svelte — 재시도 (Must Fix 3)', () => {
  /** 마운트로 연 스트림에 "잡 하나가 실행되다 실패로 끝난다" 시퀀스를
   * 흘려보내, watchProgress의 armed && every(terminal) 판정으로 스트림이
   * 실제로 닫히는 지점까지 재현한다 — 개선 전 버그(재시도해도 반응 없음)가
   * 실제로 관찰되는 전제 조건이 바로 "스트림이 닫혀 있다"이기 때문이다. */
  async function reachClosedFailedState(): Promise<FakeEventSource> {
    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const es = FakeEventSource.instances[0];
    es.emit([job({ id: 'j1', status: 'running' })]);
    es.emit([job({ id: 'j1', status: 'failed' })]);
    await vi.waitFor(() => {
      expect(es.closed).toBe(true);
    });
    await expect.element(page.getByRole('button', { name: /실패한 1개 재시도/ })).toBeInTheDocument();
    return es;
  }

  it('재시도가 성공하면 스트림을 다시 연다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    render(Page, { data: { tags: [], formats: ['mp3'] }, form: null });
    await reachClosedFailedState();

    await page.getByRole('button', { name: /실패한 1개 재시도/ }).click();

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    expect(FakeEventSource.instances[1].closed).toBe(false);
    await expect.element(page.getByText(/재시도 요청이 실패했습니다/)).not.toBeInTheDocument();
    await expect.element(page.getByText(/재시도 요청을 보낼 수 없습니다/)).not.toBeInTheDocument();
  });

  it('재시도 요청이 실패하면(서버 오류 응답) 에러 카드로 알려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));

    render(Page, { data: { tags: [], formats: ['mp3'] }, form: null });
    await reachClosedFailedState();

    await page.getByRole('button', { name: /실패한 1개 재시도/ }).click();

    await expect.element(page.getByText(/재시도 요청이 실패했습니다/)).toBeInTheDocument();
  });

  it('재시도 요청 자체가 던지면(네트워크 오류) 에러 카드로 알려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('네트워크 끊김');
      })
    );

    render(Page, { data: { tags: [], formats: ['mp3'] }, form: null });
    await reachClosedFailedState();

    await page.getByRole('button', { name: /실패한 1개 재시도/ }).click();

    await expect.element(page.getByText(/재시도 요청을 보낼 수 없습니다/)).toBeInTheDocument();
  });
});

/**
 * 업로드 폼은 파일을 고르는 순간 자동 제출된다(input의 onchange가
 * requestSubmit을 부른다). 그런데 진행 표시가 없어서, 원본 수백 개를
 * 올리는 동안 화면이 통째로 멈춘 것처럼 보였다 — 실사용에서 사용자가
 * "다음 동작 진행 불가"로 판단했고, 그렇게 다시 누르면 같은 전송이 두 번
 * 나간다. 재생 버튼에 로딩 표시가 없어 겪었던 것과 같은 부류다.
 *
 * 위 Must Fix 2 테스트와 같은 방법을 쓴다: 절대 resolve하지 않는 fetch로
 * "응답을 기다리는 중" 상태를 고정한다. enhance의 제출 콜백은 fetch보다
 * 먼저 동기적으로 실행되므로 이 시점이 결정론적으로 잡힌다.
 */
describe('+page.svelte — 업로드 진행 표시', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); // 절대 resolve하지 않는다
  });

  /** 파일 input에 실제 File을 넣고 change를 발생시킨다 — 이게 자동 제출을 태운다. */
  function pickFile(input: HTMLInputElement): void {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.qta', { type: 'audio/mp4' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('파일을 고르면 올리는 중이라는 표시가 나온다', async () => {
    render(Page, { data: { tags: [], formats: ['mp3'] }, form: null });
    const input = (await page.getByLabelText(/끌어다 놓거나/).element()) as HTMLInputElement;

    pickFile(input);

    await expect.element(page.getByRole('status')).toBeInTheDocument();
  });

  it('올리는 동안 파일 입력이 비활성화된다', async () => {
    // 다시 고를 수 있으면 같은 전송이 두 번 나간다.
    render(Page, { data: { tags: [], formats: ['mp3'] }, form: null });
    const input = (await page.getByLabelText(/끌어다 놓거나/).element()) as HTMLInputElement;

    pickFile(input);

    await vi.waitFor(() => expect(input.disabled).toBe(true));
  });

  it('업로드를 시작하면 직전 응답의 오류 메시지를 감춘다', async () => {
    // 스캔이 실패한 채로 파일을 고르면, 남아 있던 그 오류가 방금 시작한
    // 업로드의 결과처럼 읽힌다 — 실사용에서 실제로 그렇게 오해했다.
    render(Page, {
      data: { tags: [], formats: ['mp3'] },
      form: { message: '폴더를 읽을 수 없습니다: ENOENT' }
    });
    await expect.element(page.getByText(/폴더를 읽을 수 없습니다/)).toBeInTheDocument();

    const input = (await page.getByLabelText(/끌어다 놓거나/).element()) as HTMLInputElement;
    pickFile(input);

    await vi.waitFor(() =>
      expect(page.getByText(/폴더를 읽을 수 없습니다/).elements()).toHaveLength(0)
    );
  });
});
