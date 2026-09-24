/**
 * Renders the before/after composite pages written by `cli.ts diff`
 * (work/html/*.html, see lib/layout.ts) to PNGs with Chromium — the Playwright
 * image has the fonts for the labels. Runs in the ui-review `shots` container:
 *   node scripts/ui-review/composite.ts <composite-jobs.json>
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core') as typeof import('playwright-core');

const [jobsPath] = process.argv.slice(2);
if (!jobsPath) {
  console.error('usage: node scripts/ui-review/composite.ts <composite-jobs.json>');
  process.exit(2);
}
const jobs: { html: string; out: string }[] = JSON.parse(readFileSync(jobsPath, 'utf8'));

async function main() {
  if (jobs.length === 0) return;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
  for (const job of jobs) {
    await page.goto(pathToFileURL(job.html).href, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode().catch(() => undefined))));
    mkdirSync(path.dirname(job.out), { recursive: true });
    await page.locator('#composite').screenshot({ path: job.out });
  }
  await browser.close();
  console.log(`[composite] rendered ${jobs.length} composite(s)`);
}

main().catch((err) => {
  console.error('[composite] fatal:', err);
  process.exit(1);
});
