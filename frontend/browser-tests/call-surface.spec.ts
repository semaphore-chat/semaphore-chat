import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';
import { tokens } from '../src/theme/generated/tokens.ts';

/** The least the shown pane keeps while a call bar is there: a composer (as kit/layout/ThreeIslands PANE_MIN). */
const PANE_MIN = tokens.control.md + tokens.space.sm + tokens.space.lg;

/** The height of the three-islands grid (the size container the surface's cap is measured against). */
const gridHeight = (page: Page) =>
  page.evaluate(() => {
    let el = document.querySelector('[data-kit-call-surface]')?.parentElement ?? null;
    while (el && getComputedStyle(el).containerType !== 'size') el = el.parentElement;
    return el ? el.getBoundingClientRect().height : -1;
  });

/**
 * The call slot at real sizes (review C1, I2): however much video the call has, the surface keeps to its share
 * of the frame and scrolls inside itself, so Leave and Mute stay whole, on screen and on top, the composer
 * keeps its place, and the page itself never scrolls. With the on-screen keyboard up the surface is one
 * summary line. A reason the mic cannot open is read in full, on two lines at most, at 320 px.
 */
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 640 };

/** The bottom of what is visible: the visual viewport (the faked keyboard covers the rest). */
const visibleBottom = (page: Page) => page.evaluate(() => window.visualViewport?.height ?? window.innerHeight);

async function expectWholeAndOnTop(page: Page, name: string, view: { width: number }) {
  const button = page.getByRole('region', { name: /^Call in / }).getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  const b = (await button.boundingBox())!;
  const bottom = await visibleBottom(page);
  expect(b.x, `${name}: left edge`).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, `${name}: right edge`).toBeLessThanOrEqual(view.width);
  expect(b.y, `${name}: top edge`).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, `${name}: bottom edge`).toBeLessThanOrEqual(bottom);
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
    [b.x + b.width / 2, b.y + b.height / 2],
  );
  expect(hit, `${name}: nothing is drawn over its centre`).toBe(name);
}

async function expectNoPageScroll(page: Page) {
  const scroll = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth <= window.innerWidth,
    down: document.documentElement.scrollHeight <= window.innerHeight,
    y: window.scrollY,
  }));
  expect(scroll).toEqual({ sideways: true, down: true, y: 0 });
}

/** The bar row is whole: its region is not cut by any scrolling or clipping ancestor. */
async function expectBarWhole(page: Page) {
  const clipped = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="lounge-call-bar"]');
    if (!bar) return 'no bar';
    const r = bar.getBoundingClientRect();
    for (let el = bar.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowY === 'visible' && style.overflowX === 'visible') continue;
      const p = el.getBoundingClientRect();
      if (r.top < p.top - 0.5 || r.bottom > p.bottom + 0.5) return `cut by ${el.tagName}.${el.className}`;
    }
    return null;
  });
  expect(clipped).toBeNull();
}

const CASES: { story: string; view: { width: number; height: number }; keyboard?: boolean }[] = [
  { story: 'call-surface--four-tiles', view: PHONE },
  { story: 'call-surface--four-tiles', view: SMALL },
  { story: 'call-surface--one-tile-keyboard', view: PHONE, keyboard: true },
  { story: 'call-surface--two-tiles-keyboard', view: PHONE, keyboard: true },
  { story: 'call-surface--two-tiles-keyboard', view: SMALL, keyboard: true },
  { story: 'call-surface--ten-cameras', view: SMALL },
  { story: 'call-surface--long-name-everything', view: PHONE },
  { story: 'call-surface--long-name-everything', view: SMALL },
];

