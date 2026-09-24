#!/usr/bin/env node
/**
 * Screenshot the docs site built by preview-docs.sh (with the media pointing
 * at the local frontend/.media-out/ files), so the Tour gallery and its
 * lightbox can be looked at with the Read tool before anything is published.
 * The site is served to Chromium straight from disk; no web server needed.
 *
 * Runs in the Playwright image (preview-docs.sh has the docker command):
 *   node docs-shots.mjs <site-dir> <out-dir> [shot-name ...]
 * Writes to <out-dir>:
 *   home.png                    the top of the docs home page (the hero)
 *   tour-<section id>.png       each section of the Tour page, 1440 px wide
 *   lightbox-<shot>-desktop.png the lightbox opened on that screenshot, 1440x900
 *   lightbox-<shot>-phone.png   the same on a 390x844 phone
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// playwright-core is installed outside any workspace and found via NODE_PATH,
// which only require() honors.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const [siteArg, outDir, ...shots] = process.argv.slice(2);
if (!siteArg || !outDir) {
  console.error('usage: node docs-shots.mjs <site-dir> <out-dir> [shot-name ...]');
  process.exit(2);
}
const site = path.resolve(siteArg);
mkdirSync(outDir, { recursive: true });

const ORIGIN = 'http://docs.test';
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await context.route(`${ORIGIN}/**`, (route) => {
    let rel = decodeURIComponent(new URL(route.request().url()).pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(site, rel);
    if (!file.startsWith(site) || !existsSync(file) || statSync(file).isDirectory()) {
      console.error(`  404 ${rel}`);
      return route.fulfill({ status: 404, body: 'not found' });
    }
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  return context.newPage();
}

/** Load a page with every lazy image loaded, so full-page shots have no holes. */
async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => document.querySelectorAll('img[loading="lazy"]').forEach((img) => (img.loading = 'eager')));
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 30_000 });
  const broken = await page.evaluate(() =>
    Array.from(document.images).filter((img) => img.naturalWidth === 0).map((img) => img.getAttribute('src')),
  );
  if (broken.length) console.error(`  broken images on ${url}: ${broken.join(', ')}`);
  await sleep(300);
}

const browser = await chromium.launch();

const desktop = await newPage(browser, { width: 1440, height: 900 });
await open(desktop, `${ORIGIN}/`);
await desktop.screenshot({ path: path.join(outDir, 'home.png') });

await open(desktop, `${ORIGIN}/tour/`);
const sections = await desktop.evaluate(() => {
  const article = document.querySelector('article');
  const heads = Array.from(article.querySelectorAll('h1, h2'));
  const end = article.getBoundingClientRect().bottom + window.scrollY;
  return heads.map((h, i) => {
    const top = h.getBoundingClientRect().top + window.scrollY - 12;
    const next = heads[i + 1] ? heads[i + 1].getBoundingClientRect().top + window.scrollY - 12 : end;
    return { id: h.tagName === 'H1' ? 'intro' : h.id, top: Math.max(0, top), height: next - Math.max(0, top) };
  });
});
for (const s of sections) {
  const file = path.join(outDir, `tour-${s.id}.png`);
  await desktop.screenshot({ path: file, fullPage: true, clip: { x: 0, y: s.top, width: 1440, height: s.height } });
}
console.log(`tour: ${sections.length} section(s): ${sections.map((s) => s.id).join(', ')}`);

const phone = await newPage(browser, { width: 390, height: 844 });
await open(phone, `${ORIGIN}/tour/`);
for (const shot of shots) {
  for (const [label, page] of [['desktop', desktop], ['phone', phone]]) {
    const img = page.locator(`article img[src*="/screenshots/${shot}.webp"]`).first();
    if (!(await img.count())) {
      console.error(`  ${shot}: no image on the Tour page (is it in docs-site/docs/tour.md?)`);
      break;
    }
    await img.scrollIntoViewIfNeeded();
    await img.click();
    await page.waitForFunction(() => {
      const shown = document.querySelector('.glightbox-container .gslide.current img');
      return shown && shown.complete && shown.naturalWidth > 0;
    }, null, { timeout: 15_000 });
    await sleep(900); // the zoom-in animation
    await page.screenshot({ path: path.join(outDir, `lightbox-${shot}-${label}.png`) });
    await page.keyboard.press('Escape');
    await sleep(600);
  }
}
await browser.close();
