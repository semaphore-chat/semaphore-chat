import { expect, test } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * MediaTile in small boxes: the avatar steps down (container queries on the tile's own width) so that nothing
 * drawn inside is cut off by the rounded frame, from full width down to 120 px.
 */
async function overflowing(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="group"]')).flatMap((tile) => {
      const box = tile.getBoundingClientRect();
      return Array.from(tile.querySelectorAll<HTMLElement>('*'))
        .filter((element) => element.tagName !== 'VIDEO' && element.getClientRects().length > 0)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1);
        })
        .map((element) => `${Math.round(box.width)}px tile: <${element.tagName.toLowerCase()}> ${element.textContent}`);
    }),
  );
}

test('avatar tiles from 120 px to full width: nothing is cut off by the frame', async ({ page }) => {
  await openStory(page, 'kit-media-tile--small-tiles', { width: 800, height: 900 });
  expect(await overflowing(page)).toEqual([]);
});

test('two avatar tiles on a phone: nothing is cut off', async ({ page }) => {
  await openStory(page, 'kit-media-tile--phone-pair', { width: 390, height: 844 });
  expect(await overflowing(page)).toEqual([]);
});

test('exactly one avatar is drawn at each size, and the name goes only in the smallest tile', async ({ page }) => {
  await openStory(page, 'kit-media-tile--small-tiles', { width: 800, height: 900 });
  const sizes = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="group"][aria-label="dropbear"]')).map((tile) => {
      const shown = Array.from(tile.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')).filter(
        (element) => element.textContent === 'DR' && element.getClientRects().length > 0,
      );
      const label = Array.from(tile.querySelectorAll<HTMLElement>('span')).find((element) => element.textContent === 'dropbear');
      return {
        tile: Math.round(tile.getBoundingClientRect().width),
        avatars: shown.length,
        avatarWidth: shown[0] ? Math.round(shown[0].getBoundingClientRect().width) : 0,
        label: !!label && label.getClientRects().length > 0,
      };
    }),
  );
  const byTile = Object.fromEntries(sizes.map((size) => [size.tile, size]));
  expect(byTile[120]).toMatchObject({ avatars: 1, label: false });
  expect(byTile[160]).toMatchObject({ avatars: 1, label: true });
  expect(byTile[160].avatarWidth).toBeLessThan(byTile[220].avatarWidth);
  expect(byTile[180].avatarWidth).toBeGreaterThan(byTile[160].avatarWidth);
  expect(byTile[220]).toMatchObject({ avatars: 1, label: true });
});
