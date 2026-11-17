import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The rich message pieces in a real browser, for what jsdom cannot show: nothing overflows a 390 px phone, a link
 * card's picture box keeps its 1.91:1 shape whether or not its picture arrived (so a late picture never moves the
 * list), a video draws no player before it is pressed, and the picture viewer fills the screen, holds Tab inside,
 * steps with the arrow keys and fits a tall picture in the height.
 */
const PHONE = { width: 390, height: 844 };

const pageOverflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

for (const story of ['kit-link-card--states', 'kit-attachment-tile--media-states', 'kit-media-viewer--several', 'kit-media-viewer--long-name']) {
  test(`${story}: no sideways scroll at 390 px`, async ({ page }) => {
    await openStory(page, story, PHONE);
    expect(await pageOverflows(page)).toBe(false);
  });
}

test('link card: the picture box is 1.91:1 with or without its picture; the cards fit the column', async ({ page }) => {
  await openStory(page, 'kit-link-card--states', PHONE);
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('a[target="_blank"], [role="group"]'))
      .map((card) => {
        const banner = Array.from(card.querySelectorAll<HTMLElement>('span')).find((s) => getComputedStyle(s).aspectRatio.includes('1.91'));
        const rect = card.getBoundingClientRect();
        return { right: rect.right, banner: banner ? banner.getBoundingClientRect() : null, loaded: !!banner?.querySelector('img') };
      })
      .filter((c) => c.banner !== null),
  );
  // The loaded card, the one still loading and the broken one.
  expect(boxes.length).toBe(3);
  for (const box of boxes) {
    expect(box.banner!.width / box.banner!.height).toBeCloseTo(1.91, 1);
    expect(box.right).toBeLessThanOrEqual(PHONE.width);
  }
});

test('video and audio: no player is drawn before Play is pressed', async ({ page }) => {
  await openStory(page, 'kit-attachment-tile--media-states', PHONE);
  await expect(page.getByRole('button', { name: 'Play video clip.mp4, 12 MB' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play audio voice-note.ogg, 420 KB' })).toBeVisible();
  // Only the story's one playing video and one playing audio exist as elements.
  expect(await page.locator('video').count()).toBe(1);
  expect(await page.locator('audio').count()).toBe(1);
  const box = await page.getByRole('button', { name: 'Play video clip.mp4, 12 MB' }).boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
});

test('viewer: fills the screen, holds Tab inside, steps with the arrows; a tall picture fits the height', async ({ page }) => {
  await openStory(page, 'kit-media-viewer--several', PHONE);
  const dialog = page.getByRole('dialog', { name: 'sunset.png' });
  await expect(dialog).toBeVisible();
  const rect = await dialog.boundingBox();
  expect(rect).toEqual({ x: 0, y: 0, width: PHONE.width, height: PHONE.height });
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'tall.png' })).toBeVisible();
  const picture = await page.getByRole('img', { name: 'tall.png' }).boundingBox();
  expect(picture!.y).toBeGreaterThanOrEqual(0);
  expect(picture!.y + picture!.height).toBeLessThanOrEqual(PHONE.height);
  expect(picture!.width).toBeLessThanOrEqual(PHONE.width);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'sunset.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
