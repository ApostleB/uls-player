import { defineConfig } from '@playwright/test';

/**
 * Electron 앱 e2e 전용 설정.
 *
 * 기존 playwright.config.ts와 파일을 분리한 이유: 그쪽의 webServer(4173
 * preview)는 설정 최상위 항목이라 프로젝트별로 끌 수 없다. 같은 설정에
 * Electron 스펙을 얹으면 쓰지도 않을 preview 서버를 매번 띄운다 —
 * Electron 앱은 자기 서버를 데리고 온다.
 */
export default defineConfig({
  testDir: 'tests/electron',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // 앱 인스턴스가 여럿 뜨면 단일 인스턴스 잠금에 걸려 두 번째가 즉시 죽는다.
  workers: 1
});
