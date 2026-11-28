import { expect, test, type Page } from '@playwright/test';
import { tokens } from '../src/theme/generated/tokens.ts';
import { openStory } from './story.ts';

/**
 * The shell's pieces on the settings layout and the stage inside an island, at real widths (#848 C4, S1): jsdom does
 * not lay out. The settings layout's dock and call bar sit where the three islands put them: at compact and wide the
 * dock above the nav island and the call bar under it in the 288 px left column; on a phone the pane, then the call
 * bar, then the dock bar. Nothing scrolls the page and nothing leaves the grid.
 */
const { phone, docked } = tokens.breakpoint;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

async function boxes(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null) => {
      if (element === null) throw new Error('missing element');
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const call = document.querySelector('[data-slot="call-bar"]');
    const nav = document.querySelector('nav[aria-label="Community settings sections"]');
    const main = document.querySelector('main');
    let grid: HTMLElement | null = main;
    while (grid && getComputedStyle(grid).display !== 'grid') grid = grid.parentElement;
    const dock = document.querySelector('[data-slot="dock"]');
    const shown = (element: Element | null) => element !== null && element.getBoundingClientRect().height > 0;
    const doc = document.documentElement;
    return {
      call: box(call),
      nav: shown(nav) ? box(nav) : null,
      main: box(main),
      grid: box(grid),
      dock: shown(dock) ? box(dock) : null,
      pageScroll: { x: doc.scrollWidth > doc.clientWidth, y: doc.scrollHeight > doc.clientHeight },
    };
  });
}

const inside = (inner: Box, outer: Box) =>
  inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;

for (const { width, height } of [
  { width: docked, height: 800 },
  { width: docked - 1, height: 800 },
  { width: phone, height: 800 },
  { width: 1440, height: 900 },
  { width: 820, height: 1180 },
]) {
  test(`kit-settings-layout--with-dock-and-call at ${width}x${height}: the dock above the nav, the call bar under it`, async ({ page }) => {
    await openStory(page, 'kit-settings-layout--with-dock-and-call', { width, height });
    const m = await boxes(page);
    expect(m.pageScroll).toEqual({ x: false, y: false });
    expect(m.nav, 'the nav island').not.toBeNull();
    expect(m.dock, 'the dock').not.toBeNull();
    const nav = m.nav!;
    const dock = m.dock!;
    expect(Math.round(nav.width)).toBe(tokens.layout.leftColumn);
    // One column: the dock, the nav, the call bar, top to bottom, all left of the content.
    expect(Math.round(dock.left)).toBe(Math.round(nav.left));
    expect(Math.round(m.call.left)).toBe(Math.round(nav.left));
    expect(dock.bottom).toBeLessThanOrEqual(nav.top + 1);
    expect(nav.bottom).toBeLessThanOrEqual(m.call.top + 1);
    expect(m.call.right).toBeLessThanOrEqual(m.main.left + 1);
    for (const piece of [dock, nav, m.call, m.main]) expect(inside(piece, m.grid)).toBe(true);
  });
}

for (const { width, height } of [
  { width: phone - 1, height: 800 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`kit-settings-layout--with-dock-and-call at ${width}x${height} (phone): the section, then the call bar, then the dock bar`, async ({ page }) => {
    await openStory(page, 'kit-settings-layout--with-dock-and-call', { width, height });
    const m = await boxes(page);
    expect(m.pageScroll).toEqual({ x: false, y: false });
    expect(m.dock, 'the dock bar').not.toBeNull();
    const dock = m.dock!;
    expect(m.main.bottom).toBeLessThanOrEqual(m.call.top + 1);
    expect(m.call.bottom).toBeLessThanOrEqual(dock.top + 1);
    // The section keeps room above the call bar.
    expect(m.main.bottom - m.main.top).toBeGreaterThan(200);
    for (const piece of [dock, m.call, m.main]) expect(inside(piece, m.grid)).toBe(true);
  });
}

for (const { width, height } of [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
]) {
  test(`kit-stage-layout--in-island at ${width}x${height}: one main; header, stage and controls inside it`, async ({ page }) => {
    await openStory(page, 'kit-stage-layout--in-island', { width, height });
    const m = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`missing ${selector}`);
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
      };
      const doc = document.documentElement;
      return {
        mains: document.querySelectorAll('main').length,
        main: box('main'),
        header: box('[data-slot="header"]'),
        stage: box('[data-slot="stage"]'),
        controls: box('[data-slot="controls"]'),
        pageScroll: { x: doc.scrollWidth > doc.clientWidth, y: doc.scrollHeight > doc.clientHeight },
      };
    });
    expect(m.mains).toBe(1);
    expect(m.pageScroll).toEqual({ x: false, y: false });
    for (const part of [m.header, m.stage, m.controls]) expect(inside(part, m.main)).toBe(true);
    expect(m.header.bottom).toBeLessThanOrEqual(m.stage.top + 1);
    expect(m.stage.bottom).toBeLessThanOrEqual(m.controls.top + 1);
    // The controls sit at the island's foot.
    expect(m.main.bottom - m.controls.bottom).toBeLessThan(48);
  });
}
