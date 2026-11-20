import { expect, test } from '@playwright/test';
import { tokens } from '../src/theme/generated/tokens.ts';
import { openStory } from './story.ts';

/**
 * The chat layout at real widths (jsdom does not lay out or evaluate media queries; AppFrame.test.tsx and
 * ThreeIslands.test.tsx only read the declarations): the page never scrolls, the frame is the viewport, and the
 * grid has the right number of columns for the width range, on both sides of each breakpoint.
 */
const { phone, docked } = tokens.breakpoint;

const CASES = [
  { width: phone - 1, height: 800, columns: 1 },
  { width: phone, height: 800, columns: 2 },
  { width: docked - 1, height: 800, columns: 2 },
  { width: docked, height: 800, columns: 3 },
  { width: 390, height: 844, columns: 1 },
  { width: 820, height: 1180, columns: 2 },
  { width: 1440, height: 900, columns: 3 },
];

for (const { width, height, columns } of CASES) {
  test(`kit-three-islands--chat at ${width}x${height}: no page scroll, frame fills the viewport, ${columns} column(s)`, async ({ page }) => {
    await openStory(page, 'kit-three-islands--chat', { width, height });

    const measured = await page.evaluate(() => {
      const doc = document.documentElement;
      // The layout's grid is the nearest grid ancestor of the main island; the AppFrame is its parent.
      let grid: HTMLElement | null = document.querySelector('main');
      while (grid && getComputedStyle(grid).display !== 'grid') {
        grid = grid.parentElement;
      }
      if (!grid?.parentElement) {
        throw new Error('no grid around the main island');
      }
      const frame = grid.parentElement.getBoundingClientRect();
      // A column is a distinct left edge among the grid's laid-out children (the dock and the call bar share the
      // left column; a closed Sheet renders nothing in the grid).
      const boxes = Array.from(grid.children)
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const widthAt = new Map<number, number>();
      for (const rect of boxes) {
        widthAt.set(Math.round(rect.left), Math.round(rect.width));
      }
      const cells = grid.getBoundingClientRect();
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        scrollHeight: doc.scrollHeight,
        clientHeight: doc.clientHeight,
        frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
        // Column widths, left to right.
        columns: [...widthAt.entries()].sort(([a], [b]) => a - b).map(([, w]) => w),
        // Every laid-out child stays inside the grid (the frame clips, so an overflow would not scroll the page).
        outside: boxes.filter(
          (rect) => rect.left < cells.left - 1 || rect.right > cells.right + 1 || rect.top < cells.top - 1 || rect.bottom > cells.bottom + 1,
        ).length,
      };
    });

    expect(measured.scrollWidth, 'horizontal page scroll').toBeLessThanOrEqual(measured.clientWidth);
    expect(measured.scrollHeight, 'vertical page scroll').toBeLessThanOrEqual(measured.clientHeight);
    expect(measured.frame.left).toBeCloseTo(0, 0);
    expect(measured.frame.top).toBeCloseTo(0, 0);
    expect(measured.frame.width).toBeCloseTo(width, 0);
    expect(measured.frame.height).toBeCloseTo(height, 0);
    expect(measured.columns.length, `visible columns ${JSON.stringify(measured.columns)}`).toBe(columns);
    expect(measured.outside, 'grid children outside the grid').toBe(0);
    // The side columns are their tokens' widths; the centre takes the rest.
    if (columns >= 2) {
      expect(measured.columns[0], 'left column width').toBe(tokens.layout.leftColumn);
    }
    if (columns === 3) {
      expect(measured.columns[2], 'right column width').toBe(tokens.layout.rightColumn);
    }
  });
}
