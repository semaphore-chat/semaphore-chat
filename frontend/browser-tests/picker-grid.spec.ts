import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * The kit PickerGrid in real browsers, for what jsdom cannot show: the grid's columns come from the laid-out CSS
 * grid, so ↑/↓ move by a real row (and across sections, keeping the column).
 */
const PHONE = { width: 390, height: 844 };

const focusedLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

test.describe('@keyboard', () => {
  test('arrow keys move by laid-out rows and across sections; Home and End', async ({ page }) => {
    await openStory(page, 'kit-picker-grid--narrow320', PHONE);
    const grid = page.getByRole('group', { name: 'Emoji' });
    // Narrow (288 px): 6 columns. Tab lands on the first cell.
    await grid.getByRole('button').first().focus();
    expect(await focusedLabel(page)).toBe('🔥');
    // Down from the 3-cell "Recently used" row: the custom section, same column.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel(page)).toBe(':blobwave:');
    // Down into the people section, then down one laid-out row (6 cells on).
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel(page)).toBe('😃');
    await page.keyboard.press('ArrowDown');
    expect(await focusedLabel(page)).toBe('😂');
    await page.keyboard.press('ArrowUp');
    expect(await focusedLabel(page)).toBe('😃');
    await page.keyboard.press('End');
    expect(await focusedLabel(page)).toBe('😙');
    await page.keyboard.press('Home');
    expect(await focusedLabel(page)).toBe('🔥');
    // One Tab stop: Tab leaves the grid.
    const cellsInTabOrder = await grid.locator('button[tabindex="0"]').count();
    expect(cellsInTabOrder).toBe(1);
  });
});