for (const { story, view, keyboard } of CASES) {
  test(`${story} at ${view.width}×${view.height}: Leave and Mute whole and on top, the page does not scroll`, async ({ page }) => {
    await openStory(page, story, view);
    await expectWholeAndOnTop(page, 'Leave call', view);
    await expectWholeAndOnTop(page, 'Mute', view);
    await expectBarWhole(page);
    await expectNoPageScroll(page);
    // The composer keeps a place on screen too.
    const composer = page.getByPlaceholder('Message #general');
    await expect(composer).toBeVisible();
    const c = (await composer.boundingBox())!;
    expect(c.y + c.height).toBeLessThanOrEqual(await visibleBottom(page));
    const surface = page.locator('[data-kit-call-surface]');
    const summary = page.getByTestId('lounge-call-summary');
    if (keyboard) {
      // One line instead of the surface.
      await expect(surface).toBeHidden();
      await expect(summary).toBeVisible();
      const s = (await summary.boundingBox())!;
      expect(s.height).toBeLessThanOrEqual(80);
    } else {
      await expect(summary).toBeHidden();
      // Bounded to two fifths of the layout's grid (less than the viewport), scrolling inside itself.
      const box = (await surface.boundingBox())!;
      const grid = await gridHeight(page);
      expect(grid).toBeGreaterThan(0);
      expect(box.height).toBeLessThanOrEqual(Math.ceil(grid * 0.4) + 1);
    }
  });
}

test('the surface scrolls inside itself: its last row can be scrolled to, the page stays put', async ({ page }) => {
  await openStory(page, 'call-surface--four-tiles', PHONE);
  const surface = page.locator('[data-kit-call-surface]');
  const overflow = await surface.evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight, style: getComputedStyle(el).overflowY }));
  expect(overflow).toEqual({ scrolls: true, style: 'auto' });
  const stop = page.getByRole('button', { name: 'Stop watching' });
  await stop.scrollIntoViewIfNeeded();
  await expect(stop).toBeInViewport();
  await expectNoPageScroll(page);
  await expectWholeAndOnTop(page, 'Leave call', PHONE);
});

test('ten cameras, none watched: a summary row and three rows, not ten', async ({ page }) => {
  await openStory(page, 'call-surface--ten-cameras', SMALL);
  await expect(page.getByText('10 cameras on', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Watch / })).toHaveCount(3);
});

for (const story of ['call-bar--timed-out', 'call-bar--server-muted', 'call-bar--blocked', 'call-bar--deafened-mic-on']) {
  test(`${story} at 320 px: the reason is read in full, on two lines at most, never cut`, async ({ page }) => {
    await openStory(page, story, SMALL);
    const line = page.getByTestId('lounge-call-line').locator('p');
    await expect(line).toBeVisible();
    const m = await line.evaluate((el) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        lines: Math.round(r.height / parseFloat(style.lineHeight)),
        fitsWidth: el.scrollWidth <= el.clientWidth,
        fitsHeight: el.scrollHeight <= el.clientHeight + 0.5,
        ellipsis: style.textOverflow === 'ellipsis',
        nowrap: style.whiteSpace === 'nowrap',
        inViewport: r.left >= 0 && r.right <= window.innerWidth,
      };
    });
    expect(m.lines).toBeGreaterThanOrEqual(1);
    expect(m.lines).toBeLessThanOrEqual(2);
    expect(m).toMatchObject({ fitsWidth: true, fitsHeight: true, ellipsis: false, nowrap: false, inViewport: true });
    // A blocked mic is still a Tab stop, named and unavailable; deafened with the mic on, it can mute.
    const mute = page.getByRole('button', { name: 'Mute', exact: true });
    expect(await mute.getAttribute('aria-disabled')).toBe(story === 'call-bar--deafened-mic-on' ? null : 'true');
    expect(await mute.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);
    await expectWholeAndOnTop(page, 'Leave call', SMALL);
    await expectNoPageScroll(page);
  });
}

