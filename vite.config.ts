import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const manifestLinkPattern = /<link\s+rel="manifest"[^>]*>/gu;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Specular',
        short_name: 'Specular',
        description: 'A private thinking companion that asks the next useful question.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#070711',
        theme_color: '#070711',
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
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{css,html,js}'],
        navigateFallback: '/index.html',
      },
    }),
    {
      name: 'specular-deduplicate-manifest-link',
      enforce: 'post',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          let foundManifest = false;
          return html.replace(manifestLinkPattern, (link) => {
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
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
