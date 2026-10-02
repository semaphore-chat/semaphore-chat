import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * Absolute path to the committed fake-media WAV samples (e2e/assets).
 * Resolved from cwd (Playwright always runs from the frontend dir) so this
 * works whether the config is loaded as ESM or CJS — `__dirname` is undefined
 * under ESM.
 */
export const VOICE_ASSET_DIR = path.resolve(process.cwd(), 'e2e/assets');

/**
 * Playwright E2E Test Configuration
 *
 * Run tests with: npm run test:e2e
 * Debug with UI: npm run test:e2e:ui
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Auth setup — runs once, saves storageState for reuse
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    // Main tests — use saved auth state (skip auth.spec.ts which tests auth
    // itself, and voice/ which needs the real-LiveKit harness in the `voice`
    // project — without this ignore, voice specs run here too and fail on
    // every push because the standard e2e stack has no LiveKit server)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
      // Anchored at e2e/: Playwright matches these against the absolute path,
      // so a bare /voice\// also matched every spec in a checkout whose
      // directory name ends in "voice" (e.g. a semaphore-chat-wt-voice worktree).
      testIgnore: [/auth\.spec\.ts/, /\/e2e\/voice\//],
    },

    // Auth tests — run without saved state so they can test login/register flows
    {
      name: 'auth-tests',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /auth\.spec\.ts/,
    },

    // Voice tests — real LiveKit + fake media. Each participant launches its own
    // browser in the fixture (so distinct fake audio files can be used), but the
    // project still sets the Chromium flags + a longer timeout for WebRTC setup.
    // Run via scripts/run-voice-e2e.sh (real LiveKit server required).
    {
      name: 'voice',
      testMatch: /\/e2e\/voice\/[^/]+\.spec\.ts$/,
      // Real-WebRTC E2E against a single LiveKit SFU: when all specs run serially
      // back-to-back, accumulated room/transport load makes the last, heaviest
      // specs (screen share, 4-party matrix) intermittently flake (~1 in 3 full
      // runs). Retries are the standard mitigation — a test that passes on retry
      // is reported "flaky", not "failed", so the suite stays trustworthy without
      // masking a consistently-broken test. 2 in CI, 1 locally.
      retries: process.env.CI ? 2 : 1,
      timeout: 90 * 1000,
      // outputDir under the OS temp dir, not ./test-results: the dockerized
      // playwright service can leave ./test-results root-owned, which then makes
      // a host run crash in the reporter (EACCES writing .last-run.json).
      outputDir: process.env.PW_VOICE_OUTPUT_DIR || '/tmp/kraken-voice-e2e-results',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone', 'camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            // Default fake audio; per-participant browsers override with their own wav.
            `--use-file-for-fake-audio-capture=${VOICE_ASSET_DIR}/sample-a.wav`,
          ],
        },
      },
    },
  ],

  // Start the dev server before tests ONLY for the built-in local dev server.
  // When E2E_BASE_URL is set (e.g. the dockerized voice stack on :5174) the
  // server is already running, so don't spawn a second host `npm run dev`.
  webServer:
    process.env.CI || process.env.E2E_BASE_URL
      ? undefined
      : {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 120 * 1000,
        },

  // Global test timeout
  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
});
