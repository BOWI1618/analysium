import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Integration tests share one Postgres schema — run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    // The schema is pushed once into a template; each file copies it in its setup.
    globalSetup: ['tests/globalSetup.ts'],
    hookTimeout: 60_000,
  },
});
