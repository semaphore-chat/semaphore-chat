#!/usr/bin/env node
/**
 * Decode an animated WebP (hero.webp) frame by frame in Chromium and save
 * frames as PNGs, so they can be looked at with the Read tool. ffmpeg can't
 * decode animated WebP, so this uses the browser's WebCodecs ImageDecoder.
 *
 * Runs in the Playwright image (see reference/review.md for the docker
 * command). Usage:
 *   node hero-frames.mjs <in.webp> <out-dir> [every=6]
 * Saves every <every>-th frame (6 = one per 0.5 s at the hero's 12 fps) plus
 * the last frame, named f<index>.png, and prints the frame count, the total
 * duration and the loop count (Infinity = loops forever).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// playwright-core is installed outside any workspace and found via NODE_PATH,
// which only require() honors.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const [input, outDir, everyArg] = process.argv.slice(2);
if (!input || !outDir) {
  console.error('usage: node hero-frames.mjs <in.webp> <out-dir> [every=6]');
  process.exit(2);
}
const every = Math.max(1, Number(everyArg ?? 6));
mkdirSync(outDir, { recursive: true });
const b64 = readFileSync(input).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
// ImageDecoder needs a secure context: serve a blank page from an https URL.
await page.route('https://frames.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' }));
await page.goto('https://frames.test/');
await page.exposeFunction('saveFrame', (i, dataUrl) => {
  writeFileSync(path.join(outDir, `f${String(i).padStart(3, '0')}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
});
const info = await page.evaluate(
  async ({ b64, every }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dec = new ImageDecoder({ data: bin, type: 'image/webp' });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = track.frameCount;
    let canvas;
    let totalUs = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      totalUs += image.duration ?? 0;
      if (i % every === 0 || i === count - 1) {
        canvas ??= Object.assign(document.createElement('canvas'), { width: image.displayWidth, height: image.displayHeight });
        canvas.getContext('2d').drawImage(image, 0, 0);
        await window.saveFrame(i, canvas.toDataURL('image/png'));
      }
      image.close();
    }
    return { count, loops: track.repetitionCount, seconds: totalUs / 1e6, width: canvas?.width, height: canvas?.height };
  },
  { b64, every },
);
await browser.close();
console.log(
  `${input}: ${info.count} frames, ${info.seconds.toFixed(2)} s, ${info.width}x${info.height}, loop count ${info.loops} -> ${outDir}`,
);
