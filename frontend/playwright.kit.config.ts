import { defineConfig, devices } from '@playwright/test';

/**
 * Real-browser tests for the kit: Playwright against the Ladle stories, for what jsdom cannot show
 * (layout, media queries, `inert`, the focus trap, computed styles at a real width).
 *
 * Locally: `scripts/test-stack.sh <ticket> browser [playwright args]` (Ladle dev server in
 * `<ticket>-ladle`, KIT_BASE_URL set by the script). In CI: `ladle build` then this config with
 * KIT_STATIC=1, which serves build-ladle/ with `ladle preview`.
 *
 * Chromium runs every spec; Firefox and WebKit run the specs tagged @keyboard (focus and Tab order differ most
 * there). Playwright's WebKit on Linux focuses a clicked button, unlike Safari: a spec that needs Safari's click
 * emulates it (overlay-stack.spec.ts).
 */
const PORT = 61000;
const baseURL = process.env.KIT_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: './browser-tests',
  testMatch: /.*\.spec\.ts/,
  // Gitignored (frontend/test-results/), apart from the e2e suite's own results.
  outputDir: './test-results/kit',
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  workers: ci ? 2 : undefined,
  reporter: ci
    ? [['list'], ['html', { open: 'never', outputFolder: './playwright-report/kit' }]]
    : [['list']],
  // The Ladle dev server compiles a story on its first request.
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@keyboard/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@keyboard/ },
  ],
  webServer: process.env.KIT_STATIC
    ? {
        command: `pnpm exec ladle preview --host 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : undefined,
});
