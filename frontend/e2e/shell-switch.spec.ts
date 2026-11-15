/**
 * The shell switch: with the new design off (every user today) nothing
 * changes and nothing of the new shell is fetched; the hidden ways in (a
 * `?design=` link for one tab, the account switch at /debug/design) show the
 * marker screen at /__lounge, and "Back to the app" leads to the old shell.
 *
 * Run: scripts/run-e2e.sh shell-switch
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Request } from '@playwright/test';
import { test, expect, TEST_USER, API_BASE, MEMBER_USER, createWorld, openSession, shot } from './fixtures';

test.describe.configure({ mode: 'serial' });

/**
 * Requests that would mean the new shell or the kit fonts loaded: its modules (dev server) or chunks
 * (build), the kit, or the kit's font families. Not shell/loungeRootChunk.ts: that two-line loader is
 * eager by design (in a build it is part of the entry chunk).
 */
const NEW_SHELL_REQUEST = /\/src\/shell\/lounge\/|\/assets\/(LoungeRoot|MarkerScreen)-|\/src\/kit\/|bricolage|figtree/i;

/** The viewport meta tag as index.html ships it: this change must not touch it. */
const VIEWPORT_META = /<meta name="viewport" content="([^"]+)"/.exec(
  readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8'),
)![1];

function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request: Request) => urls.push(request.url()));
  return urls;
}

const marker = (page: Page) => page.getByRole('heading', { name: 'New design preview' });
const oldShell = (page: Page) => page.getByTestId('shortcut-announcer');

async function setAccountNewDesign(page: Page, token: string, on: boolean): Promise<void> {
  const res = await page.request.patch(`${API_BASE}/appearance-settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { newDesign: on },
  });
  expect(res.ok(), `PATCH appearance-settings: ${res.status()}`).toBe(true);
}

test.describe('Shell switch', () => {
  test('with the new design off, nothing changes and nothing of the new shell is fetched', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await createWorld(request);
    const { context, page, token } = await openSession(browser, TEST_USER);
    try {
      await setAccountNewDesign(page, token, false);
      const urls = recordRequests(page);
      await page.goto('/#/');
      await page.reload();
      await expect(oldShell(page)).toBeAttached();

      await page.goto(`/#/community/${world.communityId}`);
      await expect(page.getByRole('textbox', { name: /^Message #/ })).toBeVisible();
      await expect(oldShell(page)).toBeAttached();

      await page.goto('/#/__lounge');
      await expect(page.getByText('Page not found')).toBeVisible();
      await expect(oldShell(page)).toBeAttached();
      await expect(marker(page)).toHaveCount(0);
      await shot(page, testInfo, '1-marker-route-is-not-found-with-the-setting-off');

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.filter((url) => NEW_SHELL_REQUEST.test(url))).toEqual([]);
      expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toBe(VIEWPORT_META);
    } finally {
      await context.close();
    }
  });

  test('a ?design= link turns the preview on for this tab only, and reset clears it', async ({ browser }, testInfo) => {
    const { context, page, token } = await openSession(browser, TEST_USER);
    try {
      await setAccountNewDesign(page, token, false);
      await page.goto('/#/__lounge?design=lounge');
      await expect(marker(page)).toBeVisible();
      await expect(page).toHaveURL(/#\/__lounge$/);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached();
      await expect(oldShell(page)).toHaveCount(0);
      await shot(page, testInfo, '2-marker-from-a-preview-link');

      // A reload keeps the tab's preview.
      await page.reload();
      await expect(marker(page)).toBeVisible();
      await expect(page.getByText('Page not found')).toHaveCount(0);

      // Another browser context (another tab or device) does not have it.
      const other = await openSession(browser, TEST_USER);
      try {
        await other.page.goto('/#/__lounge');
        await expect(other.page.getByText('Page not found')).toBeVisible();
        await expect(marker(other.page)).toHaveCount(0);
      } finally {
        await other.context.close();
      }

      await page.goto('/#/__lounge?design=reset');
      await expect(page.getByText('Page not found')).toBeVisible();
      await expect(page).toHaveURL(/#\/__lounge$/);
      await expect(marker(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('the account switch at /debug/design shows the new design on another device, then turns it off', async ({
    browser,
  }, testInfo) => {
    const { context, page, token } = await openSession(browser, MEMBER_USER);
    try {
      await setAccountNewDesign(page, token, false);
      await page.goto('/#/debug/design');
      // The card is inside the app shell: the old shell is around it.
      await expect(oldShell(page)).toBeAttached();
      const toggle = page.getByLabel('New design (saved to your account)');
      await expect(toggle).not.toBeChecked();
      const saved = page.waitForResponse(
        (response) => response.url().includes('/api/appearance-settings') && response.request().method() === 'PATCH',
      );
      await toggle.check();
      expect((await saved).ok()).toBe(true);
      await shot(page, testInfo, '3-debug-card-on');

      const other = await openSession(browser, MEMBER_USER);
      try {
        await other.page.goto('/#/__lounge');
        await expect(marker(other.page)).toBeVisible();
      } finally {
        await other.context.close();
      }

      // Off again, through the same switch.
      const savedOff = page.waitForResponse(
        (response) => response.url().includes('/api/appearance-settings') && response.request().method() === 'PATCH',
      );
      await toggle.uncheck();
      expect((await savedOff).ok()).toBe(true);
      await page.goto('/#/__lounge');
      await expect(page.getByText('Page not found')).toBeVisible();
    } finally {
      await setAccountNewDesign(page, token, false).catch(() => {});
      await context.close();
    }
  });

  test('"Back to the app" leads to the old shell at /', async ({ browser }) => {
    const { context, page, token } = await openSession(browser, TEST_USER);
    try {
      await setAccountNewDesign(page, token, false);
      await page.goto('/#/__lounge?design=lounge');
      await expect(marker(page)).toBeVisible();
      await page.getByRole('button', { name: 'Back to the app' }).click();
      await expect(page).toHaveURL(/#\/$/);
      await expect(oldShell(page)).toBeAttached();
      await expect(marker(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1440, height: 900 },
  ]) {
    test(`at ${viewport.width} px the marker fills the frame with no page scroll`, async ({ browser }, testInfo) => {
      const { context, page } = await openSession(browser, TEST_USER, viewport);
      try {
        await page.goto('/#/__lounge?design=lounge');
        await expect(marker(page)).toBeVisible();
        const box = await page.getByRole('main', { name: 'New design preview' }).boundingBox();
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        }));
        expect(metrics.scrollWidth, 'no horizontal page scroll').toBeLessThanOrEqual(metrics.innerWidth);
        expect(metrics.scrollHeight, 'no vertical page scroll').toBeLessThanOrEqual(metrics.innerHeight);
        expect(box).not.toBeNull();
        // The island sits inside the frame's gutter and takes most of the screen.
        expect(box!.x).toBeGreaterThan(0);
        expect(box!.y).toBeGreaterThan(0);
        expect(box!.x + box!.width).toBeLessThan(viewport.width);
        expect(box!.y + box!.height).toBeLessThan(viewport.height);
        expect(box!.width).toBeGreaterThan(viewport.width * 0.9);
        expect(box!.height).toBeGreaterThan(viewport.height * 0.9);
        await shot(page, testInfo, `5-marker-${viewport.width}`);
      } finally {
        await context.close();
      }
    });
  }
});
