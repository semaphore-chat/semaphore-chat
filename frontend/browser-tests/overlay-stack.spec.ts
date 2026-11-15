import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The overlay stack (frontend/src/kit/behaviour/hosts/overlay.ts) on real overlays, for what jsdom cannot show:
 * MUI's focus trap with layers drawn inside a dialog, Escape while an input method composes, real hit-testing of
 * a drag onto the scrim and of the press a menu's invisible layer swallows, a select list that opens under the
 * pointer, and `aria-hidden` around the live-region slots. The kit-overlay-stack stories write what happened in
 * a log line (`overlay-log`).
 */
const DESKTOP = { width: 1440, height: 900 };

const log = (page: Page) => page.getByTestId('overlay-log');

/** Where focus is: inside the dialog's container (the trap), in the Colour popover, on the page behind. */
function focusPlace(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      inTrap: !!el?.closest('.MuiDialog-container'),
      inPopover: !!el?.closest('[role="dialog"][aria-label="Colour"]'),
      inPanel: !!el?.closest('[role="dialog"][aria-modal="true"]'),
    };
  });
}

test.describe('a dialog with layers inside', { tag: '@keyboard' }, () => {
  test('Tab cycles through the dialog and the popover drawn in it, and never leaves', async ({ page }) => {
    await openStory(page, 'kit-overlay-stack--nested-in-dialog', DESKTOP);
    await expect(page.getByRole('dialog', { name: 'Colour' })).toBeVisible();
    await expect.poll(async () => (await focusPlace(page)).inTrap).toBe(true);
    const seen = { popover: 0, panel: 0 };
    for (const key of [...Array(8).fill('Tab'), ...Array(8).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      const place = await focusPlace(page);
      expect(place.inTrap, `focus inside the dialog after ${key}`).toBe(true);
      if (place.inPopover) seen.popover += 1;
      if (place.inPanel) seen.panel += 1;
    }
    expect(seen.popover, 'Tab reaches the popover inside the dialog').toBeGreaterThan(0);
    expect(seen.panel, 'Tab reaches the dialog itself').toBeGreaterThan(0);
  });

  test('Escape closes the select list, then the popover, then the dialog; Tab closes the menu', async ({ page }) => {
    await openStory(page, 'kit-overlay-stack--nested-in-dialog', DESKTOP);
    const shade = page.getByRole('combobox', { name: 'Shade' });
    await shade.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(shade).toBeFocused();
    await expect(log(page)).toHaveText('Nothing yet.');

    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.getByRole('button', { name: 'More' })).toBeFocused();
    await expect(log(page)).toHaveText('menu closed');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Colour' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Pick colour' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(log(page)).toHaveText('menu closed · popover closed · dialog closed (escape)');
    await expect(page.getByRole('dialog', { name: 'Edit channel' })).toBeHidden();
  });
});

test('Escape while an input method composes does not close the popover', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'composition is driven over CDP');
  await openStory(page, 'kit-overlay-stack--escape-while-composing', DESKTOP);
  const field = page.getByRole('textbox', { name: 'Reply' });
  await expect(field).toBeFocused();
  const cdp = await page.context().newCDPSession(page);
  const seen: Array<{ composing: boolean; keyCode: number }> = [];
  await page.exposeFunction('reportEscape', (entry: { composing: boolean; keyCode: number }) => seen.push(entry));
  await page.evaluate(() => {
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          (window as unknown as { reportEscape: (entry: object) => void }).reportEscape({
            composing: event.isComposing,
            keyCode: event.keyCode,
          });
        }
      },
      true,
    );
  });
  await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await page.keyboard.press('Escape');
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0].composing || seen[0].keyCode === 229, JSON.stringify(seen[0])).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Reply' })).toBeVisible();
  await expect(log(page)).toHaveText('Nothing yet.');

  await cdp.send('Input.insertText', { text: 'に' });
  await page.keyboard.press('Escape');
  await expect(log(page)).toHaveText('popover closed');
  await expect(page.getByRole('button', { name: 'Reply' })).toBeFocused();
  await cdp.detach();
});

test('a drag onto or off the scrim is not a press; a press on it closes the dialog; a right press does nothing', async ({
  page,
}) => {
  await openStory(page, 'kit-overlay-stack--scrim-press', DESKTOP);
  const panel = page.getByRole('dialog', { name: 'Leave the call?' });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const scrim = { x: 8, y: DESKTOP.height - 8 };

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(scrim.x, scrim.y, { steps: 5 });
  await page.mouse.up();
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(scrim.x, scrim.y, { button: 'right' });
  await page.mouse.click(scrim.x, scrim.y, { button: 'middle' });
  await expect(panel).toBeVisible();
  await expect(log(page)).toHaveText('Nothing yet.');

  await page.mouse.click(scrim.x, scrim.y);
  await expect(log(page)).toHaveText('dialog closed (scrim)');
  await expect(panel).toBeHidden();

  // Opened from a button, a scrim press returns focus to it.
  await page.getByRole('button', { name: 'Open again' }).click();
  await expect(panel).toBeVisible();
  await page.mouse.click(scrim.x, scrim.y);
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open again' })).toBeFocused();
});

test('the press outside a menu closes it and never reaches the control under it', async ({ page }) => {
  await openStory(page, 'kit-overlay-stack--menu-swallows-press', DESKTOP);
  await expect(page.getByRole('menu')).toBeVisible();
  // The page is aria-hidden under the menu, so the button is found by its text.
  const pageButton = page.getByText(/^Pressed \d+ times$/);
  const box = (await pageButton.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // A right press is not a press: the menu stays, the button is not pressed.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();

  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(log(page)).toHaveText('menu closed');
  await expect(pageButton).toHaveText('Pressed 0 times');

  // Once the menu's layer has faded out, the same press reaches the button.
  await expect(page.locator('.MuiMenu-root')).toHaveCount(0);
  await page.mouse.click(at.x, at.y);
  await expect(pageButton).toHaveText('Pressed 1 times');
});

test('a select list that opens under the pointer on press-down stays open; a press outside closes it', async ({ page }) => {
  await openStory(page, 'kit-select-field--states', DESKTOP);
  const field = page.getByRole('combobox').and(page.locator(':not([aria-disabled="true"])')).first();
  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.mouse.up();
  // Give a wrong close every chance to land: the list's fade is the fast timing.
  await page.waitForTimeout(300);
  await expect(page.getByRole('listbox')).toBeVisible();

  await page.mouse.click(8, DESKTOP.height - 8);
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(field).toBeFocused();
});

test('the live-region slot of the topmost layer is not hidden from assistive technology', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough for a DOM attribute check');
  await openStory(page, 'kit-overlay-stack--nested-in-dialog', DESKTOP);
  const shade = page.getByRole('combobox', { name: 'Shade' });
  await shade.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();

  const slots = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-kit-live-slot]')).map((slot) => ({
      scope: slot.getAttribute('data-kit-live-slot'),
      hidden: !!slot.closest('[aria-hidden="true"]'),
      inList: !!slot.closest('.MuiMenu-root')?.querySelector('[role="listbox"]'),
    })),
  );
  // The page root's slot is hidden with the page; the open list's own slot (the topmost, where text goes) is not.
  expect(slots.find((slot) => slot.scope === 'root')?.hidden, JSON.stringify(slots)).toBe(true);
  const listSlot = slots.find((slot) => slot.inList);
  expect(listSlot, JSON.stringify(slots)).toBeDefined();
  expect(listSlot?.hidden, JSON.stringify(slots)).toBe(false);
});
