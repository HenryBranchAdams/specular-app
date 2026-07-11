import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist-server',
    sourcemap: true,
    ssr: 'server/index.ts',
    target: 'node22',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
