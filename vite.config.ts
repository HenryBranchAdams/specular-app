import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import hostingConfig from './.openai/hosting.json';

const manifestLinkPattern = /<link\s+rel="manifest"[^>]*>/gu;

export default defineConfig(({ mode }) => {
  const storybookBuild = process.env.STORYBOOK === 'true';
  const deploymentPlugins = mode === 'test' || storybookBuild
    ? []
    : [
        sites(),
        ...cloudflare({
          viteEnvironment: { name: 'server' },
          config: {
            main: './worker/index.ts',
            compatibility_flags: ['nodejs_compat'],
            d1_databases: [{
              binding: hostingConfig.d1,
              database_name: 'specular-sites-local',
              database_id: '00000000-0000-4000-8000-000000000000',
              migrations_dir: './drizzle',
            }],
          },
        }),
      ];
  return {
  plugins: [
    tailwindcss(),
    react(),
    ...deploymentPlugins,
    VitePWA({
      disable: storybookBuild,
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Specular',
        short_name: 'Specular',
        description: 'A private place to write until the thought becomes visible.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icons/maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{css,html,js}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/(?:signin-with-chatgpt|signout-with-chatgpt|callback)(?:\/|$)/u,
        ],
        skipWaiting: false,
      },
    }),
    {
      name: 'specular-deduplicate-manifest-link',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html: string) {
          let foundManifest = false;
          return html.replace(manifestLinkPattern, (link: string) => {
            if (foundManifest) {
              return '';
            }
            foundManifest = true;
            return link;
          });
        },
      },
    },
  ],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    port: 5177,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    exclude: [
      'tests/e2e/**',
      'tests/integration/**',
      'tests/integration-browser/**',
      'tests/visual/**',
      '**/node_modules/**',
      '**/dist*/**',
    ],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/auth/**/*.ts',
        'src/auth/**/*.tsx',
        'src/sync/workspace-sync.ts',
        'src/dictation/capture.ts',
        'src/dictation/client.ts',
        'src/account/client.ts',
      ],
      exclude: [
        'src/**/*.stories.ts',
        'src/**/*.stories.tsx',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
      thresholds: {
        'src/{account,auth,dictation,sync}/**': {
          statements: 84,
          branches: 60,
          functions: 82,
          lines: 88,
        },
        'src/auth/**': {
          statements: 92,
          branches: 82,
          functions: 90,
          lines: 96,
        },
        'src/dictation/**': {
          statements: 80,
          branches: 64,
          functions: 82,
          lines: 85,
        },
        'src/sync/**': {
          statements: 83,
          branches: 50,
          functions: 79,
          lines: 88,
        },
        'src/account/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
  };
});
