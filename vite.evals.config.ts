import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'node22',
    outDir: 'dist-evals',
    emptyOutDir: true,
    minify: false,
    ssr: resolve(import.meta.dirname, 'evals/run-evals.ts'),
    rollupOptions: {
      output: {
        entryFileNames: 'run-evals.js',
      },
    },
  },
});
