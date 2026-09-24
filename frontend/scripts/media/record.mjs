#!/usr/bin/env node
/**
 * Records the scripted video scenes (Playwright `recordVideo`) that
 * encode.sh stitches into `hero.webp`/`hero.gif` and `tour.mp4`.
 *
 * Each scene is its own browser context (so its own .webm). The scene
 * function drives the real UI with an eased, visible cursor and human-speed
 * typing, and teammates "act" through `window.__showcase` (see
 * src/stories/fixtures/showcaseStory.ts). Only the part between the scene's
 * `start()` and its end is kept: `.media-out/raw/scenes/scenes.json` records
 * each clip's trim offsets for encode.sh.
 *
 * Env: MEDIA_BASE_URL, MEDIA_OUT_DIR, MEDIA_FILTER (substring of scene name).
 */
import { mkdir, rename, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  chromium, OUT_DIR, FILTER, SHOWCASE_NOW, SHOWCASE_TIMEZONE, CAPTURE_CSS, VIEWPORTS,
  waitForLadle, storyUrl, watchPage, waitForSettled, findForbiddenText, sleep,
} from './lib.mjs';

const SCENES_DIR = path.join(OUT_DIR, 'raw', 'scenes');

// ─────────────────────────────────────────────────────────────────────────
// Cursor overlay (Playwright's video has no mouse pointer)
// ─────────────────────────────────────────────────────────────────────────

/** Runs in the page: an arrow (desktop) or a touch dot (phone) that follows real mouse events. */
function installCursor(mode) {
  const init = () => {
    if (document.getElementById('media-cursor')) return;
    const root = document.createElement('div');
    root.id = 'media-cursor';
    root.style.cssText =
      'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);will-change:transform;';
    if (mode === 'touch') {
      root.innerHTML =
        '<div style="width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,0.35);border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 10px rgba(0,0,0,0.35);opacity:0;transition:opacity 120ms, transform 120ms" id="media-touch"></div>';
    } else {
      root.innerHTML =
        '<svg width="26" height="30" viewBox="0 0 26 30" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));display:block">' +
        '<path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20 17 Z" fill="#ffffff" stroke="#15131f" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    }
    document.body.appendChild(root);
    const touch = () => document.getElementById('media-touch');
    window.addEventListener(
      'mousemove',
      (e) => {
        root.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      },
      true,
    );
    window.addEventListener(
      'mousedown',
      (e) => {
        if (mode === 'touch') {
          const t = touch();
          if (t) {
            t.style.opacity = '1';
            t.style.transform = 'scale(0.85)';
          }
          return;
        }
        const ring = document.createElement('div');
        ring.style.cssText =
          `position:fixed;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;` +
          'border:3px solid rgba(179,136,255,0.95);z-index:2147483646;pointer-events:none;' +
          'transform:scale(0.3);opacity:1;transition:transform 420ms ease-out, opacity 420ms ease-out;';
        document.body.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.transform = 'scale(1.35)';
          ring.style.opacity = '0';
        });
        setTimeout(() => ring.remove(), 500);
      },
      true,
    );
    window.addEventListener(
      'mouseup',
      () => {
        const t = touch();
        if (t) {
          t.style.opacity = '0';
          t.style.transform = 'scale(1)';
        }
      },
      true,
    );
  };
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
}

