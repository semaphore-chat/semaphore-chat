import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * On a phone ThreeIslands shows one pane and keeps the other mounted but `hidden` and `inert`. jsdom ignores
 * `inert` for focus and the accessibility tree (ThreeIslands.test.tsx pins the attributes only); here a real
 * browser walks the Tab order (Chromium and Firefox) and builds the accessibility tree (Chromium).
 */
const PHONE = { width: 390, height: 844 };

/** Presses Tab from the top of the page until focus leaves the page or comes back round; returns each stop. */
async function tabStops(page: Page, max = 60) {
  const stops: { label: string; inLeftPane: boolean; inCentrePane: boolean }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) {
        return null;
      }
      return {
        label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? el.tagName,
        inLeftPane: !!el.closest('nav[aria-label="Channels"]'),
        inCentrePane: !!el.closest('[aria-label="general in Couch Co-op"]'),
      };
    });
    if (!stop || (stops.length > 0 && stop.label === stops[0].label)) {
      break;
    }
    stops.push(stop);
  }
  return stops;
}

/**
 * The browser's own accessibility tree (Chromium, over CDP): the roles and names of the nodes it exposes.
 * Playwright's ariaSnapshot is its own approximation and does not drop `inert` content, so it cannot prove this.
 */
async function exposedLandmarks(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes: { ignored: boolean; role?: { value?: string }; name?: { value?: string } }[];
  };
  await cdp.detach();
  return nodes
    .filter((node) => !node.ignored && ['main', 'navigation', 'complementary'].includes(node.role?.value ?? ''))
    .map((node) => `${node.role?.value} "${node.name?.value ?? ''}"`);
}

test.describe('phone: the hidden pane', { tag: '@keyboard' }, () => {
  test('Tab from the top never lands in the hidden channel list', async ({ page }) => {
    await openStory(page, 'kit-three-islands--chat', PHONE);
    // The hidden pane is still mounted (a draft in it survives).
    await expect(page.locator('nav[aria-label="Channels"]')).toHaveCount(1);

    const stops = await tabStops(page);
    expect(stops.length, 'some Tab stops').toBeGreaterThan(2);
    expect(stops.some((stop) => stop.inCentrePane), 'Tab reaches the conversation').toBe(true);
    expect(stops.filter((stop) => stop.inLeftPane), 'Tab stops in the hidden pane').toEqual([]);
  });

  test('showing the channel list: Tab never lands in the hidden conversation', async ({ page }) => {
    await openStory(page, 'kit-three-islands--phone-left', PHONE);

    const stops = await tabStops(page);
    expect(stops.some((stop) => stop.inLeftPane), 'Tab reaches the channel list').toBe(true);
    expect(stops.filter((stop) => stop.inCentrePane), 'Tab stops in the hidden pane').toEqual([]);
  });
});

// Chromium only (the firefox project runs @keyboard specs): the tree is read over CDP.
test('the accessibility tree has exactly one main and not the hidden pane', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'reads the browser accessibility tree over CDP');
  await openStory(page, 'kit-three-islands--chat', PHONE);
  const landmarks = await exposedLandmarks(page);
  expect(landmarks.filter((landmark) => landmark.startsWith('main ')), landmarks.join(', ')).toHaveLength(1);
  expect(landmarks).not.toContain('navigation "Channels"');

  await openStory(page, 'kit-three-islands--phone-left', PHONE);
  const left = await exposedLandmarks(page);
  expect(left.filter((landmark) => landmark.startsWith('main ')), left.join(', ')).toHaveLength(1);
  expect(left).not.toContain('main "general in Couch Co-op"');
});
