import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The new shell's call bar at real widths (jsdom does not lay out or capture pointers): its Tab order (the room,
 * which opens the call view, then Mute, Deafen, Leave at every width), the room's name whole in the 288 px column
 * and its target size, the
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

const ORDER = ['Open call view, Squad Up', 'Mute', 'Deafen', 'Leave call'];

test('Tab order on a phone: the room (Open call view), the mic, Deafen, Leave', async ({ page }) => {
  await openStory(page, 'call-bar--connected', PHONE);
  await page.getByRole('button', { name: ORDER[0] }).focus();
  const order: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual(ORDER);
});

for (const view of [COMPACT, WIDE]) {
  test(`Tab order at ${view.width} px: the room (Open call view), the mic, Deafen, Leave`, async ({ page }) => {
    await openStory(page, 'call-bar--connected', view);
    await page.getByRole('button', { name: ORDER[0] }).focus();
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
      await page.keyboard.press('Tab');
    }
    expect(order).toEqual(ORDER);
  });
}

test('a server-muted mic is still a Tab stop, in its place', async ({ page }) => {
  await openStory(page, 'call-bar--server-muted', PHONE);
  await page.getByRole('button', { name: 'Mute' }).focus();
  await expect(page.getByRole('button', { name: 'Mute' })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Deafen');
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

/** A typical room name (the `call-bar--typical-name` story). */
const TYPICAL = 'Movie night';

/** The visible room name inside the room button: whole (no ellipsis cut) or cut. */
async function nameFits(page: Page, name: string): Promise<{ fits: boolean; text: string; width?: number }> {
  return page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll('[data-testid="lounge-call-bar"] button span')).find(
      (span) => span.textContent === n && span.children.length === 0,
    ) as HTMLElement | undefined;
    if (!el) return { fits: false, text: 'not found' };
    return { fits: el.scrollWidth <= el.clientWidth, text: el.textContent ?? '', width: el.clientWidth };
  }, name);
}

for (const view of [SMALL, PHONE, COMPACT, WIDE]) {
  test(`the room is the Open call view control at ${view.width} px: named, a full target, typical names whole`, async ({ page }) => {
    await openStory(page, 'call-bar--connected', view);
    const room = page.getByRole('button', { name: 'Open call view, Squad Up', exact: true });
    await expect(room).toBeVisible();
    // No separate Open control any more.
    await expect(page.getByRole('button', { name: 'Open call view', exact: true })).toHaveCount(0);
    const b = (await room.boundingBox())!;
    expect(b.height, 'room target height').toBeGreaterThanOrEqual(44);
    expect(b.width, 'room target width').toBeGreaterThanOrEqual(88);
    // Pressing a spot on the name lands on the room button, not a neighbour.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
      [b.x + 12, b.y + b.height / 2],
    );
    expect(hit).toBe('Open call view, Squad Up');
    expect(await nameFits(page, 'Squad Up')).toMatchObject({ fits: true, text: 'Squad Up' });

    await openStory(page, 'call-bar--typical-name', view);
    const typical = await nameFits(page, TYPICAL);
    expect(typical).toMatchObject({ fits: true, text: TYPICAL });
  });
}

test('only a genuinely long room name is cut, in the 288 px column', async ({ page }) => {
  await openStory(page, 'call-bar--long-name', WIDE);
  const long = 'The extremely long voice room name for the Friday night co-op raid and the debrief after it';
  expect((await nameFits(page, long)).fits).toBe(false);
  await expect(page.getByRole('button', { name: `Open call view, ${long}` })).toBeVisible();
});