// ─────────────────────────────────────────────────────────────────────────
// Human-ish input
// ─────────────────────────────────────────────────────────────────────────

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function makeActor(page) {
  let pos = { x: 0, y: 0 };
  const actor = {
    get pos() {
      return pos;
    },
    /** Put the cursor somewhere without animating (before the clip starts). */
    async place(x, y) {
      pos = { x, y };
      await page.mouse.move(x, y);
    },
    /** Eased move with a slight arc, ~60 fps. */
    async move(x, y, ms = 650) {
      const from = pos;
      const steps = Math.max(8, Math.round(ms / 16));
      const dx = x - from.x;
      const dy = y - from.y;
      const arc = Math.min(40, Math.hypot(dx, dy) * 0.08);
      for (let i = 1; i <= steps; i++) {
        const t = easeInOut(i / steps);
        const bend = Math.sin(Math.PI * t) * arc;
        const len = Math.hypot(dx, dy) || 1;
        await page.mouse.move(from.x + dx * t + (-dy / len) * bend, from.y + dy * t + (dx / len) * bend);
        await sleep(16);
      }
      pos = { x, y };
    },
    async click(ms = 110) {
      await page.mouse.down();
      await sleep(ms);
      await page.mouse.up();
    },
    /** Move to the centre of a locator (optionally offset) and click it. */
    async clickOn(locator, { dx = 0, dy = 0, moveMs = 700, pause = 180 } = {}) {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`clickOn: ${locator} has no box`);
      await actor.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, moveMs);
      await sleep(pause);
      await actor.click();
    },
    /** Touch: tap the centre of a locator without travelling across the page first. */
    async tap(locator, { pause = 120 } = {}) {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`tap: ${locator} has no box`);
      await actor.place(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(pause);
      await actor.click();
    },
    /** Type like a person: 45–120 ms per key, longer after spaces and punctuation. */
    async type(text) {
      let i = 0;
      for (const ch of text) {
        await page.keyboard.type(ch);
        i += 1;
        const base = 55 + ((i * 37) % 50);
        await sleep(/[ ,.!?]/.test(ch) ? base + 70 : base);
      }
    },
    showcase(fn, ...args) {
      return page.evaluate(([f, a]) => window.__showcase[f](...a), [fn, args]);
    },
  };
  return actor;
}

// ─────────────────────────────────────────────────────────────────────────
// Scenes
// ─────────────────────────────────────────────────────────────────────────

const DEV = { channelId: 'ch-dev' };

/** What gets said in the tour's scenes (shared with the catch-up steps below). */
const TOUR_TEXT = {
  merged: 'Merged! Thanks for the quick reviews, everyone 🎉',
  staging: 'Nice 🚀 deploying to staging now',
  standup: 'On my way to standup 🏃',
  seeYou: 'See you there!',
};

// The tour plays as one continuous session, but every scene is a fresh page.
// These replay what earlier scenes did (through window.__showcase, before the
// clip starts) so a later scene doesn't lose sent messages or show badges for
// conversations already read. Ids: see src/stories/fixtures/showcase.ts.
// Messages are spaced out: several arriving within a frame or two can leave
// the list short of the bottom (it stops following new messages).
const CATCH_UP_GAP_MS = 400;
const afterTourChat = async (actor) => {
  await actor.showcase('say', 'alex', DEV, TOUR_TEXT.merged, {
    reactions: [
      { emoji: '🎉', userIds: ['u-priya', 'u-aiko'] },
      { emoji: '🙌', userIds: ['u-marcus'] },
    ],
  });
  await sleep(CATCH_UP_GAP_MS);
  await actor.showcase('say', 'marcus', DEV, TOUR_TEXT.staging);
  await sleep(CATCH_UP_GAP_MS);
  await actor.showcase('react', 'alex', 'sc-dev-ci-green', '💚', DEV);
};
const afterTourDms = (actor) => actor.showcase('read', { dmId: 'dm-priya' });
const afterTourPhone = async (actor) => {
  await sleep(CATCH_UP_GAP_MS);
  await actor.showcase('say', 'alex', DEV, TOUR_TEXT.standup);
  await sleep(CATCH_UP_GAP_MS);
  await actor.showcase('say', 'aiko', DEV, TOUR_TEXT.seeYou);
};

