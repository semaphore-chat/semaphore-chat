import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The chat pieces in a real browser, for what jsdom cannot show: nothing overflows a 390 px phone (a very long
 * name cuts with an ellipsis, an unbroken run and a code block wrap), the composer grows to its cap and then
 * scrolls (at each of its three caps), the row's toolbar and a continued row's time show on hover and on keyboard
 * focus only, a hidden toolbar takes no Tab stop and no tap, a device that cannot hover never shows it, and Jump
 * to latest floats centred at the bottom of its list region.
 */
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1024, height: 900 };

const pageOverflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test('message rows: long content stays inside the column at 390 px', async ({ page }) => {
  await openStory(page, 'kit-message-row--long-content', PHONE);
  expect(await pageOverflows(page)).toBe(false);
  const measured = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll<HTMLElement>('[role="article"]'));
    const name = document.querySelector<HTMLElement>('[role="article"] button[dir="auto"]');
    const time = articles[0].querySelector('time') as HTMLElement;
    const box = articles[0].getBoundingClientRect();
    const timeBox = time.getBoundingClientRect();
    return {
      count: articles.length,
      rowsFit: articles.every((article) => article.scrollWidth <= article.clientWidth),
      nameCut: name !== null && name.scrollWidth > name.clientWidth,
      timeInside: timeBox.right <= box.right && timeBox.width > 0,
      codeFits: Array.from(document.querySelectorAll('pre')).every((pre) => pre.scrollWidth <= pre.clientWidth),
    };
  });
  expect(measured).toEqual({ count: 4, rowsFit: true, nameCut: true, timeInside: true, codeFits: true });
});

for (const story of ['kit-message-row--states', 'kit-message-text--segments', 'kit-composer--states', 'kit-reaction-chip--states', 'kit-list-separator--variants']) {
  test(`${story}: no sideways scroll at 390 px`, async ({ page }) => {
    await openStory(page, story, PHONE);
    expect(await pageOverflows(page)).toBe(false);
  });
}

const linesDrawn = (page: Page) =>
  page.getByRole('textbox', { name: 'Message #general' }).evaluate((element) => {
    const area = element as HTMLTextAreaElement;
    const line = parseFloat(getComputedStyle(area).lineHeight);
    return { lines: Math.round(area.clientHeight / line), scrolls: area.scrollHeight > area.clientHeight };
  });

// Each story holds a 14-line draft: the field stops growing at its cap and scrolls the rest.
for (const [story, cap, lines] of [
  ['kit-composer--at-keyboard-cap', 'keyboard', 2],
  ['kit-composer--at-phone-cap', 'phone', 4],
  ['kit-composer--at-cap', 'desktop', 10],
] as const) {
  test(`composer: grows to the ${cap} cap (${lines} lines) and then scrolls`, async ({ page }) => {
    await openStory(page, story, cap === 'desktop' ? DESKTOP : PHONE);
    expect(await linesDrawn(page)).toEqual({ lines, scrolls: true });
  });
}

test('composer: an empty field is one line, as tall as the Send button beside it', async ({ page }) => {
  await openStory(page, 'kit-composer--at-cap', DESKTOP);
  await page.getByRole('textbox', { name: 'Message #general' }).fill('');
  const heights = await page.evaluate(() => {
    const area = document.querySelector('textarea:not([aria-hidden])') as HTMLElement;
    const send = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Send message') as HTMLElement;
    return { field: (area.parentElement?.parentElement as HTMLElement).getBoundingClientRect().height, send: send.getBoundingClientRect().height };
  });
  expect(heights.field).toBe(heights.send);
});

const revealOpacity = (page: Page, index: number) =>
  page.evaluate((i) => getComputedStyle(document.querySelectorAll('[data-reveal]')[i]).opacity, index);
const revealVisibility = (page: Page, index: number) =>
  page.evaluate((i) => getComputedStyle(document.querySelectorAll('[data-reveal]')[i]).visibility, index);

