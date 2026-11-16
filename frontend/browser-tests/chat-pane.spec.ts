import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The conversation pieces of PR 10c-1 in a real browser: ChatPane places its floating parts in the list region,
 * image tiles are sized before their picture arrives, nothing overflows a 390 px phone, and 2,000 kit rows on the
 * shared list core scroll without long tasks, keep the bottom pinned, and give Tab one stop per list (the focused
 * row's own controls, then out).
 */
const PHONE = { width: 390, height: 844 };

const pageOverflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

for (const story of [
  'kit-chat-pane--conversation',
  'kit-chat-pane--with-composer',
  'kit-message-quote--states',
  'kit-attachment-tile--states',
  'kit-typing-line--states',
]) {
  test(`${story}: no sideways scroll at 390 px`, async ({ page }) => {
    await openStory(page, story, PHONE);
    expect(await pageOverflows(page)).toBe(false);
  });
}

test('chat pane: the typing line sits on the list region’s bottom edge and Jump to latest floats above it', async ({ page }) => {
  await openStory(page, 'kit-chat-pane--conversation', PHONE);
  const placed = await page.evaluate(() => {
    const typing = document.querySelector('[data-testid="typing-line"]') as HTMLElement;
    const jump = document.querySelector('button[aria-label^="Jump to latest"]') as HTMLElement;
    let region = typing.parentElement as HTMLElement;
    while (getComputedStyle(region).position !== 'relative') region = region.parentElement as HTMLElement;
    const r = region.getBoundingClientRect();
    const t = typing.getBoundingClientRect();
    const j = jump.getBoundingClientRect();
    return { typingOnBottom: Math.round(r.bottom - t.bottom), typingHeight: Math.round(t.height), jumpInside: j.bottom <= r.bottom && j.top >= r.top };
  });
  expect(placed).toEqual({ typingOnBottom: 0, typingHeight: 32, jumpInside: true });
});

test('attachment tiles: an image box has its final size before the picture loads', async ({ page }) => {
  await openStory(page, 'kit-attachment-tile--states', PHONE);
  const boxes = await page.evaluate(() =>
    ['tall.png', 'loading.png', 'sunset.png', 'no-size.jpg'].map((name) => {
      const button = document.querySelector(`button[aria-label="Open image ${name}"]`) as HTMLElement;
      const box = button.getBoundingClientRect();
      return [name, Math.round(box.width), Math.round(box.height)];
    }),
  );
  // A box shrinks with a narrow column, keeping its shape (sunset is 16:9, 320 wide where there is room).
  const ratio = (w: number, h: number) => Math.round((w / h) * 10) / 10;
  expect(boxes.map(([name, w, h]) => [name, ratio(w as number, h as number), (w as number) <= 320])).toEqual([
    ['tall.png', 0.5, true],
    ['loading.png', 0.5, true],
    ['sunset.png', 1.8, true],
    ['no-size.jpg', 1.5, true],
  ]);
  // The still-loading box is exactly the loaded one's size.
  expect(boxes[1].slice(1)).toEqual(boxes[0].slice(1));
});

test.describe('2,000 kit rows on the shared list core', () => {
  test('open pinned to the bottom, and scroll ten screens without a long task', async ({ page }) => {
    await openStory(page, 'kit-chat-pane--long-history', PHONE);
    const list = page.getByRole('list', { name: 'Messages' });
    await expect(list).toBeVisible();
    await expect.poll(() => list.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 2)).toBe(true);
    const longest = await list.evaluate(async (el) => {
      const tasks: number[] = [];
      const observer = new PerformanceObserver((entries) => entries.getEntries().forEach((e) => tasks.push(e.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      for (let screen = 0; screen < 10; screen += 1) {
        el.scrollTop -= el.clientHeight;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      observer.disconnect();
      return tasks.length === 0 ? 0 : Math.max(...tasks);
    });
    test.info().annotations.push({ type: 'longest long task (ms)', description: String(longest) });
    // Ladle serves React's development build, several times slower than the app's production one; the budget
    // here is twice the 50 ms production target (design R1). Only Chromium reports long tasks.
    expect(longest).toBeLessThan(100);
  });

  test('Tab from the focused row walks its own controls, then leaves the list @keyboard', async ({ page }) => {
    await openStory(page, 'kit-chat-pane--long-history', PHONE);
    // A row with an image (every tenth row has one), in view: scroll up until one is, let the list settle, then
    // focus it (in the page, so a re-render between steps cannot detach it first).
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible();
    const target = await page.evaluate(async () => {
      const settle = async (list: HTMLElement) => {
        let last = -1;
        for (let i = 0; i < 30 && list.scrollTop !== last; i += 1) {
          last = list.scrollTop;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
      };
      const list = document.querySelector('[role="list"][aria-label="Messages"]') as HTMLElement;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await settle(list);
        const view = list.getBoundingClientRect();
        const row = [...list.querySelectorAll<HTMLElement>('[role="article"]')].find((article) => {
          const box = article.getBoundingClientRect();
          return article.querySelector('button[aria-label^="Open image"]') !== null && box.top >= view.top && box.bottom <= view.bottom;
        });
        if (row) {
          row.focus();
          return row.closest('[data-message-id]')?.getAttribute('data-message-id') ?? null;
        }
        list.scrollTop -= list.clientHeight / 3;
      }
      return null;
    });
    expect(target).not.toBeNull();
    const active = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          message: el?.closest('[data-message-id]')?.getAttribute('data-message-id') ?? null,
          what: el?.getAttribute('role') ?? el?.getAttribute('aria-label')?.replace(/ .*$/, '') ?? el?.tagName ?? null,
        };
      });
    expect(await active()).toEqual({ message: target, what: 'article' });
    await page.keyboard.press('Tab');
    expect(await active()).toEqual({ message: target, what: 'Open' });
    await page.keyboard.press('Tab');
    const inList = await page.evaluate(() => document.activeElement?.closest('[role="list"]') !== null);
    expect(inList).toBe(false);
  });
});