/** #dev: type + send a message, teammates react and reply, +1 a reaction, open the thread (`long`: a longer message, for the tour). */
async function chatScene({ page, actor, start }, { long = false } = {}) {
  const composer = page.locator('textarea').first();
  const cbox = await composer.boundingBox();
  // Start on the composer's right: hovering a message row shows its action
  // toolbar, so the cursor never travels across the message list to get here.
  await actor.place(cbox.x + cbox.width * 0.78, cbox.y + cbox.height / 2 + 6);
  await start();
  await sleep(200);
  await actor.clickOn(composer, { dx: -cbox.width * 0.3, moveMs: 700, pause: 120 });
  // Drift off the text like a person does before typing.
  await actor.move(actor.pos.x + 190, actor.pos.y + 14, 300);
  await actor.type(long ? TOUR_TEXT.merged : 'Merged, thanks all 🎉');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(450);
  const mine = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-message-id]'));
    const row = rows.reverse().find((r) => (r.textContent ?? '').includes('Merged'));
    return row ? row.getAttribute('data-message-id') : null;
  });
  if (mine) {
    await actor.showcase('react', 'priya', mine, '🎉', DEV);
    await sleep(300);
    await actor.showcase('react', 'aiko', mine, '🎉', DEV);
    await sleep(200);
    await actor.showcase('react', 'marcus', mine, '🙌', DEV);
  }
  await actor.showcase('typing', 'marcus', DEV, true);
  await sleep(900);
  await actor.showcase('typing', 'marcus', DEV, false);
  await actor.showcase('say', 'marcus', DEV, TOUR_TEXT.staging);
  await sleep(450);
  // +1 Grace's "CI is green" reaction.
  const green = page.locator('.MuiChip-root', { hasText: '💚' }).first();
  if (await green.isVisible().catch(() => false)) {
    await actor.clickOn(green, { moveMs: 750, pause: 120 });
    await sleep(long ? 700 : 350);
  }
  const replies = page.locator('button', { hasText: /5 replies/ }).first();
  await replies.scrollIntoViewIfNeeded();
  await actor.clickOn(replies, { moveMs: 800, pause: 120 });
  await sleep(long ? 2000 : 1700);
}

/**
 * Connected to the Lounge: people take turns talking. The conversation script
 * (`startConversation` in showcaseStory.ts) goes Priya, Priya, Diego,
 * Diego+Priya, Chloé, ... one step every `stepMs`; `lead` is how long it has
 * been running when the clip starts, so a short clip still shows all three.
 *
 * The cursor stays in the empty middle of the voice bar: a hovered stage tile
 * swaps its green speaking ring for the card hover border.
 */
async function voiceScene({ actor, start }, { ms = 5200, stepMs = 1100, lead = 300 } = {}) {
  await actor.place(420, 868);
  // The people already in the Lounge (`showcaseLoungeCrew` in src/stories/fixtures/showcase.ts).
  await actor.showcase('conversation', ['priya', 'diego', 'chloe'], stepMs);
  await sleep(lead);
  await start();
  await sleep(600);
  await actor.move(820, 860, 1400);
  await sleep(ms - 2000);
}

/** DMs: open Priya's conversation from the list, reply, she answers. */
async function dmScene({ page, actor, start }) {
  const priya = page.locator('[role="button"], a, li', { hasText: 'Priya Raman' }).first();
  const pbox = await priya.boundingBox();
  await actor.place(pbox.x + pbox.width + 260, pbox.y + 180);
  await start();
  await sleep(300);
  await actor.clickOn(priya, { moveMs: 750 });
  const composer = page.locator('textarea:visible').first();
  await composer.waitFor({ state: 'visible' });
  await sleep(500);
  await actor.clickOn(composer, { moveMs: 700 });
  await actor.move(actor.pos.x + 180, actor.pos.y + 14, 300);
  await actor.type('Love them, ship all three 😄');
  await page.keyboard.press('Enter');
  await sleep(600);
  await actor.showcase('typing', 'priya', { dmId: 'dm-priya' }, true);
  await sleep(1000);
  await actor.showcase('typing', 'priya', { dmId: 'dm-priya' }, false);
  await actor.showcase('say', 'priya', { dmId: 'dm-priya' }, 'yay!! 🎉 adding them to the release');
  await sleep(1700);
}