test('row toolbar and continued time: hidden at rest, shown on hover and on keyboard focus', async ({ page }) => {
  await openStory(page, 'kit-message-row--actions', DESKTOP);
  // [data-reveal] 0 is the first row's toolbar, 1 the continued row's gutter time.
  await expect.poll(() => revealOpacity(page, 0)).toBe('0');
  // At rest the toolbar is not there at all: no Tab stop, no tap target.
  await expect.poll(() => revealVisibility(page, 0)).toBe('hidden');
  await page.getByRole('article').first().hover();
  await expect.poll(() => revealOpacity(page, 0)).toBe('1');
  expect(await revealVisibility(page, 0)).toBe('visible');
  await page.mouse.move(0, 0);
  await expect.poll(() => revealOpacity(page, 0)).toBe('0');
  await expect.poll(() => revealVisibility(page, 0)).toBe('hidden');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('article').first()).toBeFocused();
  await expect.poll(() => revealOpacity(page, 0)).toBe('1');
  // The toolbar's buttons are reachable with Tab from the row.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add reaction' })).toBeFocused();

  await page.getByRole('article').nth(1).focus();
  await expect.poll(() => revealOpacity(page, 1)).toBe('1');
});

test('jump to latest floats centred at the bottom of its list region', async ({ page }) => {
  await openStory(page, 'kit-jump-to-latest--states', PHONE);
  const placed = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label^="Jump to latest"]') as HTMLElement;
    let region = button.parentElement as HTMLElement;
    while (getComputedStyle(region).position !== 'relative') region = region.parentElement as HTMLElement;
    const b = button.getBoundingClientRect();
    const r = region.getBoundingClientRect();
    return {
      centred: Math.abs(b.left + b.width / 2 - (r.left + r.width / 2)) <= 1,
      gap: Math.round(r.bottom - b.bottom),
    };
  });
  expect(placed).toEqual({ centred: true, gap: 16 });
});

test('row toolbars: Tab from the focused row walks its own toolbar, then leaves the list, never the hidden toolbars of other rows @keyboard', async ({ page }) => {
  await openStory(page, 'kit-message-row--toolbar-tab-order', DESKTOP);
  const rows = page.getByRole('article');
  await expect(rows).toHaveCount(3);
  await rows.first().focus();
  const visited: string[] = [];
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press('Tab');
    visited.push(
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const article = active.closest('[role="article"]');
        const index = article ? Array.from(document.querySelectorAll('[role="article"]')).indexOf(article) : -1;
        return `${index}:${active.getAttribute('aria-label') ?? active.textContent?.trim() ?? ''}`;
      }),
    );
  }
  expect(visited).toEqual(['0:Add reaction', '0:Reply', '0:More actions', '-1:After the list']);
});

test('a Menu opened from the row toolbar keeps the toolbar, so Escape returns focus to its button @keyboard', async ({ page }) => {
  // Reduced motion: no fade, so a toolbar that hides does so at once (no time window for the test to miss).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStory(page, 'kit-message-row--toolbar-tab-order', DESKTOP);
  const row = page.getByRole('article').first();
  await row.focus();
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('Tab');
  // A CSS locator: while the Menu is open the page behind it is inert, out of the accessibility tree.
  const more = page.locator('[role="article"]').first().locator('button[aria-label="More actions"]');
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Message actions' })).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  // Focus is in the Menu (a portal), outside the row: the toolbar must still be there for focus to come back.
  await page.mouse.move(0, 0);
  expect(await more.evaluate((element) => getComputedStyle(element.closest('[role="toolbar"]') as Element).visibility)).toBe('visible');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  // The row is still the list's current row (its one Tab stop).
  await expect(row).toHaveAttribute('tabindex', '0');
});

test.describe('on a device that cannot hover', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('the row toolbar is never shown, even with focus in the row or after the window blurs and focus returns: the actions come from a long press', async ({ page }) => {
    await openStory(page, 'kit-message-row--actions', PHONE);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    const toolbar = page.getByRole('toolbar', { includeHidden: true });
    await expect(toolbar).toHaveCount(1);
    const display = () => toolbar.evaluate((element) => getComputedStyle(element).display);
    expect(await display()).toBe('none');
    // A tap at the row's top end, where the toolbar would be, lands on the row, not on a hidden action.
    const row = page.getByRole('article').first();
    const box = (await row.boundingBox())!;
    const hit = await page.evaluate(
      ({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement).closest('button')?.getAttribute('aria-label') ?? null,
      { x: box.x + box.width - 24, y: box.y + 4 },
    );
    expect(hit).toBeNull();
    await row.tap();
    await expect(row).toBeFocused();
    expect(await display()).toBe('none');
    // Keyboard-style focus on the row does not show it either.
    await row.focus();
    expect(await display()).toBe('none');
    // The window loses focus (another tab or app) and gets it back: focus returns to the row, the toolbar stays away.
    const other = await page.context().newPage();
    await other.bringToFront();
    await page.bringToFront();
    await other.close();
    await expect(row).toBeFocused();
    expect(await display()).toBe('none');
  });
});
