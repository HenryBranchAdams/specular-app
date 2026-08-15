import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/specular.visual.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/ui-quality/visual-playwright.json' }]],
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'en-US',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: 'chromium-blocking' }],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  webServer: {
    command: 'VITE_ENABLE_REALTIME=true npm run build && npx vite preview --host 127.0.0.1 --port 4173',
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:4173',
  },
});
