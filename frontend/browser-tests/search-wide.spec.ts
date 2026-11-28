import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The chat's search at tablet and desktop widths (PR 10e, B9), in a real browser: at desktop the right island beside
 * the live channel, the members under it hidden and inert, and only the results scroll (the heading and field stay);
 * at tablet a filling Sheet; a result jumps with the panel kept; Escape closes it and focus goes back to More; and a
 * width change keeps the search.
 */
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 820, height: 1180 };

const field = (page: Page) => page.getByRole('searchbox', { name: 'Search messages' });

test('desktop: the search is the right island beside the channel; only the results scroll', async ({ page }) => {
  await openStory(page, 'channel-chat--search-many-results', DESKTOP);
  const aside = page.getByRole('complementary', { name: 'Search messages' });
  await expect(aside).toBeVisible();
  await expect(aside.getByRole('button', { name: /^Show the message from/ })).toHaveCount(20);
  const state = await page.evaluate(() => {
    const under = document.querySelector<HTMLElement>('[data-right-under]');
    const body = document.querySelector<HTMLElement>('[data-kit-panel-pane-body]')!;
    const aside = document.querySelector('aside')!.getBoundingClientRect();
    const main = document.querySelector('main')!.getBoundingClientRect();
    return {
      underHidden: under?.hidden === true,
      underInert: under?.inert === true,
      besideMain: aside.left >= main.right,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      asideFillsHeight: Math.abs(aside.height - main.height) < 2,
    };
  });
  expect(state).toEqual({ underHidden: true, underInert: true, besideMain: true, bodyScrolls: true, asideFillsHeight: true });
  // Scrolled to the end, the heading and the field are still in view.
  await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('[data-kit-panel-pane-body]')!;
    body.scrollTop = body.scrollHeight;
  });
  await expect(aside.getByRole('heading', { level: 2, name: 'Search messages' })).toBeInViewport();
  await expect(field(page)).toBeInViewport();
});

test('desktop: a result jumps and the panel stays; Escape closes it and focus goes back to More', async ({ page }) => {
  await openStory(page, 'channel-chat--search-results', DESKTOP);
  const aside = page.getByRole('complementary', { name: 'Search messages' });
  const first = aside.getByRole('button', { name: /same time tomorrow/ });
  await first.click();
  await expect(aside).toBeVisible();
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Members' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More' })).toBeFocused();
});

test('tablet: the search is a filling Sheet; a width change to desktop and back keeps the text', async ({ page }) => {
  await openStory(page, 'channel-chat--search-results', TABLET);
  const sheet = page.getByRole('dialog', { name: 'Search messages' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Close search' })).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.height).toBeGreaterThan(TABLET.height * 0.8);
  await expect(field(page)).toHaveValue('run');
  await page.setViewportSize(DESKTOP);
  await expect(page.getByRole('complementary', { name: 'Search messages' })).toBeVisible();
  await expect(field(page)).toHaveValue('run');
  await page.setViewportSize(TABLET);
  await expect(page.getByRole('dialog', { name: 'Search messages' })).toBeVisible();
  await expect(field(page)).toHaveValue('run');
});
