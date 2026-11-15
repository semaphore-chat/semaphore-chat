import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The new shell's dock (shell/lounge/pieces/ShellDock.tsx) in the chat template, in a real browser: one Tab stop
 * on the current community, Left/Right/Home/End and typeahead along Inbox, every community and All, Enter follows a
 * community's link, the current one of sixty is in view, and on a phone the dock is the bottom bar and clears the
 * home indicator.
 */
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };

const dock = (page: Page) => page.getByRole('navigation', { name: 'Communities' });
const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

/** Tab from the page start until focus is in the dock. */
async function tabIntoDock(page: Page): Promise<void> {
  for (let presses = 0; presses < 40; presses += 1) {
    await page.keyboard.press('Tab');
    if (await dock(page).evaluate((nav) => nav.contains(document.activeElement))) return;
  }
  throw new Error('Tab never reached the dock');
}

const inBar = (page: Page, href: string) =>
  dock(page).evaluate((nav, target) => {
    const item = nav.querySelector<HTMLElement>(`a[href="${target}"]`);
    const region = nav.querySelector<HTMLElement>('[data-kit-dock-scroll]');
    if (!item || !region) return false;
    const box = region.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    return rect.left >= box.left - 1 && rect.right <= box.right + 1;
  }, href);

test.describe('the dock @keyboard', () => {
  test('one Tab stop on the current community; the next Tab leaves the dock', async ({ page }) => {
    await openStory(page, 'shell-dock--twelve', TABLET);
    const stops = await dock(page).evaluate((nav) =>
      [...nav.querySelectorAll('a, button')].filter((element) => element.getAttribute('tabindex') !== '-1').length,
    );
    expect(stops).toBe(1);
    await tabIntoDock(page);
    expect(await focusedName(page)).toBe('Night Owls, current');
    await page.keyboard.press('Tab');
    expect(await dock(page).evaluate((nav) => nav.contains(document.activeElement))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    expect(await focusedName(page)).toBe('Night Owls, current');
  });

  test('Left, Right, Home, End and typing a name move along Inbox, the communities and All', async ({ page }) => {
    await openStory(page, 'shell-dock--twelve', TABLET);
    await tabIntoDock(page);
    await page.keyboard.press('ArrowRight');
    expect(await focusedName(page)).toBe('Tabletop Tuesdays');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await focusedName(page)).toBe('Design Guild');
    await page.keyboard.press('Home');
    expect(await focusedName(page)).toBe('Inbox, 9 unread');
    await page.keyboard.press('End');
    expect(await focusedName(page)).toBe('All communities');
    await page.keyboard.press('Home');
    await page.keyboard.type('lu');
    expect(await focusedName(page)).toBe('Lumen Studio, 2 mentions');
  });

  test("Enter on a community follows its link to the community's route", async ({ page }) => {
    await openStory(page, 'shell-dock--twelve', TABLET);
    await tabIntoDock(page);
    await page.keyboard.press('Home');
    // Inbox, then Couch Co-op, Trailheads, Lumen Studio, Friday LAN (letters like f are Ladle's own shortcuts)
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowRight');
    expect(await focusedName(page)).toBe('Friday LAN, new messages');
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).hash).toBe('#/community/c-4');
  });

  test('sixty communities: the current one (near the end) is in view; the page itself does not scroll sideways', async ({ page }) => {
    await openStory(page, 'shell-dock--sixty', PHONE);
    await expect.poll(() => inBar(page, '#/community/c-55')).toBe(true);
    expect(await inBar(page, '#/community/c-1')).toBe(false);
    await tabIntoDock(page);
    expect(await focusedName(page)).toMatch(/, current/);
    // Home is the Inbox (fixed, outside the scrolling region); the next item is the first community, scrolled to.
    await page.keyboard.press('Home');
    expect(await focusedName(page)).toBe('Inbox, 9 unread');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => dock(page).evaluate((nav) => nav.querySelector('[data-kit-dock-scroll]')!.scrollLeft)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('where the dock sits', () => {
  /** Whether a rule that applies to the dock asks for the home-indicator inset as its bottom margin. */
  const clearsHomeIndicator = (page: Page) =>
    dock(page).evaluate((nav) => {
      const rules: string[] = [];
      for (const sheet of [...document.styleSheets]) {
        let list: CSSRuleList;
        try {
          list = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of [...list]) {
          if (rule instanceof CSSStyleRule && nav.matches(rule.selectorText)) rules.push(rule.style.marginBottom);
        }
      }
      return rules.some((value) => value.includes('safe-area-inset-bottom'));
    });

  test('phone: the bottom bar, last on the screen, clear of the home indicator', async ({ page }) => {
    await openStory(page, 'shell-dock--mentions-and-new', PHONE);
    const box = await dock(page).boundingBox();
    expect(box).not.toBeNull();
    // At the bottom: nothing of the frame below it but the frame's own padding.
    expect(PHONE.height - (box!.y + box!.height)).toBeLessThan(40);
    expect(box!.y).toBeGreaterThan(PHONE.height / 2);
    expect(await clearsHomeIndicator(page)).toBe(true);
  });

  test('tablet: above the left island, and no home-indicator margin there', async ({ page }) => {
    await openStory(page, 'shell-dock--mentions-and-new', TABLET);
    const bar = await dock(page).boundingBox();
    const left = await page.getByRole('navigation', { name: 'Couch Co-op' }).boundingBox();
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(left!.y);
    expect(await clearsHomeIndicator(page)).toBe(false);
  });
});

/**
 * Inbox and All are always fully on screen, and no badge or dot is cut by the scrolling region: for every item wholly
 * inside the region, its badge and dot are inside it too (and the Inbox's badge inside the bar).
 */
const geometry = (page: Page) =>
  dock(page).evaluate((nav) => {
    const inside = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
    const viewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const region = nav.querySelector<HTMLElement>('[data-kit-dock-scroll]')!;
    // The region less its inset: an item reaching into the inset sits under the edge fade, mid-scroll.
    const outerBox = region.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(region).paddingLeft);
    const regionBox = new DOMRect(outerBox.left + inset, outerBox.top, outerBox.width - 2 * inset, outerBox.height);
    const inbox = nav.querySelector<HTMLElement>('button[aria-label^="Inbox"]')!;
    const all = nav.querySelector<HTMLElement>('button[aria-label="All communities"]')!;
    const clipped: string[] = [];
    let checked = 0;
    for (const item of nav.querySelectorAll<HTMLElement>('[data-kit-dock-scroll] a')) {
      if (!inside(regionBox, item.getBoundingClientRect())) continue;
      for (const mark of item.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')) {
        checked += 1;
        if (!inside(outerBox, mark.getBoundingClientRect())) clipped.push(item.getAttribute('aria-label') ?? '?');
      }
    }
    const inboxBadge = inbox.querySelector<HTMLElement>('span[aria-hidden="true"]');
    return {
      inboxOnScreen: inside(viewport, inbox.getBoundingClientRect()) && !region.contains(inbox),
      allOnScreen: inside(viewport, all.getBoundingClientRect()) && !region.contains(all),
      inboxBadgeInBar: inboxBadge !== null && inside(nav.getBoundingClientRect(), inboxBadge.getBoundingClientRect()),
      clipped,
      checked,
    };
  });

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
];

