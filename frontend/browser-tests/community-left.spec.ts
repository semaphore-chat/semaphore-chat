import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The community left island (shell/lounge/pieces/community) in a real browser: the channel list is one
 * Tab stop with arrows, Home, End and typeahead; the voice cards' Join and Leave and the user card's
 * Settings are reached with Tab; nothing scrolls sideways at 320 px.
 */
const PHONE = { width: 320, height: 700 };
const TABLET = { width: 820, height: 1180 };

const island = (page: Page) => page.getByRole('navigation', { name: 'Couch Co-op' });
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
const focusedName = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? null);

/** Tab until `name` has focus (at most `max` presses); returns the presses it took. */
async function tabTo(page: Page, name: string, max = 30): Promise<number> {
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press('Tab');
    if ((await focusedName(page)) === name) return i;
  }
  throw new Error(`${name} not reached with Tab`);
}

test.describe('community-left @keyboard', () => {
  test('the channel list is one Tab stop; arrows, Home, End and typeahead move in it; Tab leaves it', async ({ page }) => {
    await openStory(page, 'community-left--five-channels', TABLET);
    const links = island(page).getByRole('link');
    expect(await links.evaluateAll((all) => all.filter((a) => (a as HTMLElement).tabIndex === 0).length)).toBe(1);
    await tabTo(page, 'Couch Co-op, community menu');
    await page.keyboard.press('Tab');
    // The selected channel is the Tab stop
    expect(await focusedText(page)).toBe('lfg');
    await page.keyboard.press('ArrowDown');
    expect(await focusedText(page)).toMatch(/^mods, unread, private, 1 mention/);
    await page.keyboard.press('Home');
    expect(await focusedText(page)).toBe('general');
    await page.keyboard.press('End');
    expect(await focusedText(page)).toMatch(/^staff-room, private/);
    await page.keyboard.press('c');
    expect(await focusedText(page)).toMatch(/^clips, unread, 2 mentions/);
    await page.keyboard.press('Tab');
    // Next stop after the list: the first voice card's button
    expect(await focusedName(page)).toBe('Leave Squad Up');
  });

  test('voice cards: Leave and Join are reached with Tab', async ({ page }) => {
    await openStory(page, 'community-left--default', TABLET);
    await tabTo(page, 'Leave Squad Up');
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe('Join AFK');
  });

  test('user card: status only; Settings is its one control and is reached with Tab after the voice rooms', async ({ page }) => {
    await openStory(page, 'community-left--user-deafened', TABLET);
    await expect(page.getByText('Deafened')).toBeVisible();
    await tabTo(page, 'Join AFK');
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe('Settings');
    expect(await page.getByRole('button', { name: /^(Mute|Deafen)$/ }).count()).toBe(0);
  });
});

for (const story of ['community-left--default', 'community-left--long-names', 'community-left--voice-rooms', 'members-island--long-status']) {
  test(`${story}: no horizontal scroll at 320 px`, async ({ page }) => {
    await openStory(page, story, PHONE);
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      islands: Array.from(document.querySelectorAll('nav:not([aria-label="Pinned communities"]), aside, [role="dialog"]')).map(
        (el) => (el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth,
      ),
    }));
    expect(overflow.page).toBeLessThanOrEqual(0);
    for (const extra of overflow.islands) expect(extra).toBeLessThanOrEqual(0);
  });
}

test('the user card stays at the foot of the island while 200 channels scroll', async ({ page }) => {
  await openStory(page, 'community-left--two-hundred-channels', TABLET);
  const settings = page.getByRole('button', { name: 'Settings' });
  const before = await settings.boundingBox();
  // The island's body scrolls; its footer (the user card) does not.
  await island(page).evaluate((nav) => (nav.firstElementChild as HTMLElement).scrollBy(0, 2000));
  expect(await island(page).evaluate((nav) => (nav.firstElementChild as HTMLElement).scrollTop)).toBeGreaterThan(0);
  const after = await settings.boundingBox();
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  const navBox = await island(page).boundingBox();
  expect((after?.y ?? 0) + (after?.height ?? 0)).toBeLessThanOrEqual((navBox?.y ?? 0) + (navBox?.height ?? 0));
});

test('resizing across the phone breakpoint keeps the island: its scroll position and the focused channel stay', async ({ page }) => {
  await openStory(page, 'community-left--two-hundred-channels', { width: 1300, height: 800 });
  const body = () => island(page).evaluate((nav) => (nav.firstElementChild as HTMLElement).scrollTop);
  await island(page).evaluate((nav) => {
    (nav.firstElementChild as HTMLElement).scrollTop = 600;
  });
  await page.getByRole('link', { name: /^channel-40\b/ }).focus();
  const before = await body();
  expect(before).toBeGreaterThan(0);
  for (const width of [900, 390, 1300]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toMatch(/^channel-40\b/);
    expect(await body()).toBeGreaterThan(0);
  }
});
