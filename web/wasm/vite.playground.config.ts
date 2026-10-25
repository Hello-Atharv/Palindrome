import { defineConfig } from 'vite';

// Dev server for the playground only (kept separate so vitest keeps the package root).
export default defineConfig({
  root: 'playground',
  server: { fs: { allow: ['../../..'] } }, // the page imports examples/demos/ and asm/ from the repo root
  build: { outDir: '../playground-dist', emptyOutDir: true },
});