/** Phone: tap the composer, send "on my way to standup" in #dev, Aiko answers. */
async function phoneScene({ page, actor, start }) {
  const composer = page.locator('textarea').first();
  // A finger doesn't hover: keep the (invisible) pointer on the app bar and
  // jump straight to each tap, so no message row shows a hover highlight.
  await actor.place(195, 20);
  await start();
  await sleep(500);
  await actor.tap(composer);
  await sleep(300);
  await actor.type(TOUR_TEXT.standup);
  await sleep(250);
  // On touch layouts Enter inserts a newline; tap the send button like a person would.
  await actor.tap(page.locator('button:has([data-testid="SendIcon"])').last());
  await sleep(900);
  await actor.showcase('say', 'aiko', DEV, TOUR_TEXT.seeYou);
  await sleep(1500);
}

/**
 * Light theme, now in Standup (after "On my way to standup"): the Standup
 * crew talk in the sidebar while #dev stays open. The cursor drifts right to
 * left along the channel header, clear of message rows (hover toolbars) and
 * header buttons: `move` bows a rightward move downwards and a leftward one
 * upwards, so going right to left the arc rises into the empty app bar
 * instead of dipping into the message list.
 */
async function lightScene({ actor, start }) {
  // `showcaseStandupCrew` in src/stories/fixtures/showcase.ts.
  await actor.showcase('conversation', ['samira', 'marcus', 'aiko'], 1100);
  await actor.place(1000, 90);
  await sleep(300);
  await start();
  await actor.move(600, 92, 1600);
  await sleep(1600);
}

const SCENES = [
  { name: 'hero-chat', story: 'tour--chat', viewport: 'desktop', run: (c) => chatScene(c) },
  // Joins at the conversation's second step, so Priya, Diego (alone, then with
  // Priya) and Chloé all speak before the loop fades back to the start.
  { name: 'hero-voice', story: 'tour--voice', viewport: 'desktop', run: (c) => voiceScene(c, { ms: 4000, stepMs: 1000, lead: 900 }) },
  { name: 'tour-chat', story: 'tour--chat', viewport: 'desktop', run: (c) => chatScene(c, { long: true }) },
  { name: 'tour-dms', story: 'tour--dm-list', viewport: 'desktop', run: dmScene },
  // (#dev isn't on screen in the voice scene; replaying the chat there would only mark #dev unread.)
  { name: 'tour-voice', story: 'tour--voice', viewport: 'desktop', before: [afterTourDms], run: (c) => voiceScene(c, { ms: 5000 }) },
  { name: 'tour-phone', story: 'tour--chat', viewport: 'phone', before: [afterTourChat, afterTourDms], run: phoneScene },
  {
    name: 'tour-light', story: 'tour--chat-light-standup', viewport: 'desktop',
    before: [afterTourChat, afterTourDms, afterTourPhone], run: lightScene,
  },
];

// ─────────────────────────────────────────────────────────────────────────

