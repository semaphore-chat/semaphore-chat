import { expect, test } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * Below the wide range ThreeIslands shows the right content as a Sheet. jsdom cannot render the phone form
 * (Sheet.test.tsx reads the declarations of the phone rule) and its focus handling is not a browser's; here the
 * Members button of the chat story opens the sheet at phone width with the keyboard.
 */
const PHONE = { width: 390, height: 844 };

test.describe('phone: the right content as a sheet', { tag: '@keyboard' }, () => {
  test('opens as a bottom sheet, traps Tab, and Escape returns focus to Members', async ({ page }) => {
    await openStory(page, 'kit-three-islands--chat', PHONE);
    const members = page.getByRole('button', { name: 'Members', exact: true });
    await members.focus();
    await page.keyboard.press('Enter');

    const sheet = page.getByRole('dialog', { name: 'Members' });
    await expect(sheet).toBeVisible();
    // Focus moved in.
    await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    // The phone form: full width, sitting on the bottom edge (once the slide-up animation has ended).
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();
        return box && { left: Math.round(box.x), width: Math.round(box.width), bottom: Math.round(box.y + box.height) };
      })
      .toEqual({ left: 0, width: PHONE.width, bottom: PHONE.height });

    // Tab and Shift+Tab stay inside, past the ends of the sheet's controls (Close and six members).
    for (const key of [...Array(10).fill('Tab'), ...Array(10).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      expect(await sheet.evaluate((el) => el.contains(document.activeElement)), `focus inside after ${key}`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(members).toBeFocused();
  });
});
