/**
 * Shared helpers for the README/docs media scripts (`shots.mjs`,
 * `record.mjs`). See docs/superpowers/specs/2026-09-23-readme-media-design.md
 * and the `media` services in docker-compose.yml.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Same trick as scripts/ux-shots.mjs: `playwright-core` is installed at
// container start into /opt/uxshots (outside the pnpm workspace) and found
// through NODE_PATH, which only `require()` honors.
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright-core');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FRONTEND_ROOT = path.resolve(__dirname, '..', '..');
export const BASE_URL = process.env.MEDIA_BASE_URL || 'http://localhost:61000';
export const OUT_DIR = path.resolve(FRONTEND_ROOT, process.env.MEDIA_OUT_DIR || '.media-out');
export const FILTER = process.env.MEDIA_FILTER || '';

/** Must match `SHOWCASE_NOW` / `SHOWCASE_TIMEZONE` in src/stories/fixtures/showcase.ts. */
export const SHOWCASE_NOW = '2026-09-23T01:04:00Z';
export const SHOWCASE_TIMEZONE = 'America/New_York';

export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for Ladle to be up (it may still be compiling right after `up -d`). */
export async function waitForLadle(timeoutMs = 180_000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BASE_URL}/meta.json`);
      if (res.ok) return await res.json();
    } catch {
      // not up yet
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Ladle not reachable at ${BASE_URL} after ${timeoutMs}ms`);
    await sleep(2000);
  }
}

export function storyUrl(storyId) {
  return `${BASE_URL}/?story=${encodeURIComponent(storyId)}&mode=preview`;
}

/**
 * CSS for marketing captures: no scrollbars, no blinking caret in
 * screenshots, no Ladle backdrop. Injected into every page.
 */
export const CAPTURE_CSS = `
  * { scrollbar-width: none !important; }
  *::-webkit-scrollbar { display: none !important; }
  .ladle-background { display: none !important; }
`;

export async function newCaptureContext(browser, viewportName, extra = {}) {
  const vp = VIEWPORTS[viewportName];
  const context = await browser.newContext({
    ...vp,
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: SHOWCASE_TIMEZONE,
    reducedMotion: 'no-preference',
    // Otherwise the settings page shows a "notifications are blocked" error.
    permissions: ['notifications'],
    ...extra,
  });
  // Fixed wall clock (timers still run in real time), so "Today", day
  // separators and relative times match the showcase's hand-written times.
  await context.clock.install({ time: new Date(SHOWCASE_NOW) });
  // Headless Chromium reports notification permission as denied even when
  // granted above; the settings page would show a "blocked" error banner.
  await context.addInitScript(() => {
    if (!('Notification' in window)) return;
    try {
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    } catch {
      // ignore
    }
  });
  await context.addInitScript((css) => {
    const add = () => {
      const style = document.createElement('style');
      style.dataset.media = 'capture';
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, CAPTURE_CSS);
  return context;
}

/** Collect everything that would make a marketing capture wrong. */
export function watchPage(page) {
  const issues = { pageErrors: [], consoleErrors: [], unhandledRequests: [], renderErrors: [], httpErrors: [] };
  // Informational (some endpoints 404 by design, e.g. "no per-channel override").
  page.on('response', (res) => {
    if (res.status() >= 400) issues.httpErrors.push(`${res.status()} ${res.url()}`);
  });
  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    if (/\[MSW\].*unhandled|without a matching request handler/i.test(text)) issues.unhandledRequests.push(text);
    if (/The above error occurred in the </.test(text) || /Maximum update depth/i.test(text)) issues.renderErrors.push(text);
    if (type === 'error') issues.consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = String(err?.stack || err);
    // Vite HMR websocket noise inside the container network namespace.
    if (/WebSocket closed without opened/i.test(text)) return;
    issues.pageErrors.push(text);
  });
  return issues;
}

/**
 * Wait until the screen looks finished: no spinners/skeletons, every <img>
 * decoded, then a short settle. Returns the number of broken images.
 */
export async function waitForSettled(page, { settleMs = 1200, timeoutMs = 20_000 } = {}) {
  const started = Date.now();
  for (;;) {
    const busy = await page.evaluate(() => {
      const spinners = document.querySelectorAll('.MuiCircularProgress-root, .MuiSkeleton-root').length;
      const pendingImgs = Array.from(document.images).filter((img) => !img.complete).length;
      return spinners + pendingImgs;
    });
    if (busy === 0 || Date.now() - started > timeoutMs) break;
    await sleep(250);
  }
  await sleep(settleMs);
  return page.evaluate(
    () => Array.from(document.images).filter((img) => img.complete && img.naturalWidth === 0 && img.offsetParent !== null).length,
  );
}

/** Texts that must never appear in marketing media. */
export const FORBIDDEN_TEXT = [/Story not found/i, /SIMULATED/, /Ladle/i, /lorem ipsum/i, /reply #\d/i, /Something went wrong/i, /Failed to load/i, /are blocked/i, /No clips yet/i];

export async function findForbiddenText(page) {
  const text = await page.evaluate(() => document.body.innerText);
  return FORBIDDEN_TEXT.filter((re) => re.test(text)).map(String);
}
