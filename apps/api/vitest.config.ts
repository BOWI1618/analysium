import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Integration tests share one Postgres schema — run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    // Each file's setup recreates the test database through `npx prisma db
    // push`; on a slower Windows machine that alone takes 15–25 s, and the
    // first, cold file overran 30.
    hookTimeout: 60_000,
  },
});
