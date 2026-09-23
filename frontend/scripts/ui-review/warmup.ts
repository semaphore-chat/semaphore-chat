/**
 * Opens one story on a Ladle instance before the probe/capture so Vite's
 * first-request transform of the whole module graph (30s+ on a cold server)
 * doesn't eat into per-story timeouts. Runs in the `shots` container:
 *   node scripts/ui-review/warmup.ts <ladle url> [story id]   (default: first story)
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core') as typeof import('playwright-core');

const [baseUrl, requested] = process.argv.slice(2);
const started = Date.now();
const storyId = requested || Object.keys(((await (await fetch(`${baseUrl}/meta.json`)).json()) as { stories: object }).stories).sort()[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/?story=${encodeURIComponent(storyId)}&mode=preview`, { waitUntil: 'networkidle', timeout: 180_000 });
  console.log(`[warmup] ${baseUrl} ready (${Math.round((Date.now() - started) / 1000)}s)`);
} catch (err) {
  console.warn(`[warmup] ${baseUrl}: ${(err as Error).message}`);
} finally {
  await browser.close();
}
