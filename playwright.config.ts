import { defineConfig } from '@playwright/test';

const widths = [320, 375, 430] as const;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  workers: process.env.CI === undefined ? 3 : 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    ...widths.map((width) => ({
      name: `chromium-${String(width)}`,
      use: { browserName: 'chromium' as const, viewport: { width, height: 760 } },
    })),
    ...widths.map((width) => ({
      name: `webkit-${String(width)}`,
      use: { browserName: 'webkit' as const, viewport: { width, height: 760 } },
    })),
  ],
  webServer: {
    command: 'VITE_ENABLE_REALTIME=true npm run build && npx vite preview --host 127.0.0.1 --port 4173',
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:4173',
  },
});