test('an unavailable mic: Tab reaches it, Enter says why and changes nothing', async ({ page }) => {
  await openStory(page, 'kit-icon-button--unavailable', PHONE);
  const mute = page.getByRole('button', { name: 'Mute' }).first();
  await page.keyboard.press('Tab');
  await expect(mute).toBeFocused();
  await expect(mute).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('unavailable-said')).toHaveText('Said "Muted by a moderator" 1×');
  // Holding Enter (the key repeats, the button clicks on each repeat) says it once more, not once per repeat.
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.getByTestId('unavailable-said')).toHaveText('Said "Muted by a moderator" 2×');
  // Hovering shows no hover layer (it is unavailable), but the title is there for a pointer.
  expect(await mute.getAttribute('title')).toBe('Muted by a moderator');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('a small Button (Watch, Cancel, Open) gets a touch-sized hit area, as a small IconButton does', async ({ page }) => {
    await openStory(page, 'call-surface--ten-cameras', PHONE);
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    const watch = page.getByRole('button', { name: /^Watch / }).first();
    const after = await watch.evaluate((el) => {
      const style = getComputedStyle(el, '::after');
      return { content: style.content, position: style.position, top: style.top, left: style.left };
    });
    expect(after).toEqual({ content: '""', position: 'absolute', top: '-4px', left: '-4px' });
    // A tap just above its drawn edge still lands on it.
    const b = (await watch.boundingBox())!;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
      [b.x + b.width / 2, b.y - 2],
    );
    expect(hit).toBe(await watch.getAttribute('aria-label'));
  });
});

/** The worst cases at 320×640 (review N1): app banners take height first; the cap counts what is left. */
const WORST: { story: string; keyboard: boolean; banners: number }[] = [
  { story: 'call-surface--everything-one-banner', keyboard: false, banners: 1 },
  { story: 'call-surface--everything-two-banners', keyboard: false, banners: 2 },
  { story: 'call-surface--everything-two-banners-keyboard', keyboard: true, banners: 2 },
];

for (const { story, keyboard, banners } of WORST) {
  test(`${story} at 320×640: Leave and Mute whole and on top${keyboard ? '' : ', the pane keeps a composer, the dock whole'}`, async ({ page }) => {
    await openStory(page, story, SMALL);
    await expect(page.locator('[data-slot="banner"] > *')).toHaveCount(banners);
    await expectWholeAndOnTop(page, 'Leave call', SMALL);
    await expectWholeAndOnTop(page, 'Mute', SMALL);
    await expectNoPageScroll(page);
    if (!keyboard) {
      await expectBarWhole(page);
      const pane = (await page.getByRole('main').boundingBox())!;
      expect(pane.height, 'the shown pane keeps at least a composer').toBeGreaterThanOrEqual(PANE_MIN - 1);
      const dock = (await page.locator('nav[aria-label="Pinned communities"]').boundingBox())!;
      expect(dock.y + dock.height, 'the dock is not clipped').toBeLessThanOrEqual(SMALL.height);
      // The video gave way: within two fifths of the grid, and the bar's reason line is whole.
      const surface = (await page.locator('[data-kit-call-surface]').boundingBox())!;
      expect(surface.height).toBeLessThanOrEqual(Math.ceil((await gridHeight(page)) * 0.4) + 1);
      const line = (await page.getByTestId('lounge-call-line').boundingBox())!;
      expect(line.y + line.height).toBeLessThanOrEqual(dock.y);
    } else {
      await expect(page.getByTestId('lounge-call-summary')).toBeVisible();
    }
  });
}

test('keyboard up while you share: Stop sharing is in the one-line summary, whole and on top', async ({ page }) => {
  await openStory(page, 'call-surface--own-share-keyboard', PHONE);
  const stop = page.getByTestId('lounge-call-summary').getByRole('button', { name: 'Stop sharing' });
  await expect(stop).toBeVisible();
  const b = (await stop.boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(await visibleBottom(page));
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null,
    [b.x + b.width / 2, b.y + b.height / 2],
  );
  expect(hit).toBe('Stop sharing');
});
