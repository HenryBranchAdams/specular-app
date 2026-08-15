import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import hostingConfig from './.openai/hosting.json';

const manifestLinkPattern = /<link\s+rel="manifest"[^>]*>/gu;

export default defineConfig(async ({ mode }) => {
  const deploymentPlugins = mode === 'test'
    ? []
    : [
        sites(),
        ...(await import('@cloudflare/vite-plugin')).cloudflare({
          viteEnvironment: { name: 'server' },
          config: {
            main: './worker/index.ts',
            compatibility_flags: ['nodejs_compat'],
            d1_databases: [{
              binding: hostingConfig.d1,
              database_name: 'specular-sites-local',
              database_id: '00000000-0000-4000-8000-000000000000',
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
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Specular',
        short_name: 'Specular',
        description: 'A private place to write until the thought becomes visible.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#faf8f2',
        theme_color: '#faf8f2',
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
        skipWaiting: true,
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
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist*/**'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
  };
});
