import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The "All communities" sheet (shell/lounge/pieces/AllCommunitiesSheet.tsx) opened from the dock in a real browser:
 * focus lands on Close, Tab reaches the filter and then the list, the filter narrows it, Escape returns focus to
 * All, and on a phone it is a bottom sheet over the dock.
 */
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };

const dock = (page: Page) => page.getByRole('navigation', { name: 'Communities' });
// By CSS: while the sheet is open the page behind it is hidden from the accessibility tree.
const all = (page: Page) => page.locator('nav[aria-label="Communities"] button[aria-label="All communities"]');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'All communities' });

async function openFromAll(page: Page): Promise<void> {
  await all(page).focus();
  await page.keyboard.press('Enter');
  await expect(sheet(page)).toBeVisible();
}

test.describe('the sheet from the dock @keyboard', () => {
  test('opens from All with focus on Close; Tab reaches the filter, then the current row; Escape returns to All', async ({ page }) => {
    await openStory(page, 'all-communities-sheet--from-dock', TABLET);
    await expect(all(page)).toHaveAttribute('aria-expanded', 'false');
    await openFromAll(page);
    await expect(all(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(sheet(page).getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sheet(page).getByRole('searchbox', { name: 'Find a community' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sheet(page).getByRole('link', { name: /^Couch Co-op/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(sheet(page).getByRole('link', { name: /^Trailheads/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(all(page)).toBeFocused();
  });

  test('the filter narrows the list by name, and says when nothing matches', async ({ page }) => {
    await openStory(page, 'all-communities-sheet--from-dock', TABLET);
    await openFromAll(page);
    const field = sheet(page).getByRole('searchbox', { name: 'Find a community' });
    await field.fill('lan');
    const communityLinks = sheet(page).locator('a[href^="#/community/c-"]');
    await expect(communityLinks).toHaveCount(1);
    await expect(communityLinks.first()).toHaveAttribute('href', '#/community/c-4');
    // Typing in the field is not the list's typeahead: the letters stay in the field.
    await expect(field).toHaveValue('lan');
    await field.fill('zebra');
    await expect(sheet(page).getByText('No community called “zebra”')).toBeVisible();
    await expect(communityLinks).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test('a full-width bottom sheet over the dock, with Settings and Your profile at the foot', async ({ page }) => {
    await openStory(page, 'all-communities-sheet--from-dock', PHONE);
    const bar = await dock(page).boundingBox();
    await openFromAll(page);
    await expect
      .poll(async () => {
        const box = await sheet(page).boundingBox();
        return box && { left: Math.round(box.x), width: Math.round(box.width), bottom: Math.round(box.y + box.height) };
      })
      .toEqual({ left: 0, width: PHONE.width, bottom: PHONE.height });
    // Over the dock: what is drawn at the dock's centre is the sheet, not the dock.
    const onTop = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return {
          inSheet: hit?.closest('[role="dialog"]') !== null,
          inDock: hit?.closest('nav[aria-label="Communities"]') !== null,
        };
      },
      { x: bar!.x + bar!.width / 2, y: bar!.y + bar!.height / 2 },
    );
    expect(onTop).toEqual({ inSheet: true, inDock: false });
    await expect(sheet(page).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
    await expect(sheet(page).getByRole('link', { name: 'Your profile' })).toHaveAttribute('href', '#/profile');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(all(page)).toBeFocused();
  });
});

test('sixty communities: opens with the current row in view, the heading and filter still in view, the page not scrolled', async ({ page }) => {
  for (const view of [PHONE, TABLET, { width: 1440, height: 900 }]) {
    await openStory(page, 'all-communities-sheet--sixty', view);
    await expect(sheet(page)).toBeVisible();
    const row = sheet(page).locator('a[aria-current="page"]');
    await expect(row).toHaveAttribute('href', '#/community/c-55');
    await expect
      .poll(() =>
        sheet(page).evaluate((dialog) => {
          const body = dialog.querySelector<HTMLElement>('[data-kit-sheet-body]')!;
          const current = dialog.querySelector<HTMLElement>('a[aria-current="page"]')!;
          const field = dialog.querySelector<HTMLElement>('input[type="search"]')!;
          const panel = dialog.getBoundingClientRect();
          const outer = body.getBoundingClientRect();
          const inner = current.getBoundingClientRect();
          const filter = field.getBoundingClientRect();
          return {
            scrolledToCurrent: body.scrollTop > 0,
            currentInBody: inner.top >= outer.top && inner.bottom <= outer.bottom,
            filterInPanel: filter.top >= panel.top && filter.bottom <= outer.top + 1,
            pageScroll: window.scrollY + document.documentElement.scrollTop,
          };
        }),
      )
      .toEqual({ scrolledToCurrent: true, currentInBody: true, filterInPanel: true, pageScroll: 0 });
  }
});
