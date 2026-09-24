/**
 * "Rendered" heuristic for a Ladle story (keep in sync with the copy in
 * `scripts/ux-shots.mjs`, which stays self-contained; a unit test checks the
 * shared defaults, `SETTLE_MAX_MS`). A story counts as
 * settled once, for `quietMs` in a row:
 *   - the DOM had no mutation (data arrived, lazy routes mounted, lists measured),
 *   - no request started or finished, and
 *   - no script/stylesheet/font request is still pending.
 * `networkidle` plus a DOM-quiet wait alone is not enough under load: after
 * `networkidle` a lazy route's chunk can still be in flight (a cold Vite
 * transform takes seconds) while a static "Loading..." screen keeps the DOM
 * quiet — which captured half-loaded pages. Pending fetch/XHR requests don't
 * block (stories of loading states hold them open on purpose). Gives up after
 * `maxMs`.
 */
import type { Page, Request } from 'playwright-core';

/** Default cap (ms) of `waitForDomQuiet`/`waitForSettled`; ux-shots.mjs uses the same. */
export const SETTLE_MAX_MS = 10_000;

const BLOCKING = new Set(['document', 'script', 'stylesheet', 'font']);

export interface NetworkTracker {
  /** Pending script/stylesheet/font/document requests. */
  blocking: () => number;
  /** ms since a request last started or finished. */
  idleFor: () => number;
  dispose: () => void;
}

/** Start before `page.goto` so requests in flight during navigation are seen. */
export function trackNetwork(page: Page): NetworkTracker {
  const pending = new Set<Request>();
  let last = Date.now();
  const onRequest = (r: Request) => {
    last = Date.now();
    if (BLOCKING.has(r.resourceType())) pending.add(r);
  };
  const onDone = (r: Request) => {
    last = Date.now();
    pending.delete(r);
  };
  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  return {
    blocking: () => pending.size,
    idleFor: () => Date.now() - last,
    dispose: () => {
      page.off('request', onRequest);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
    },
  };
}

export async function waitForDomQuiet(page: Page, quietMs = 500, maxMs = SETTLE_MAX_MS): Promise<void> {
  await page.evaluate(
    ({ quietMs, maxMs }) =>
      new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the page is settled (see above); resolves `false` if `maxMs` ran out first. */
export async function waitForSettled(page: Page, net: NetworkTracker, quietMs = 500, maxMs = SETTLE_MAX_MS): Promise<boolean> {
  const started = Date.now();
  const left = () => maxMs - (Date.now() - started);
  while (left() > 0) {
    await waitForDomQuiet(page, quietMs, Math.max(1, left()));
    if (net.blocking() === 0 && net.idleFor() >= quietMs) return true;
    await sleep(Math.min(Math.max(50, net.blocking() > 0 ? 100 : quietMs - net.idleFor()), Math.max(1, left())));
  }
  return false;
}
