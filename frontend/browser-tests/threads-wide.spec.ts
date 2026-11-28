import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * Threads at tablet and desktop widths (PR 10e), in a real browser: at desktop the thread is the right island beside
 * the live channel, the members kept under it hidden and inert; at tablet it is a filling Sheet; and a width change
 * from desktop to tablet with a half-typed reply keeps the reply.
 */
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 820, height: 1180 };

const focusedHeading = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? null, text: el?.textContent?.trim() ?? null, inAside: el?.closest('aside') != null };
  });

test('desktop: the thread is the right island beside the live channel; the members under it are hidden and inert', async ({ page }) => {
  await openStory(page, 'channel-chat--thread-open', DESKTOP);
  await expect.poll(() => focusedHeading(page), { timeout: 5_000 }).toEqual({ tag: 'H2', text: 'Thread', inAside: true });
  const aside = page.getByRole('complementary', { name: 'Thread' });
  await expect(aside).toBeVisible();
  const state = await page.evaluate(() => {
    const under = document.querySelector<HTMLElement>('[data-right-under]');
    const channelRows = [...document.querySelectorAll<HTMLElement>('main [data-message-id]')];
    const aside = document.querySelector('aside')!.getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    return {
      underHidden: under?.hidden === true,
      underInert: under?.inert === true,
      channelLive: channelRows.length > 0 && channelRows.every((row) => row.closest('[inert]') === null),
      besideMain: aside.left >= main.right,
      asideFillsHeight: Math.abs(aside.height - main.height) < 2,
    };
  });
  expect(state).toEqual({ underHidden: true, underInert: true, channelLive: true, besideMain: true, asideFillsHeight: true });
  // No Back at desktop: the community's list is on screen.
  await expect(page.getByRole('button', { name: 'Back to the community' })).toHaveCount(0);
  // Close gives focus back to the chat, never the page.
  await page.getByRole('button', { name: 'Close thread' }).click();
  await expect(page.getByRole('complementary', { name: 'Members' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test('tablet: the thread is a filling Sheet with its own header, list and composer', async ({ page }) => {
  await openStory(page, 'channel-chat--thread-open', TABLET);
  const sheet = page.getByRole('dialog', { name: 'Thread' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Close thread' })).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Reply in thread' })).toBeVisible();
  const box = await sheet.boundingBox();
  // Most of the viewport's height, not a short centred box.
  expect(box!.height).toBeGreaterThan(TABLET.height * 0.8);
});

test('a width change from desktop to tablet keeps a half-typed reply in the thread', async ({ page }) => {
  await openStory(page, 'channel-chat--thread-open', DESKTOP);
  const field = page.getByRole('complementary', { name: 'Thread' }).getByRole('textbox', { name: 'Reply in thread' });
  await field.click();
  await field.pressSequentially('see you at 9:15');
  await page.setViewportSize(TABLET);
  const inSheet = page.getByRole('dialog', { name: 'Thread' }).getByRole('textbox', { name: 'Reply in thread' });
  await expect(inSheet).toHaveValue('see you at 9:15');
  await page.setViewportSize(DESKTOP);
  await expect(page.getByRole('complementary', { name: 'Thread' }).getByRole('textbox', { name: 'Reply in thread' })).toHaveValue('see you at 9:15');
});
