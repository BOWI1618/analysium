import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the real stack — the Vite dev server talking to the Fastify
 * API talking to PostgreSQL. Start both with `npm run dev` before running, or
 * let Playwright start the web server itself.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'ru-RU',
    // The app honours prefers-reduced-motion; switching it on removes the
    // entrance animations that otherwise make menus "not stable" for clicks.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // `channel: 'chromium'` runs the full browser build rather than the
      // separate headless-shell download, so one `playwright install chromium`
      // is all a contributor needs.
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 120_000,
        // The suite registers several accounts per run, which would otherwise
        // trip the credential rate limit part-way through.
        env: { ...process.env, AUTH_RATE_LIMIT_MAX: '500' },
      },
});
