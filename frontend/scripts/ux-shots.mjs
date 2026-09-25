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
 *   UX_SHOTS_SETTLE_MS  wait after load before the screenshot (default 4500)
 *
 * Opt-in extras (used by the UI review tool, scripts/ui-review/; all unset by
 * default, which keeps the sweep's behaviour exactly as above):
 *   UX_SHOTS_IDS                exact story ids to shoot (comma/space/newline
 *                               separated, or `@<file>` to read them from a
 *                               file). Combines with UX_SHOTS_FILTER. Ids the
 *                               running Ladle doesn't know are skipped and
 *                               listed as `missingIds` in report.json.
 *   UX_SHOTS_CONCURRENCY        stories shot in parallel (default 1)
 *   UX_SHOTS_FREEZE_TIME        ISO timestamp — pins `Date.now()`/`new Date()`
 *                               (timers keep running) so relative times render
 *                               identically run to run
 *   UX_SHOTS_TASKS              exact story × viewport pairs to shoot, `@<file>`
 *                               with one `<story id> <viewport>` per line
 *                               (replaces UX_SHOTS_IDS/FILTER/VIEWPORTS)
 *   UX_SHOTS_QUIET_MS           after load, also wait (max 10s; 20s more while a
 *                               story driver still runs, see `storyBusy`) until, for this
 *                               long, the DOM had no mutation, no request
 *                               started or finished and no script/stylesheet/
 *                               font request is pending, before the settle
 *                               sleep. Catches a lazy route still loading
 *                               behind a static "Loading..." screen; steadier
 *                               under concurrency
 *   UX_SHOTS_DISABLE_ANIMATIONS `1` — screenshots with CSS animations and
 *                               transitions stopped (spinners, skeletons),
 *                               and animated images (GIF, WebP, APNG) shown
 *                               at their first frame, so the frame caught
 *                               doesn't depend on load timing
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const IDS_SPEC = process.env.UX_SHOTS_IDS || '';
const TASKS_SPEC = process.env.UX_SHOTS_TASKS || '';
const CONCURRENCY = Math.max(1, Number(process.env.UX_SHOTS_CONCURRENCY || 1));
const FREEZE_TIME = process.env.UX_SHOTS_FREEZE_TIME || '';
const DISABLE_ANIMATIONS = process.env.UX_SHOTS_DISABLE_ANIMATIONS === '1';
const QUIET_MS = Number(process.env.UX_SHOTS_QUIET_MS || 0);
/** Extra wait (ms) for a story driver still running when the settle wait ran out (see `storyBusy`). */
const STORY_BUSY_MAX_MS = 20_000;

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

/**
 * UX_SHOTS_QUIET_MS: resolve once the DOM has gone `quietMs` without a
 * mutation (data arrived, lazy routes mounted, lists measured). A fixed sleep
 * after `networkidle` alone gets flaky with several pages in parallel. Keep in
 * sync with scripts/ui-review/lib/settle.ts (the `maxMs` defaults must equal its
 * SETTLE_MAX_MS; a unit test checks).
 */
function waitForDomQuiet(page, quietMs, maxMs = 10_000) {
  return page.evaluate(
    ({ quietMs, maxMs }) =>
      new Promise((resolve) => {
        let timer;
        const finish = () => {
          observer.disconnect();
          clearTimeout(cap);
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, quietMs);
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        timer = setTimeout(finish, quietMs);
        const cap = setTimeout(finish, maxMs);
      }),
    { quietMs, maxMs },
  );
}

const BLOCKING_REQUESTS = new Set(['document', 'script', 'stylesheet', 'font']);

/**
 * Network side of the settle check (UX_SHOTS_QUIET_MS): pending
 * script/stylesheet/font requests (a lazy route's chunk mid-transform) and the
 * time since any request last started or finished. Pending fetch/XHR don't
 * block — stories of loading states hold requests open on purpose. Start it
 * before `page.goto`. Keep in sync with scripts/ui-review/lib/settle.ts.
 */
function trackNetwork(page) {
  const pending = new Set();
  let last = Date.now();
  page.on('request', (request) => {
    last = Date.now();
    if (BLOCKING_REQUESTS.has(request.resourceType())) pending.add(request);
  });
  const done = (request) => {
    last = Date.now();
    pending.delete(request);
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { blocking: () => pending.size, idleFor: () => Date.now() - last };
}

/**
 * A story that drives itself through an interaction (`useDriver` in
 * src/stories/fixtures/edge/chat.ts) sets `<html data-story-busy>` until its
 * last step ran: the pauses between steps leave the DOM quiet, so without
 * this a shot could catch it halfway. Keep in sync with
 * scripts/ui-review/lib/settle.ts.
 */
function storyBusy(page) {
  return page.evaluate(() => 'storyBusy' in document.documentElement.dataset).catch(() => false);
}

/** DOM quiet, network quiet, nothing blocking pending and no story driver running, all for `quietMs`; false when `maxMs` ran out. */
async function waitForSettled(page, net, quietMs, maxMs = 10_000) {
  const started = Date.now();
  const left = () => maxMs - (Date.now() - started);
  while (left() > 0) {
    await waitForDomQuiet(page, quietMs, Math.max(1, left()));
    const busy = await storyBusy(page);
    if (!busy && net.blocking() === 0 && net.idleFor() >= quietMs) return true;
    await sleep(Math.min(Math.max(50, busy || net.blocking() > 0 ? 100 : quietMs - net.idleFor()), Math.max(1, left())));
  }
  return false;
}

/**
 * Shows every loaded animated image (GIF, animated WebP/PNG/AVIF) at its
 * first frame: decodes it with WebCodecs' ImageDecoder and swaps in a PNG of
 * that frame (same element, same intrinsic size, so the layout doesn't move).
 * Playwright's `animations: 'disabled'` only stops CSS animations — a GIF
 * keeps playing, so which frame a screenshot catches depends on timing.
 * Returns how many images were frozen. Best effort: an image that can't be
 * fetched or decoded is left alone.
 */
async function freezeAnimatedImages(page) {
  return page.evaluate(async () => {
    if (typeof ImageDecoder === 'undefined') return 0;
    let frozen = 0;
    for (const img of Array.from(document.images)) {
      const src = img.currentSrc || img.src;
      if (!img.complete || !img.naturalWidth || !src || src.startsWith('data:image/png;frozen=1;')) continue;
      try {
        const res = await fetch(src);
        const type = (res.headers.get('content-type') || '').split(';')[0].trim();
        if (!/^image\/(gif|webp|png|apng|avif)$/.test(type) || !(await ImageDecoder.isTypeSupported(type))) continue;
        const decoder = new ImageDecoder({ data: await res.arrayBuffer(), type });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (!track || !track.animated || track.frameCount <= 1) {
          decoder.close();
          continue;
        }
        const { image } = await decoder.decode({ frameIndex: 0 });
        const canvas = document.createElement('canvas');
        canvas.width = image.displayWidth;
        canvas.height = image.displayHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        image.close();
        decoder.close();
        img.removeAttribute('srcset');
        img.src = canvas.toDataURL('image/png').replace('data:image/png;', 'data:image/png;frozen=1;');
        await img.decode().catch(() => undefined);
        frozen += 1;
      } catch {
        // leave this image as it is
      }
    }
    return frozen;
  });
}

async function fetchMeta() {
  const res = await fetch(`${BASE_URL}/meta.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${BASE_URL}/meta.json: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * A story can name its own viewports in its Ladle meta
 * (`Story.meta = { viewports: ['phone'] }`, copied into meta.json), e.g. a
 * 320 px column is a phone layout that tablet and desktop never show.
 * Otherwise "*keyboard*" stories exist specifically to approximate an
 * on-screen keyboard covering the lower half of a phone (see design doc) —
 * they only get the short viewport. Every other story gets everything except
 * "phone-short". Keep in sync with scripts/ui-review/lib/viewports.ts.
 */
function viewportsForStory(storyId, storyMeta) {
  const own = storyMeta?.viewports;
  if (Array.isArray(own) && own.length > 0) {
    return requestedViewports.filter((name) => own.includes(name));
  }
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
  let settled = true;
  const net = QUIET_MS > 0 ? trackNetwork(page) : null;
  try {
    if (FREEZE_TIME) await page.clock.setFixedTime(new Date(FREEZE_TIME));
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    if (net) {
      settled = await waitForSettled(page, net, QUIET_MS);
      // A story still driving itself when the settle cap ran out (a slow,
      // loaded machine): give its driver more time, then settle again.
      if (!settled && (await storyBusy(page))) {
        await page
          .waitForFunction(() => !('storyBusy' in document.documentElement.dataset), null, { timeout: STORY_BUSY_MAX_MS, polling: 100 })
          .catch(() => undefined);
        settled = await waitForSettled(page, net, QUIET_MS);
      }
    }
    await sleep(SETTLE_MS);
    if (DISABLE_ANIMATIONS) await freezeAnimatedImages(page);

    const outSubdir = path.join(OUT_DIR, viewportName);
    await mkdir(outSubdir, { recursive: true });
    await page.screenshot({
      path: path.join(outSubdir, `${storyId}.png`),
      fullPage: true,
      ...(DISABLE_ANIMATIONS ? { animations: 'disabled' } : {}),
    });
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
    ...(net ? { settled } : {}),
    consoleEntries,
    pageErrors,
    unhandledRequests,
    renderErrors,
  };
}

/** UX_SHOTS_IDS → list of ids (`@path` reads the list from a file). */
async function readRequestedIds() {
  if (!IDS_SPEC) return null;
  const text = IDS_SPEC.startsWith('@') ? await readFile(path.resolve(FRONTEND_ROOT, IDS_SPEC.slice(1)), 'utf8') : IDS_SPEC;
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

/** UX_SHOTS_TASKS → [{ storyId, viewportName }] (`@path`: one `<id> <viewport>` per line). */
async function readRequestedTasks() {
  if (!TASKS_SPEC) return null;
  const text = TASKS_SPEC.startsWith('@') ? await readFile(path.resolve(FRONTEND_ROOT, TASKS_SPEC.slice(1)), 'utf8') : TASKS_SPEC;
  const seen = new Set();
  const tasks = [];
  for (const line of text.split(/[\n,]+/)) {
    const [storyId, viewportName] = line.trim().split(/\s+/);
    if (!storyId || !viewportName || seen.has(`${storyId} ${viewportName}`)) continue;
    seen.add(`${storyId} ${viewportName}`);
    tasks.push({ storyId, viewportName });
  }
  return tasks;
}

function describeResult(result) {
  const hasIssues =
    !result.ok || result.pageErrors.length > 0 || result.unhandledRequests.length > 0 || result.renderErrors.length > 0;
  const text = result.ok
    ? hasIssues
      ? `done (${result.pageErrors.length} page error(s), ${result.renderErrors.length} render error(s), ${result.unhandledRequests.length} unhandled request(s))`
      : 'ok'
    : `FAILED: ${result.errorMessage}`;
  return { hasIssues, text: result.settled === false ? `${text} (page still busy after the settle wait)` : text };
}

async function main() {
  console.log(`[ux-shots] Fetching story list from ${BASE_URL}/meta.json ...`);
  const meta = await fetchMeta();
  let storyIds = Object.keys(meta.stories).sort();
  const requestedTasks = await readRequestedTasks();
  const requestedIds = requestedTasks ? [...new Set(requestedTasks.map((t) => t.storyId))] : await readRequestedIds();
  let missingIds = [];
  if (requestedIds) {
    const known = new Set(storyIds);
    missingIds = requestedIds.filter((id) => !known.has(id));
    const wanted = new Set(requestedIds);
    storyIds = storyIds.filter((id) => wanted.has(id));
    if (missingIds.length > 0) {
      console.log(`[ux-shots] ${missingIds.length} requested id(s) not in this Ladle instance: ${missingIds.join(', ')}`);
    }
  }
  if (FILTER && !requestedTasks) {
    storyIds = storyIds.filter((id) => id.includes(FILTER));
  }
  if (storyIds.length === 0) {
    console.error('[ux-shots] No stories matched — nothing to do.');
    process.exit(1);
  }
  const available = new Set(storyIds);
  const tasks = requestedTasks
    ? requestedTasks.filter((t) => available.has(t.storyId) && VIEWPORTS[t.viewportName])
    : storyIds.flatMap((storyId) =>
        viewportsForStory(storyId, meta.stories[storyId]?.meta).map((viewportName) => ({ storyId, viewportName })),
      );
  console.log(
    requestedTasks
      ? `[ux-shots] ${tasks.length} story × viewport task(s)`
      : `[ux-shots] ${storyIds.length} stories, viewports: ${requestedViewports.join(', ')}`,
  );

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  // Slot per task so report.json keeps story/viewport order at any concurrency.
  const results = new Array(tasks.length);
  let failureCount = 0;

  if (CONCURRENCY === 1) {
    for (const [index, { storyId, viewportName }] of tasks.entries()) {
      process.stdout.write(`[ux-shots] ${storyId} @ ${viewportName} ... `);
      const result = await shootStory(browser, storyId, viewportName);
      results[index] = result;
      const { hasIssues, text } = describeResult(result);
      if (hasIssues) failureCount++;
      console.log(text);
    }
  } else {
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const index = next++;
        const { storyId, viewportName } = tasks[index];
        const result = await shootStory(browser, storyId, viewportName);
        results[index] = result;
        const { hasIssues, text } = describeResult(result);
        if (hasIssues) failureCount++;
        console.log(`[ux-shots] ${storyId} @ ${viewportName} ... ${text}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  }

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    storyCount: storyIds.length,
    shotCount: results.length,
    issueCount: failureCount,
    ...(requestedIds ? { requestedIds, missingIds } : {}),
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
