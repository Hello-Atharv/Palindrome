import { defineConfig } from 'vitest/config';

export default defineConfig({
  // spec/ and web/mock_vm/ live outside this package
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts'] },
});
