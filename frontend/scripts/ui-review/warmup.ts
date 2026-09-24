/**
 * Opens stories on a Ladle instance before the probe/capture so Vite's
 * on-demand transforms (30s+ for the first story on a cold server, then every
 * lazy route and component chunk a story pulls in) happen here, not during a
 * timed capture — where a slow chunk left a static "Loading..." screen to be
 * photographed. Runs in the `shots` container:
 *   node scripts/ui-review/warmup.ts <ladle url> [story id | @<ids file>] [concurrency]
 * Default: the first story. Failures are logged, never fatal.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Browser } from 'playwright-core';
import { trackNetwork, waitForSettled } from './lib/settle.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core') as typeof import('playwright-core');

const [baseUrl, requested, concurrencyArg] = process.argv.slice(2);
const started = Date.now();
const ids = requested?.startsWith('@')
  ? [...new Set(readFileSync(requested.slice(1), 'utf8').split(/\s+/).filter(Boolean))]
  : [requested || Object.keys(((await (await fetch(`${baseUrl}/meta.json`)).json()) as { stories: object }).stories).sort()[0]];
const concurrency = Math.max(1, Number(concurrencyArg) || 1);

async function open(browser: Browser, storyId: string, timeout: number) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const net = trackNetwork(page);
  try {
    await page.goto(`${baseUrl}/?story=${encodeURIComponent(storyId)}&mode=preview`, { waitUntil: 'networkidle', timeout });
    await waitForSettled(page, net, 300, 20_000);
  } catch (err) {
    console.warn(`[warmup] ${storyId}: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    net.dispose();
    await page.close();
  }
}

const browser = await chromium.launch();
try {
  // The first load transforms the shared module graph: alone, with a long timeout.
  await open(browser, ids[0], 180_000);
  let next = 1;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(0, ids.length - 1)) }, async () => {
      while (next < ids.length) await open(browser, ids[next++], 60_000);
    }),
  );
  console.log(`[warmup] ${baseUrl}: ${ids.length} stor${ids.length === 1 ? 'y' : 'ies'} (${Math.round((Date.now() - started) / 1000)}s)`);
} finally {
  await browser.close();
}
