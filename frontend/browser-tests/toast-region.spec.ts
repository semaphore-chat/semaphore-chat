import { expect, test, type Page } from '@playwright/test';
import { tokens } from '../src/theme/generated/tokens.ts';
import { openStory } from './story.ts';

/**
 * The toast region at real widths (jsdom does not lay out): it sits at the bottom centre of the main island, above
 * the composer, and never over the call bar, the dock or the keyboard; F6 moves focus into it and back; under a
 * dialog it is seen but out of reach, and the toast is announced inside the dialog; reduced motion stops its motion.
 */
const PHONE = { width: 390, height: 844 };
const COMPACT = { width: 820, height: 1180 };
const WIDE = { width: 1440, height: 900 };
const { gutter, dialogSm } = tokens.layout;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

async function boxes(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined): Box | null => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const main = document.querySelector('main');
    return {
      region: box(document.querySelector('[data-kit-toast-region]')),
      pane: box(document.querySelector('[data-kit-toast-anchor]:not([hidden])')),
      main: box(main),
      composer: box(document.querySelector('[data-slot="composer"]')),
      callBar: box(document.querySelector('[data-slot="call-bar"]')),
      dock: box(document.querySelector('nav[aria-label="Pinned communities"]')),
      innerHeight: window.innerHeight,
      scroll: {
        width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      },
    };
  });
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const [range, view] of [
  ['phone', PHONE],
  ['compact', COMPACT],
  ['wide', WIDE],
] as const) {
  test(`${range} ${view.width}x${view.height}: bottom centre of the main island, above the composer, clear of the call bar and dock`, async ({
    page,
  }) => {
    await openStory(page, 'kit-toast-region--in-call', view);
    await expect(page.locator('[data-kit-toast-region]')).toBeVisible();
    const m = await boxes(page);
    const { region, pane, composer, callBar, dock } = m;
    if (!region || !pane || !composer || !callBar || !dock) throw new Error(JSON.stringify(m));
    // Centred over the main island, inside it by the gutter, at most the small dialog's width.
    expect(Math.abs((region.left + region.right) / 2 - (pane.left + pane.right) / 2)).toBeLessThan(1.5);
    expect(region.width).toBeLessThanOrEqual(Math.min(pane.width - 2 * gutter, dialogSm) + 0.5);
    expect(region.left).toBeGreaterThanOrEqual(pane.left + gutter - 0.5);
    // Above the composer by the gutter.
    expect(region.bottom).toBeLessThanOrEqual(composer.top - gutter + 0.5);
    expect(region.bottom).toBeGreaterThan(composer.top - gutter - 2);
    // Never over the call bar (and its Leave) or the dock.
    expect(overlaps(region, callBar), JSON.stringify(m)).toBe(false);
    expect(overlaps(region, dock), JSON.stringify(m)).toBe(false);
    expect(m.scroll).toEqual({ width: 0, height: 0 });
    // Drawn over the conversation: the point at its centre hits the region.
    const onTop = await page.evaluate(() => {
      const el = document.querySelector('[data-kit-toast-region]') as HTMLElement;
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop).toBe(true);
    if (range === 'phone') {
      // The phone stack, top to bottom: the toast, the composer, the call bar, the dock bar.
      expect(composer.bottom).toBeLessThanOrEqual(callBar.top);
      expect(callBar.bottom).toBeLessThanOrEqual(dock.top);
    }
  });
}

test('phone with the keyboard up: above the composer, and the frame ends where the keyboard starts', async ({ page }) => {
  await openStory(page, 'kit-toast-region--phone-keyboard', PHONE);
  await expect(page.locator('[data-kit-toast-region]')).toBeVisible();
  const m = await boxes(page);
  const { region, composer, callBar } = m;
  if (!region || !composer || !callBar) throw new Error(JSON.stringify(m));
  // The dock bar is left out while the keyboard is up.
  expect(m.dock).toBeNull();
  expect(region.bottom).toBeLessThanOrEqual(composer.top - gutter + 0.5);
  expect(overlaps(region, callBar)).toBe(false);
  // Nothing of the frame is under the faked keyboard (KEYBOARD_SHARE of the window in the story).
  expect(callBar.bottom).toBeLessThanOrEqual(m.innerHeight - Math.round(m.innerHeight * 0.36));
  expect(m.scroll).toEqual({ width: 0, height: 0 });
});

test('on the call stage: above the controls', async ({ page }) => {
  await openStory(page, 'kit-toast-region--on-stage', WIDE);
  await expect(page.locator('[data-kit-toast-region]')).toBeVisible();
  const { region, controls } = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect().toJSON() as DOMRect;
    return { region: r('[data-kit-toast-region]'), controls: r('[data-slot="controls"]') };
  });
  expect(region.bottom).toBeLessThanOrEqual(controls.top - gutter + 0.5);
});