test.describe('Inbox and All always visible, no badge clipped', () => {
  for (const story of ['shell-dock--twelve', 'shell-dock--sixty', 'shell-dock--mentions-and-new']) {
    for (const view of WIDTHS) {
      test(`${story} at ${view.width}`, async ({ page }) => {
        await openStory(page, story, view);
        const result = await geometry(page);
        expect(result).toMatchObject({ inboxOnScreen: true, allOnScreen: true, inboxBadgeInBar: true, clipped: [] });
      });
    }
  }

  for (const [story, measuredAt] of [
    ['shell-dock--twelve', 'start'],
    ['shell-dock--mentions-and-new', 'end'],
  ] as const) {
    test(`${story}: scrolled to the start, then the end, Inbox and All stay and no badge is clipped at either edge`, async ({ page }) => {
      await openStory(page, story, { width: 1440, height: 900 });
      for (const to of ['start', 'end'] as const) {
        await dock(page).evaluate((nav, where) => {
          const region = nav.querySelector<HTMLElement>('[data-kit-dock-scroll]')!;
          region.scrollLeft = where === 'start' ? 0 : region.scrollWidth;
        }, to);
        await expect.poll(async () => (await geometry(page)).clipped).toEqual([]);
        const result = await geometry(page);
        expect(result.inboxOnScreen && result.allOnScreen).toBe(true);
        // twelve: Lumen Studio's count and Friday LAN's dot at the start; five: Wavelength's count at the end.
        if (to === measuredAt) expect(result.checked).toBeGreaterThan(0);
      }
    });
  }

  test('a cue that more communities exist: the edge with more beyond it is faded', async ({ page }) => {
    await openStory(page, 'shell-dock--twelve', { width: 1440, height: 900 });
    const mask = () =>
      dock(page).evaluate((nav) => {
        const region = nav.querySelector<HTMLElement>('[data-kit-dock-scroll]')!;
        const style = getComputedStyle(region);
        return style.maskImage || style.getPropertyValue('-webkit-mask-image');
      });
    await dock(page).evaluate((nav) => {
      nav.querySelector<HTMLElement>('[data-kit-dock-scroll]')!.scrollLeft = 0;
    });
    await expect.poll(mask).toMatch(/(transparent|rgba\(0, 0, 0, 0\)) 100%\)$/);
    await dock(page).evaluate((nav) => {
      const region = nav.querySelector<HTMLElement>('[data-kit-dock-scroll]')!;
      region.scrollLeft = region.scrollWidth;
    });
    await expect.poll(mask).toMatch(/^linear-gradient\(to right, (transparent|rgba\(0, 0, 0, 0\)) 0/);
  });
});
