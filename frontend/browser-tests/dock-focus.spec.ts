import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * A Dock on the list focus host in a real browser: with 12 and 60 items the bar is one Tab stop, the arrows, Home
 * and End move focus along it, and the focused (and the current) item is scrolled into view inside the bar, without
 * scrolling the page.
 */
const VIEW = { width: 390, height: 700 };

const bar = (page: Page) => page.getByRole('navigation', { name: 'Pinned communities' });
const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
const inView = (page: Page, name: string | RegExp) =>
  bar(page).evaluate(
    (nav, target) => {
      const matches = (label: string) => (target.regex ? new RegExp(target.text).test(label) : label === target.text);
      const item = Array.from(nav.querySelectorAll<HTMLElement>('[aria-label]')).find((element) =>
        matches(element.getAttribute('aria-label') ?? ''),
      );
      if (!item) return false;
      const box = nav.getBoundingClientRect();
      const rect = item.getBoundingClientRect();
      return rect.left >= box.left - 1 && rect.right <= box.right + 1;
    },
    typeof name === 'string' ? { regex: false, text: name } : { regex: true, text: name.source },
  );

for (const story of ['kit-dock--focus-twelve', 'kit-dock--focus-sixty']) {
  test.describe(`${story} @keyboard`, () => {
    test('one Tab stop on the current item; the next Tab leaves the bar', async ({ page }) => {
      await openStory(page, story, VIEW);
      const stops = await bar(page).evaluate((nav) => nav.querySelectorAll('button[tabindex="0"], a[tabindex="0"]').length);
      expect(stops).toBe(1);
      await page.keyboard.press('Tab');
      expect(await focusedName(page)).toMatch(/, current/);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'After the dock' })).toBeFocused();
      expect(await bar(page).evaluate((nav) => nav.contains(document.activeElement))).toBe(false);
      await page.keyboard.press('Shift+Tab');
      expect(await focusedName(page)).toMatch(/, current/);
    });

    test('arrows, Home and End move along the bar and keep the focused item in view; the page does not scroll', async ({ page }) => {
      await openStory(page, story, VIEW);
      await page.keyboard.press('Tab');
      const current = await focusedName(page);
      expect(await inView(page, current ?? '')).toBe(true);
      await page.keyboard.press('ArrowRight');
      expect(await focusedName(page)).not.toBe(current);
      await page.keyboard.press('ArrowLeft');
      expect(await focusedName(page)).toBe(current);
      await page.keyboard.press('End');
      expect(await focusedName(page)).toBe('All communities');
      expect(await inView(page, 'All communities')).toBe(true);
      await page.keyboard.press('Home');
      expect(await focusedName(page)).toBe('Inbox');
      expect(await inView(page, 'Inbox')).toBe(true);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });
}

test('60 items: the current item is in view when the bar first shows, and the bar scrolls sideways', async ({ page }) => {
  await openStory(page, 'kit-dock--focus-sixty', VIEW);
  expect(await inView(page, /, current/)).toBe(true);
  expect(await bar(page).evaluate((nav) => nav.scrollLeft > 0 && nav.scrollWidth > nav.clientWidth)).toBe(true);
});
