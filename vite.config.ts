import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const manifestLinkPattern = /<link\s+rel="manifest"[^>]*>/gu;

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Specular',
        short_name: 'Specular',
        description: 'A private workspace for developing ideas, testing theses, and making decisions.',
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
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    port: 5177,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.SPECULAR_DEV_API_ORIGIN ?? 'http://127.0.0.1:8788',
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist*/**'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
