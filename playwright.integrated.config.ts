import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration-browser',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-integrated' }]],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'en-US',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
});
