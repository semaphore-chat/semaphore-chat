import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The new shell's call bar at real widths (jsdom does not lay out or capture pointers): its Tab order, the
 * kit hold-to-talk control with pointer capture (sliding off keeps the hold, lifting anywhere ends it), Leave
 * reachable and uncovered at 390 and 320 px with the longest room name, and no overlap with the dock or a
 * toast.
 */
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 640 };
const COMPACT = { width: 820, height: 1180 };
const WIDE = { width: 1440, height: 900 };

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }, selector);
}

test('Tab order on a phone: the mic, Deafen, Open call view, Leave', async ({ page }) => {
  await openStory(page, 'call-bar--connected', PHONE);
  await page.getByRole('button', { name: 'Mute' }).focus();
  const order: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual(['Mute', 'Deafen', 'Open call view', 'Leave call']);
});

test('Tab order at wide: the mic, Open call view, Leave (deafen is on the user card)', async ({ page }) => {
  await openStory(page, 'call-bar--connected', WIDE);
  await page.getByRole('button', { name: 'Mute' }).focus();
  const order: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual(['Mute', 'Open call view', 'Leave call']);
});

test('hold to talk: the pointer is captured, sliding off keeps the hold, lifting outside ends it once', async ({ page }) => {
  await openStory(page, 'kit-icon-button--hold', PHONE);
  const button = page.getByRole('button', { name: 'Hold to talk' }).first();
  const state = page.getByTestId('hold-state');
  const b = (await button.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(state).toHaveText('Holding');
  // Slide well off the button: captured, so still holding.
  await page.mouse.move(b.x + b.width + 200, b.y + b.height + 200, { steps: 8 });
  await expect(state).toHaveText('Holding');
  await page.mouse.up();
  await expect(state).toHaveText('Not holding');
  await expect(page.getByText('starts 1 · ends 1')).toBeVisible();
});

test('hold to talk: the button keeps the finger (touch-action none, no text selection)', async ({ page }) => {
  await openStory(page, 'kit-icon-button--hold', PHONE);
  const style = await page
    .getByRole('button', { name: 'Hold to talk' })
    .first()
    .evaluate((el) => ({ touchAction: getComputedStyle(el).touchAction, userSelect: getComputedStyle(el).userSelect }));
  expect(style).toEqual({ touchAction: 'none', userSelect: 'none' });
});

for (const view of [PHONE, SMALL]) {
  test(`Leave is on screen and on top at ${view.width} px, with the longest room name`, async ({ page }) => {
    await openStory(page, 'call-bar--long-name', view);
    const leave = page.getByRole('button', { name: 'Leave call' });
    await expect(leave).toBeVisible();
    const b = (await leave.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(view.width);
    expect(b.y + b.height).toBeLessThanOrEqual(view.height);
    // Nothing is drawn over its centre.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
      [b.x + b.width / 2, b.y + b.height / 2],
    );
    expect(hit).toBe('Leave call');
    // The page does not scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await leave.click({ trial: true });
  });
}

for (const view of [PHONE, COMPACT, WIDE]) {
  test(`no overlap with the dock or a toast at ${view.width} px`, async ({ page }) => {
    await openStory(page, 'call-bar--with-toast', view);
    const toastText = page.getByRole('region', { name: 'Notifications' }).getByText('Link copied to the clipboard');
    await expect(toastText).toBeVisible();
    const bar = await box(page, '[data-slot="call-bar"]');
    const dock = await box(page, 'nav[aria-label="Pinned communities"]');
    const toast = await toastText.evaluate((el) => {
      // The toast's own box: the nearest ancestor that is the toast card (wider than its text line).
      const card = el.closest('li') ?? el.parentElement!;
      const r = card.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    expect(bar).not.toBeNull();
    expect(dock).not.toBeNull();
    expect(toast).not.toBeNull();
    expect(overlaps(bar!, dock!), 'call bar over the dock').toBe(false);
    expect(overlaps(bar!, toast!), 'toast over the call bar').toBe(false);
  });
}