test.describe('reach', { tag: '@keyboard' }, () => {
  test('F6 moves focus into the Notifications region and F6 again puts it back on the composer', async ({ page }) => {
    await openStory(page, 'kit-toast-region--in-call', WIDE);
    const composer = page.getByRole('textbox', { name: 'Message general' });
    await composer.focus();
    await page.keyboard.press('F6');
    await expect(page.getByRole('region', { name: 'Notifications' })).toBeFocused();
    // Inside the region, Tab reaches the toast's own control.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss' })).toBeFocused();
    await page.keyboard.press('Shift+F6');
    await expect(composer).toBeFocused();
  });

  test('dismissing from the keyboard puts focus back where it was', async ({ page }) => {
    await openStory(page, 'kit-toast-region--sticky-danger', WIDE);
    const composer = page.getByRole('textbox', { name: 'Message general' });
    await composer.focus();
    await page.keyboard.press('F6');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(composer).toBeFocused();
  });
});

test('under an open dialog: on the dimmed page under the dialog, out of reach, and announced inside the dialog', async ({ page }) => {
  await openStory(page, 'kit-toast-region--under-dialog', WIDE);
  const dialog = page.getByRole('dialog', { name: 'Notification settings' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-kit-toast-region]')).toBeVisible();
  // On the dimmed page, under the dialog (never over its buttons): both are body children in the root stacking
  // context, the region one level below the dialog.
  const levels = await page.evaluate(() => ({
    region: Number(getComputedStyle(document.querySelector('[data-kit-toast-region]') as Element).zIndex),
    dialog: Number(getComputedStyle(document.querySelector('.MuiDialog-root') as Element).zIndex),
    regionParent: document.querySelector('[data-kit-toast-region]')?.parentElement === document.body,
    dialogParent: document.querySelector('.MuiDialog-root')?.parentElement === document.body,
  }));
  expect(levels.region, JSON.stringify(levels)).toBeLessThan(levels.dialog);
  expect(levels.regionParent && levels.dialogParent).toBe(true);
  // Out of reach: hidden from assistive technology with the page, and F6 does not leave the dialog.
  expect(await page.locator('[data-kit-toast-region]').evaluate((el) => !!el.closest('[aria-hidden="true"]'))).toBe(true);
  await page.keyboard.press('F6');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // A toast shown now is announced in the dialog's slot, which is not hidden.
  await page.getByRole('button', { name: 'Show a toast' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const slots = Array.from(document.querySelectorAll('[data-kit-live-slot]'));
        const said = slots.find((slot) => slot.textContent?.includes('Notifications muted'));
        return said ? { scope: said.getAttribute('data-kit-live-slot'), hidden: !!said.closest('[aria-hidden="true"]') } : null;
      }),
    )
    .toEqual({ scope: 'layer', hidden: false });
});

test('reduced motion: the toast does not move in', async ({ page }) => {
  await openStory(page, 'kit-toast-region--in-call', WIDE);
  const animation = () =>
    page.locator('[data-kit-toast-region] > div').evaluate((el) => getComputedStyle(el).animationName);
  expect(await animation()).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await animation()).toBe('none');
});
