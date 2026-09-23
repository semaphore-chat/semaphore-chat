#!/usr/bin/env node
/**
 * Automated screenshot sweep of every Ladle story, at phone / tablet /
 * desktop viewports (see docs/superpowers/specs/2026-09-22-ladle-ux-sandbox-design.md).
 *
 * Usage (see docker-compose.yml's `ux-shots` service):
 *   node scripts/ux-shots.mjs
 *
 * Env vars:
 *   UX_SHOTS_BASE_URL   Ladle origin (default http://ladle:61000)
 *   UX_SHOTS_FILTER     substring — only run stories whose id contains it
 *   UX_SHOTS_VIEWPORTS  comma list of viewport names to run (default: all)
 *   UX_SHOTS_OUT_DIR    output directory (default .ux-shots, relative to this file's frontend/ root)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// `playwright-core` is installed at container-start time (see the `ux-shots`
// docker-compose service) into a directory outside this project (its own
// `package.json` has a `workspace:*` dependency `npm install` chokes on).
// `require()` (unlike ESM `import`) still honors `NODE_PATH`, so this finds
// it there without needing an absolute path baked into the compose command.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');

const BASE_URL = process.env.UX_SHOTS_BASE_URL || 'http://ladle:61000';
const FILTER = process.env.UX_SHOTS_FILTER || '';
const OUT_DIR = path.resolve(FRONTEND_ROOT, process.env.UX_SHOTS_OUT_DIR || '.ux-shots');
const SETTLE_MS = Number(process.env.UX_SHOTS_SETTLE_MS || 4500);
const NAV_TIMEOUT_MS = 30_000;

/** All available viewports. `short` only applies to "*keyboard*" stories (see below). */
const VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  'phone-short': { width: 390, height: 500, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  tablet: { width: 820, height: 1180, isMobile: false, hasTouch: true, deviceScaleFactor: 1 },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};

const requestedViewports = (process.env.UX_SHOTS_VIEWPORTS || 'phone,phone-short,tablet,desktop')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMeta() {
  const res = await fetch(`${BASE_URL}/meta.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${BASE_URL}/meta.json: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * "*keyboard*" stories exist specifically to approximate an on-screen
 * keyboard covering the lower half of a phone (see design doc) — they only
 * get the short viewport. Every other story gets everything except
 * "phone-short".
 */
function viewportsForStory(storyId) {
  const isKeyboardStory = storyId.toLowerCase().includes('keyboard');
  if (isKeyboardStory) {
    return requestedViewports.filter((name) => name === 'phone-short');
  }
  return requestedViewports.filter((name) => name !== 'phone-short');
}

async function shootStory(browser, storyId, viewportName) {
  const viewport = VIEWPORTS[viewportName];
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    deviceScaleFactor: viewport.deviceScaleFactor,
  });
  const page = await context.newPage();

  const consoleEntries = [];
  const unhandledRequests = [];
  const pageErrors = [];
  const renderErrors = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      const text = msg.text();
      consoleEntries.push({ type, text });
      if (/\[MSW\].*unhandled/i.test(text) || /captured a request without a matching request handler/i.test(text)) {
        unhandledRequests.push(text);
      }
      // A component that throws while rendering is caught by the nearest
      // React ErrorBoundary — it never becomes an uncaught `pageerror`, but
      // React logs it via console.error with this signature. Treat it as a
      // real issue (usually leaves the screenshot blank/broken).
      if (/The above error occurred in the </.test(text)) {
        renderErrors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => {
    const text = String(err?.stack || err);
    // The Vite dev server's HMR websocket can't reach the `ladle` container
    // hostname from inside this headless browser's network namespace — pure
    // dev-server noise, unrelated to the app under test. Every other page
    // error is a real signal.
    if (/WebSocket closed without opened/i.test(text)) return;
    pageErrors.push(text);
  });

  const url = `${BASE_URL}/?story=${encodeURIComponent(storyId)}&mode=preview`;
  let ok = true;
  let errorMessage = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    await sleep(SETTLE_MS);

    const outSubdir = path.join(OUT_DIR, viewportName);
    await mkdir(outSubdir, { recursive: true });
    await page.screenshot({ path: path.join(outSubdir, `${storyId}.png`), fullPage: true });
  } catch (err) {
    ok = false;
    errorMessage = String(err?.message || err);
  } finally {
    await context.close();
  }

  return {
    storyId,
    viewport: viewportName,
    ok,
    errorMessage,
    consoleEntries,
    pageErrors,
    unhandledRequests,
    renderErrors,
  };
}

async function main() {
  console.log(`[ux-shots] Fetching story list from ${BASE_URL}/meta.json ...`);
  const meta = await fetchMeta();
  let storyIds = Object.keys(meta.stories).sort();
  if (FILTER) {
    storyIds = storyIds.filter((id) => id.includes(FILTER));
  }
  if (storyIds.length === 0) {
    console.error('[ux-shots] No stories matched — nothing to do.');
    process.exit(1);
  }
  console.log(`[ux-shots] ${storyIds.length} stories, viewports: ${requestedViewports.join(', ')}`);

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results = [];
  let failureCount = 0;

  for (const storyId of storyIds) {
    const viewportsToShoot = viewportsForStory(storyId);
    for (const viewportName of viewportsToShoot) {
      process.stdout.write(`[ux-shots] ${storyId} @ ${viewportName} ... `);
      const result = await shootStory(browser, storyId, viewportName);
      results.push(result);
      const hasIssues =
        !result.ok || result.pageErrors.length > 0 || result.unhandledRequests.length > 0 || result.renderErrors.length > 0;
      if (hasIssues) failureCount++;
      console.log(
        result.ok
          ? hasIssues
            ? `done (${result.pageErrors.length} page error(s), ${result.renderErrors.length} render error(s), ${result.unhandledRequests.length} unhandled request(s))`
            : 'ok'
          : `FAILED: ${result.errorMessage}`,
      );
    }
  }

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    storyCount: storyIds.length,
    shotCount: results.length,
    issueCount: failureCount,
    results,
  };
  await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[ux-shots] Wrote ${results.length} screenshots + report.json to ${OUT_DIR}`);
  if (failureCount > 0) {
    console.log(`[ux-shots] ${failureCount} shot(s) had errors/unhandled requests — see report.json`);
  }
}

main().catch((err) => {
  console.error('[ux-shots] Fatal error:', err);
  process.exitCode = 1;
});
