import { describe, it, expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import MenuBar from './MenuBar.svelte';

/**
 * 현재 경로 표시는 접두사로 판정한다 — /recordings 아래에 하위 경로가
 * 생기더라도 "리스트"가 활성으로 남아야 하기 때문이다.
 */

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

  it('메뉴바에는 입력 요소가 없다', () => {
    // 검색은 목록 화면이 전담한다. 여기 입력이 되살아나면 같은 URL을
    // 두 곳에서 고치는 구조가 함께 돌아온다.
    render(MenuBar, { pathname: '/recordings' });
    expect(page.getByRole('textbox').elements()).toHaveLength(0);
    expect(page.getByRole('combobox').elements()).toHaveLength(0);
  });
});
