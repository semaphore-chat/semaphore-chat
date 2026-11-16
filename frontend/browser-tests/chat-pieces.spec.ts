import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The chat pieces in a real browser, for what jsdom cannot show: nothing overflows a 390 px phone (a very long
 * name cuts with an ellipsis, an unbroken run and a code block wrap), the composer grows to its cap and then
 * scrolls, the row's toolbar and a continued row's time show on hover and on keyboard focus only, and Jump to
 * latest floats centred at the bottom of its list region.
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

test('composer: grows to the desktop cap (10 lines) and then scrolls', async ({ page }) => {
  await openStory(page, 'kit-composer--at-cap', DESKTOP);
  const field = page.getByRole('textbox', { name: 'Message #general' });
  const measured = await field.evaluate((element) => {
    const area = element as HTMLTextAreaElement;
    const line = parseFloat(getComputedStyle(area).lineHeight);
    return { lines: Math.round(area.clientHeight / line), scrolls: area.scrollHeight > area.clientHeight };
  });
  expect(measured).toEqual({ lines: 10, scrolls: true });
  // An empty field is one line, as tall as the Send button beside it.
  await field.fill('');
  const heights = await page.evaluate(() => {
    const area = document.querySelector('textarea:not([aria-hidden])') as HTMLElement;
    const send = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Send message') as HTMLElement;
    return { field: (area.parentElement?.parentElement as HTMLElement).getBoundingClientRect().height, send: send.getBoundingClientRect().height };
  });
  expect(heights.field).toBe(heights.send);
});

const revealOpacity = (page: Page, index: number) =>
  page.evaluate((i) => getComputedStyle(document.querySelectorAll('[data-reveal]')[i]).opacity, index);

test('row toolbar and continued time: hidden at rest, shown on hover and on keyboard focus', async ({ page }) => {
  await openStory(page, 'kit-message-row--actions', DESKTOP);
  // [data-reveal] 0 is the first row's toolbar, 1 the continued row's gutter time.
  await expect.poll(() => revealOpacity(page, 0)).toBe('0');
  await page.getByRole('article').first().hover();
  await expect.poll(() => revealOpacity(page, 0)).toBe('1');
  await page.mouse.move(0, 0);
  await expect.poll(() => revealOpacity(page, 0)).toBe('0');

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
