import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import TagInput from './TagInput.svelte';

/**
 * 한글 IME 조합 중 Enter 처리.
 *
 * 실제 증상: "정준일"을 치고 Enter를 누르면 태그가 "정준일"과 "일"
 * 두 개로 들어간다. 원인은 마지막 음절이 아직 조합 중일 때 Enter를
 * 누르면 keydown이 두 번 오기 때문이다 — 조합 중에 한 번
 * (isComposing: true), IME가 확정한 뒤에 한 번(false).
 *
 * 조합 중 keydown에서 draft를 지워버리면 IME가 대기 중이던 음절을
 * 비워진 입력창에 확정하고, 뒤이은 두 번째 Enter가 그 잔여 음절을
 * 별개 태그로 추가한다.
 *
 * 그래서 이 컴포넌트의 계약은 "조합 중인 Enter에는 반응하지 않는다"이다.
 * 브라우저는 조합이 끝난 뒤 Enter를 한 번 더 주므로 태그는 그때 한 번만
 * 들어간다.
 */

/** 실제 IME가 보내는 것과 같은 모양의 Enter keydown을 만든다. */
function enterKey(isComposing: boolean): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    // KeyboardEvent 생성자가 표준으로 받는 필드다 — 별도 정의가 필요 없다.
    isComposing
  } as KeyboardEventInit);
}

/** bind:value가 반응하도록 실제 input 이벤트로 값을 넣는다. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function setup(initial: string[] = []) {
  const tags = $state({ value: initial });
  render(TagInput, {
    get tags() {
      return tags.value;
    },
    set tags(next: string[]) {
      tags.value = next;
    }
  });
  const input = (await page.getByPlaceholder('태그 입력 후 Enter').element()) as HTMLInputElement;
  return { tags, input };
}

describe('TagInput — 한글 IME 조합 중 Enter', () => {
  it('조합 중인 Enter(isComposing: true)에는 태그를 추가하지 않는다', async () => {
    const { tags, input } = await setup();

    type(input, '정준일');
    input.dispatchEvent(enterKey(true));
    await new Promise((r) => setTimeout(r, 0));

    expect(tags.value).toEqual([]);
  });

  it('조합이 끝난 Enter(isComposing: false)에는 태그를 추가한다', async () => {
    const { tags, input } = await setup();

    type(input, '정준일');
    input.dispatchEvent(enterKey(false));
    await new Promise((r) => setTimeout(r, 0));

    expect(tags.value).toEqual(['정준일']);
  });

  it('한글 입력 전체 흐름에서 태그가 하나만 들어간다', async () => {
    // 브라우저가 실제로 보내는 순서를 그대로 재현한다:
    // 조합 중 Enter → (무시되어 draft가 남음) → IME 확정 → 확정 후 Enter.
    const { tags, input } = await setup();

    type(input, '정준일');
    input.dispatchEvent(enterKey(true));
    await new Promise((r) => setTimeout(r, 0));

    // 조합 확정. draft를 안 지웠으므로 값은 그대로 "정준일"이다.
    type(input, '정준일');
    input.dispatchEvent(enterKey(false));
    await new Promise((r) => setTimeout(r, 0));

    expect(tags.value).toEqual(['정준일']);
  });

  it('영문처럼 조합이 없는 입력은 Enter 한 번에 그대로 들어간다', async () => {
    const { tags, input } = await setup();

    type(input, 'demo');
    input.dispatchEvent(enterKey(false));
    await new Promise((r) => setTimeout(r, 0));

    expect(tags.value).toEqual(['demo']);
  });
});
