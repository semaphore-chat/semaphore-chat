import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The chat list keeps the reader's place when it changes height (#921), in a real browser on the Lounge chat with
 * forty one-line messages: across the phone boundary (390 px, 820 px and back: the list's height changes but no row
 * does), and when the composer grows with a longer draft. A reader at the newest message stays there; a reader who
 * scrolled up keeps the older message in view and is not pulled to the bottom.
 */
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };
const STORY = 'channel-chat--many-messages';

const row = (page: Page, n: number) =>
  page.getByRole('list', { name: 'Messages' }).getByRole('article').filter({ hasText: new RegExp(`numbered message ${n}$`) });

/** How far the list's end is below its viewport, in px (0 at the newest message). */
const belowEnd = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="list"][aria-label="Messages"]')!;
    return Math.round(list.scrollHeight - list.scrollTop - list.clientHeight);
  });

/** The list's laid-out height, for waiting out a viewport change before asserting on the scroll position. */
const listHeight = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>('[role="list"][aria-label="Messages"]')!.clientHeight);

/** The number of the message at the top of the list's view. */
const topVisibleNumber = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="list"][aria-label="Messages"]')!;
    const { top, bottom } = list.getBoundingClientRect();
    for (const article of Array.from(list.querySelectorAll('[role="article"]'))) {
      const rect = article.getBoundingClientRect();
      if (rect.bottom > top + 1 && rect.top < bottom) {
        const match = /numbered message (\d+)\s*$/.exec(article.textContent ?? '');
        if (match) return Number(match[1]);
      }
    }
    return -1;
  });

test('at the newest message, a resize to tablet width and back to a phone keeps the newest in view', async ({ page }) => {
  await openStory(page, STORY, PHONE);
  await expect(row(page, 40)).toBeInViewport();
  for (const view of [TABLET, PHONE, TABLET, PHONE]) {
    await page.setViewportSize(view);
    await expect(row(page, 40), `${view.width}px`).toBeInViewport();
    await expect.poll(() => belowEnd(page), `${view.width}px`).toBeLessThan(2);
  }
});

test('scrolled up to an older message, a resize to tablet width and back to a phone keeps that message in view', async ({ page }) => {
  await openStory(page, STORY, PHONE);
  await expect(row(page, 40)).toBeInViewport();
  // The list's height at each width, so the loop below can wait for a resize to be laid out before asserting.
  const phoneHeight = await listHeight(page);
  await page.setViewportSize(TABLET);
  await expect.poll(() => listHeight(page)).toBeGreaterThan(phoneHeight);
  const tabletHeight = await listHeight(page);
  await page.setViewportSize(PHONE);
  await expect.poll(() => listHeight(page)).toBe(phoneHeight);

  const list = page.getByRole('list', { name: 'Messages' });
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const older = row(page, 24);
  for (let i = 0; i < 20 && !(await older.isVisible()); i += 1) await page.mouse.wheel(0, -200);
  await older.scrollIntoViewIfNeeded();
  await expect(older).toBeInViewport();
  await expect(row(page, 40)).not.toBeInViewport();

  for (const view of [TABLET, PHONE]) {
    await page.setViewportSize(view);
    await expect.poll(() => listHeight(page), `${view.width}px`).toBe(view === PHONE ? phoneHeight : tabletHeight);
    await expect(older, `${view.width}px`).toBeInViewport();
    if (view === PHONE) await expect(row(page, 40), `${view.width}px`).not.toBeInViewport();
  }
});

test('a growth that clamps the list to the bottom does not pin a reader who was scrolled up', async ({ page }) => {
  await openStory(page, STORY, PHONE);
  await expect(row(page, 40)).toBeInViewport();
  await expect.poll(() => belowEnd(page)).toBeLessThan(2);
  const phoneHeight = await listHeight(page);

  const list = page.getByRole('list', { name: 'Messages' });
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Scroll through the whole list once: virtua measures the older page's prepended rows on the way, so the list's
  // total (and every offset in it) is real, not an estimate, when the clamp below happens.
  for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, -200);
  await page.mouse.wheel(0, 100_000);
  await expect.poll(() => belowEnd(page)).toBeLessThan(2);
  await page.mouse.wheel(0, -150);
  await expect.poll(() => belowEnd(page), '150 px above the newest').toBe(150);
  const top = await topVisibleNumber(page);
  expect(top).toBeGreaterThan(0);

  // Tablet height grows past the reader's distance from the bottom: the browser clamps their offset to the
  // bottom, and the scroll event that follows is the clamp's, not theirs.
  await page.setViewportSize(TABLET);
  await expect.poll(() => listHeight(page)).toBeGreaterThan(phoneHeight);
  await expect.poll(() => belowEnd(page)).toBeLessThan(2);

  // Back at phone height they must be back at their place (150 px above the newest, where they left it), not at
  // the newest message and not anywhere else the clamp left them.
  await page.setViewportSize(PHONE);
  await expect.poll(() => listHeight(page)).toBe(phoneHeight);
  await expect.poll(() => belowEnd(page), 'back at their place').toBe(150);
  await expect(row(page, top)).toBeInViewport();
});

test('at the newest message, a draft that grows the composer keeps the newest in view', async ({ page }) => {
  await openStory(page, STORY, PHONE);
  await expect(row(page, 40)).toBeInViewport();
  await expect.poll(() => belowEnd(page)).toBeLessThan(2);
  const list = page.getByRole('list', { name: 'Messages' });
  const before = (await list.boundingBox())!.height;
  await page.getByRole('textbox', { name: /^Message/ }).fill('one\ntwo\nthree\nfour\nfive');
  await expect.poll(async () => (await list.boundingBox())!.height).toBeLessThan(before - 40);
  await expect.poll(() => belowEnd(page)).toBeLessThan(2);
});
