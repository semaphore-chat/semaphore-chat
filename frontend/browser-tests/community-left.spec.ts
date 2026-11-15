import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The community left island (shell/lounge/pieces/community) in a real browser: the channel list is one
 * Tab stop with arrows, Home, End and typeahead; the voice cards' Join and Leave and the user card's
 * buttons are reached with Tab; nothing scrolls sideways at 320 px.
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
    expect(await focusedText(page)).toMatch(/mods$/);
    await page.keyboard.press('Home');
    expect(await focusedText(page)).toBe('general');
    await page.keyboard.press('End');
    expect(await focusedText(page)).toMatch(/staff-room$/);
    await page.keyboard.press('c');
    expect(await focusedText(page)).toBe('clips');
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

  test('user card: Mute, Deafen and Settings are reached with Tab, Mute says it is pressed', async ({ page }) => {
    await openStory(page, 'community-left--push-to-talk-deafened', TABLET);
    // A disabled Mute (push-to-talk) is not a stop; Deafen and Settings are
    await tabTo(page, 'Deafen');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed'))).toBe('true');
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe('Settings');
    await openStory(page, 'community-left--default', TABLET);
    await tabTo(page, 'Mute');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed'))).toBe('false');
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe('Deafen');
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe('Settings');
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
  await island(page).evaluate((nav) => nav.scrollBy(0, 2000));
  const after = await settings.boundingBox();
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  const navBox = await island(page).boundingBox();
  expect((after?.y ?? 0) + (after?.height ?? 0)).toBeLessThanOrEqual((navBox?.y ?? 0) + (navBox?.height ?? 0));
});
