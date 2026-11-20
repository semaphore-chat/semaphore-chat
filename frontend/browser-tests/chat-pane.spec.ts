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

test('attachment tiles: an extreme shape gets a box no side under 48 px, the picture letterboxed inside', async ({ page }) => {
  await openStory(page, 'kit-attachment-tile--states', PHONE);
  const drawn = await page.evaluate(() =>
    ['strip.png', 'pole.png'].map((name) => {
      const button = document.querySelector(`button[aria-label="Open image ${name}"]`) as HTMLElement;
      const box = button.getBoundingClientRect();
      const img = button.querySelector('img') as HTMLImageElement;
      return [name, Math.round(box.width) >= 48 && Math.round(box.height) >= 48, getComputedStyle(img).objectFit];
    }),
  );
  expect(drawn).toEqual([
    ['strip.png', true, 'contain'],
    ['pole.png', true, 'contain'],
  ]);
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
    // The two newest rows have an image and the list opens at the bottom, so no scroll is needed. Focus the second
    // newest: after its own Open button, Tab must skip the newest row's Open button and leave the list.
    await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible();
    const target = await page.evaluate(async () => {
      for (let f = 0; f < 10; f += 1) await new Promise((r) => requestAnimationFrame(r));
      const row = document.querySelector<HTMLElement>('[data-message-id="m-1998"] [role="article"]');
      row?.focus();
      return row ? 'm-1998' : null;
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
    const after = await page.evaluate(() => ({
      inList: document.activeElement?.closest('[role="list"]') !== null,
      what: document.activeElement?.outerHTML.slice(0, 160),
    }));
    // Out of the list: the next Tab stop after it, the composer's field.
    expect(after.inList, after.what).toBe(false);
    await expect(page.getByRole('textbox', { name: 'Message #lobby' })).toBeFocused();
  });
});
