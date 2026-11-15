import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The destructive confirmation (frontend/src/kit/behaviour/hosts/confirm.ts) opened from a Menu item, in a real
 * browser: the focus trap with the dialog on top of a closed menu, Escape and a press on the scrim while the action
 * works, and where focus lands when the dialog closes. The stories: kit-confirm-dialog--from-menu (the first try
 * fails after a moment) and --from-menu-never-ends (the action never ends).
 */
const DESKTOP = { width: 1440, height: 900 };

async function openFromMenu(page: Page, story: string) {
  await openStory(page, `kit-confirm-dialog--${story}`, DESKTOP);
  await page.getByRole('button', { name: 'Channel options' }).click();
  await page.getByRole('menuitem', { name: 'Delete channel…' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete #memes?' })).toBeVisible();
}

const inDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[data-kit-modal]'));
const phase = (page: Page) => page.getByTestId('confirm-log');

test.describe('a confirmation opened from a menu item', { tag: '@keyboard' }, () => {
  test('Tab and Shift+Tab stay inside the dialog', async ({ page }) => {
    await openFromMenu(page, 'from-menu-never-ends');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    for (const key of [...Array(6).fill('Tab'), ...Array(6).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      expect(await inDialog(page), `focus inside the dialog after ${key}`).toBe(true);
    }
  });

  test('Escape and a press on the dimmed page do nothing while the action works', async ({ page }) => {
    await openFromMenu(page, 'from-menu-never-ends');
    const confirm = page.getByRole('button', { name: 'Delete channel', exact: true });
    await confirm.click();
    await expect(confirm).toHaveAttribute('aria-busy', 'true');
    // Unavailable, but not disabled: it keeps its place in the tab order.
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toHaveAttribute('aria-disabled', 'true');
    await expect(cancel).not.toHaveAttribute('disabled');
    await cancel.focus();
    await expect(cancel).toBeFocused();
    await expect(phase(page)).toHaveAttribute('data-phase', 'working');
    await page.keyboard.press('Escape');
    await page.mouse.click(8, 8);
    // force: Playwright treats aria-disabled as not actionable; a real press still lands on it.
    await cancel.click({ force: true });
    // The phase is the hook's own: a regression that started closing would read idle at once, even mid-fade.
    await expect(phase(page)).toHaveAttribute('data-phase', 'working');
    await expect(page.getByRole('dialog', { name: 'Delete #memes?' })).toBeVisible();
    await expect(confirm).toHaveAttribute('aria-busy', 'true');
    // Busy is not disabled: the button still takes focus.
    await confirm.focus();
    await expect(confirm).toBeFocused();
  });

  test('Escape closes it before the action, and focus returns to the menu button', async ({ page }) => {
    await openFromMenu(page, 'from-menu');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Channel options' })).toBeFocused();
  });

  test('a failure keeps it open with the error; Try again works; focus returns to the menu button', async ({ page }) => {
    await openFromMenu(page, 'from-menu');
    const confirm = page.getByRole('button', { name: 'Delete channel', exact: true });
    await confirm.click();
    await expect(page.getByRole('alert')).toContainText("Couldn't delete the channel");
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Channel options' })).toBeFocused();
    await expect(page.getByTestId('confirm-log')).toHaveText('channel deleted');
  });
});
