import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const baseConfig = viteConfig({
  command: 'serve',
  mode: 'test',
  isPreview: false,
  isSsrBuild: false,
});

export default mergeConfig(baseConfig, defineConfig({
  plugins: [
    storybookTest({ configDir: path.join(dirname, '.storybook') }),
  ],
  optimizeDeps: {
    // Keep the Storybook a11y CJS chain in one Vite 8 browser bundle.
    // https://github.com/vitejs/vite/issues/23030
    include: ['aria-query', 'lz-string', 'pretty-format'],
  },
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({}),
      instances: [{ browser: 'chromium' }],
    },
    reporters: ['default', 'json'],
    outputFile: {
      json: 'artifacts/ui-quality/storybook.json',
    },
  },
}));
