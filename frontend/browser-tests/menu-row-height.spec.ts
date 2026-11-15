import { expect, test } from '@playwright/test';
import { tokens } from '../src/theme/generated/tokens.ts';
import { openStory } from './story.ts';

/**
 * MUI's MenuItem resets `min-height` in a `min-width: sm` media rule; the kit's shared menuItemStyle doubles its
 * class to hold the row at the control height. jsdom does not evaluate @media (menuItemStyle.test.tsx pins the
 * generated style only), so this reads the computed style and the laid-out height at tablet and desktop widths.
 */
const VIEWS = [
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
];
const LISTS = [
  { story: 'kit-menu--open', role: 'menuitem' as const },
  { story: 'kit-select-field--open', role: 'option' as const },
];
const MIN = tokens.control.md;

for (const view of VIEWS) {
  for (const { story, role } of LISTS) {
    test(`${story} at ${view.width}: every ${role} row is at least control.md (${MIN}px) high`, async ({ page }) => {
      await openStory(page, story, view);
      const rows = page.getByRole(role);
      await expect(rows.first()).toBeVisible();
      const measured = await rows.evaluateAll((els) =>
        els.map((el) => ({
          text: el.textContent?.trim() ?? '',
          minHeight: parseFloat(getComputedStyle(el).minHeight) || 0,
          height: el.getBoundingClientRect().height,
        })),
      );
      expect(measured.length).toBeGreaterThan(1);
      for (const row of measured) {
        expect(row.minHeight, `min-height of "${row.text}"`).toBeGreaterThanOrEqual(MIN);
        expect(row.height, `height of "${row.text}"`).toBeGreaterThanOrEqual(MIN);
      }
    });
  }
}
