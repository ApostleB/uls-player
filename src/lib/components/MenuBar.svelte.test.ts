import { describe, it, expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import MenuBar from './MenuBar.svelte';

/**
 * 현재 경로 표시는 접두사로 판정한다 — /recordings 아래에 하위 경로가
 * 생기더라도 "리스트"가 활성으로 남아야 하기 때문이다.
 */

// vitest-browser의 Locator에는 Playwright식 press()가 없다(fill()만 값을
// 바로 채운다) — 이 저장소의 다른 컴포넌트 테스트(page.svelte.test.ts의
// pressEnter, TagInput.svelte.test.ts의 enterKey)와 같은 방식으로 실제
// input 엘리먼트에 keydown을 직접 디스패치한다.
function pressEnter(el: HTMLElement | SVGElement) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
describe('MenuBar', () => {
  it('앱 이름은 메인으로 가는 링크다', async () => {
    render(MenuBar, { pathname: '/recordings' });
    const home = page.getByRole('link', { name: 'ULS Player' });
    await expect.element(home).toHaveAttribute('href', '/');
  });

  it('메인에서는 메인 버튼이 현재 페이지로 표시된다', async () => {
    render(MenuBar, { pathname: '/' });
    await expect
      .element(page.getByRole('link', { name: '메인' }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(page.getByRole('link', { name: '리스트' }))
      .not.toHaveAttribute('aria-current');
  });

  it('목록에서는 리스트 버튼이 현재 페이지로 표시된다', async () => {
    render(MenuBar, { pathname: '/recordings' });
    await expect
      .element(page.getByRole('link', { name: '리스트' }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('/recordings 아래 하위 경로에서도 리스트가 현재 페이지다', async () => {
    render(MenuBar, { pathname: '/recordings/abc' });
    await expect
      .element(page.getByRole('link', { name: '리스트' }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('가져오기 화면에서는 어느 버튼도 현재 페이지가 아니다', async () => {
    // 스펙 5절: 메뉴바에는 메인·리스트만 노출한다. 가져오기는 목록에서
    // 들어가는 동작이라 버튼이 없고, 그래서 활성 표시도 없다.
    render(MenuBar, { pathname: '/import' });
    await expect
      .element(page.getByRole('link', { name: '메인' }))
      .not.toHaveAttribute('aria-current');
    await expect
      .element(page.getByRole('link', { name: '리스트' }))
      .not.toHaveAttribute('aria-current');
  });

  it('가져오기 버튼은 메뉴바에 없다', async () => {
    render(MenuBar, { pathname: '/import' });
    expect(page.getByRole('link', { name: '가져오기' }).elements()).toHaveLength(0);
  });

  it('가져오기 화면에서도 메인·리스트 링크는 정상 목적지를 가리킨다', async () => {
    // 활성 표시(aria-current) 부재만 확인하면, 향후 실수로 /import에서
    // 메인·리스트 자체를 숨기거나 href를 지워도 이 스위트는 못 잡는다.
    // /import가 메뉴바를 잃었던 게 이 태스크의 존재 이유이므로, 두 링크가
    // 실제로 존재하고 올바른 곳을 가리키는지까지 못박는다.
    render(MenuBar, { pathname: '/import' });
    await expect
      .element(page.getByRole('link', { name: '메인' }))
      .toHaveAttribute('href', '/');
    await expect
      .element(page.getByRole('link', { name: '리스트' }))
      .toHaveAttribute('href', '/recordings');
  });
});

describe('MenuBar — 검색', () => {
  it('목록이 아닌 곳에서 Enter를 누르면 /recordings로 이동한다', async () => {
    const onsearch = vi.fn();
    render(MenuBar, { pathname: '/', onsearch });

    const input = page.getByPlaceholder('제목 검색');
    await input.fill('레인');
    pressEnter(input.element());

    expect(onsearch).toHaveBeenCalledWith('레인');
  });

  it('입력을 비우면 빈 문자열로 알린다', async () => {
    const onsearch = vi.fn();
    render(MenuBar, { pathname: '/recordings', onsearch, q: '레인' });

    const input = page.getByPlaceholder('제목 검색');
    await input.fill('');
    pressEnter(input.element());

    expect(onsearch).toHaveBeenCalledWith('');
  });

  it('Enter 없이 타이핑하면 디바운스 뒤에 한 번만 알린다', async () => {
    const onsearch = vi.fn();
    render(MenuBar, { pathname: '/recordings', onsearch });

    const input = page.getByPlaceholder('제목 검색');
    await input.fill('레');
    await input.fill('레인');

    // 이 assertion이 실제로 디바운스를 판별한다 — 디바운스가 없으면
    // 두 번의 fill 각각이 곧바로 onsearch를 불러 여기서 이미 실패한다.
    expect(onsearch).not.toHaveBeenCalled();

    // 고정 sleep(setTimeout) 대신 실제로 불릴 때까지 기다린다. 이
    // 저장소는 고정 sleep에 의존한 테스트가 타이밍에 흔들려 실패한 적이
    // (드물게, 여섯 번에 한 번꼴로도) 있어 실측 조건을 폴링하는 쪽을
    // 원칙으로 삼는다 — vitest-browser-svelte의 재시도형 단언과 마찬가지로
    // 실제 타이머를 그대로 쓴다(가짜 타이머는 그 재시도 자체를 방해한다).
    await vi.waitFor(() => expect(onsearch).toHaveBeenCalled(), { timeout: 2000 });

    expect(onsearch).toHaveBeenCalledTimes(1);
    expect(onsearch).toHaveBeenCalledWith('레인');
  });

  it('바깥에서 준 q가 입력에 반영된다', async () => {
    // /recordings?q=... 링크로 바로 들어온 경우 메뉴바에도 그 값이 보여야 한다.
    render(MenuBar, { pathname: '/recordings', q: '정류장' });
    await expect.element(page.getByPlaceholder('제목 검색')).toHaveValue('정류장');
  });
});
