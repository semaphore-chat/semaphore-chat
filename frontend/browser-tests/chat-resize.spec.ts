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


test('at the newest message, a resize to tablet width and back to a phone keeps the newest in view', async ({ page }) => {
  await openStory(page, STORY, PHONE);
  await expect(row(page, 40)).toBeInViewport();
  for (const view of [TABLET, PHONE, TABLET, PHONE]) {
    await page.setViewportSize(view);
    await expect(row(page, 40), `${view.width}px`).toBeInViewport();
    await expect.poll(() => belowEnd(page), `${view.width}px`).toBeLessThan(2);
  }
});

// #930: on a slow CPU the browser's scroll event for clamping `scrollTop` after the list got taller comes before
// virtua records the new viewport size. Pinned from virtua's numbers, the reader at the newest looked 412 px above the
// bottom, was unpinned, and the next shrink left them stranded (the newest row out of the window: "element(s) not
// found"). Throttled 6x this failed nine runs in ten before the fix. Chromium only (CDP), like the kit's other specs.
test('at the newest message on a slow CPU, resizes across the phone boundary keep the newest in view', async ({ page }) => {
  await openStory(page, STORY, PHONE);
  await expect(row(page, 40)).toBeInViewport();
  // Slowed once the list is open: the race is in the resizes. Waits are longer to match (the full suite runs in
  // parallel on top of the throttling).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const slow = { timeout: 15_000 };
  for (const view of [TABLET, PHONE, TABLET, PHONE, TABLET, PHONE]) {
    await page.setViewportSize(view);
    await expect(row(page, 40), `${view.width}px`).toBeInViewport(slow);
    await expect.poll(() => belowEnd(page), { ...slow, message: `${view.width}px` }).toBeLessThan(2);
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
  // To the very top first, so virtua has measured every row, as the e2e does: the older page's rows are estimated
  // until they render, and the first one moving the day separator up re-measures a row 42 px shorter, which can
  // throw the reader to the bottom (virtua, before and after #930).
  for (let i = 0; i < 40 && !(await row(page, 1).isVisible()); i += 1) await page.mouse.wheel(0, -400);
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, -400);
  for (let i = 0; i < 20 && !(await older.isVisible()); i += 1) await page.mouse.wheel(0, 200);
  // Then in the middle of the view: rendered (isVisible) can still be outside it, or at its edge, only a few rows
  // above the end, where the taller list clamps the reader to the bottom, which counts as pinned (MessageListCore).
  await older.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(older).toBeInViewport();
  await expect(row(page, 40)).not.toBeInViewport();
  // Well up: further from the end than the list grows at tablet width.
  expect(await belowEnd(page)).toBeGreaterThan(tabletHeight - phoneHeight);

  for (const view of [TABLET, PHONE]) {
    await page.setViewportSize(view);
    await expect.poll(() => listHeight(page), `${view.width}px`).toBe(view === PHONE ? phoneHeight : tabletHeight);
    await expect(older, `${view.width}px`).toBeInViewport();
    if (view === PHONE) await expect(row(page, 40), `${view.width}px`).not.toBeInViewport();
  }
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