async function recordScene(browser, scene) {
  const vp = VIEWPORTS[scene.viewport];
  const tmpDir = path.join(SCENES_DIR, `.tmp-${scene.name}`);
  await rm(tmpDir, { recursive: true, force: true });
  const context = await browser.newContext({
    ...vp,
    // recordVideo captures CSS pixels (deviceScaleFactor doesn't raise the
    // video resolution), so record at 1x and at exactly the viewport size.
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: SHOWCASE_TIMEZONE,
    permissions: ['notifications'],
    recordVideo: { dir: tmpDir, size: vp.viewport },
  });
  await context.clock.install({ time: new Date(SHOWCASE_NOW) });
  await context.addInitScript((css) => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, CAPTURE_CSS);
  await context.addInitScript(installCursor, scene.viewport === 'phone' ? 'touch' : 'arrow');

  const page = await context.newPage();
  const videoT0 = Date.now();
  const issues = watchPage(page);
  const actor = makeActor(page);
  let startAt = null;
  let error = null;
  let forbidden = [];
  try {
    await page.goto(storyUrl(scene.story), { waitUntil: 'networkidle', timeout: 45_000 });
    await waitForSettled(page, { settleMs: 1500 });
    await page.waitForFunction(() => !!window.__showcase, null, { timeout: 10_000 });
    if (scene.before?.length) {
      for (const step of scene.before) await step(actor);
      await sleep(1200);
    }
    await scene.run({
      page,
      actor,
      start: async () => {
        await sleep(200);
        startAt = (Date.now() - videoT0) / 1000;
      },
    });
    forbidden = await findForbiddenText(page);
  } catch (err) {
    error = String(err?.stack || err);
  }
  const endAt = (Date.now() - videoT0) / 1000;
  const video = page.video();
  await context.close();
  const out = path.join(SCENES_DIR, `${scene.name}.webm`);
  const src = await video.path();
  await rename(src, out);
  await rm(tmpDir, { recursive: true, force: true });
  return { name: scene.name, story: scene.story, viewport: scene.viewport, file: `${scene.name}.webm`, start: startAt ?? 0, end: endAt, error, forbidden, ...issues };
}

async function main() {
  await waitForLadle();
  await mkdir(SCENES_DIR, { recursive: true });
  const scenes = SCENES.filter((s) => !FILTER || s.name.includes(FILTER));
  const browser = await chromium.launch();
  const results = [];
  for (const scene of scenes) {
    process.stdout.write(`[media:record] ${scene.name} (${scene.story} @ ${scene.viewport}) ... `);
    const r = await recordScene(browser, scene);
    results.push(r);
    const problems = [
      r.error && `error: ${r.error.split('\n')[0]}`,
      r.pageErrors.length && `${r.pageErrors.length} page error(s)`,
      r.renderErrors.length && `${r.renderErrors.length} render error(s)`,
      r.unhandledRequests.length && `${r.unhandledRequests.length} unhandled request(s)`,
      r.forbidden.length && `forbidden text ${r.forbidden.join(', ')}`,
    ].filter(Boolean);
    console.log(`${(r.end - r.start).toFixed(1)}s ${problems.length ? `ISSUES: ${problems.join('; ')}` : 'ok'}`);
  }
  await browser.close();
  // Merge with any scenes recorded earlier (MEDIA_FILTER re-records a subset).
  let previous = [];
  try {
    const { readFile } = await import('node:fs/promises');
    previous = JSON.parse(await readFile(path.join(SCENES_DIR, 'scenes.json'), 'utf8')).scenes ?? [];
  } catch {
    // first run
  }
  const byName = new Map(previous.map((s) => [s.name, s]));
  for (const r of results) byName.set(r.name, r);
  const present = new Set((await readdir(SCENES_DIR)).filter((f) => f.endsWith('.webm')));
  const merged = SCENES.map((s) => byName.get(s.name)).filter((s) => s && present.has(s.file));
  await writeFile(path.join(SCENES_DIR, 'scenes.json'), JSON.stringify({ scenes: merged }, null, 2));
  // encode.sh reads plain "name start duration" lines (no jq in the ffmpeg image).
  await writeFile(
    path.join(SCENES_DIR, 'trims.txt'),
    merged.map((s) => `${s.name} ${s.start.toFixed(3)} ${(s.end - s.start).toFixed(3)}`).join('\n') + '\n',
  );
  const bad = results.filter((r) => r.error || r.pageErrors.length || r.renderErrors.length || r.forbidden.length);
  if (bad.length) console.log(`[media:record] ${bad.length} scene(s) with issues — see ${path.join(SCENES_DIR, 'scenes.json')}`);
}

main().catch((err) => {
  console.error('[media:record] Fatal:', err);
  process.exitCode = 1;
});
