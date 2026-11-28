/**
 * Android's Back in the Lounge (kit/behaviour/hosts/systemBack.ts): on a phone-sized touch browser, Back closes the
 * top layer (a menu, a sheet, the picture viewer) before it leaves the chat, and the thread (its own route entry)
 * still takes exactly one Back. `page.goBack()` is the browser's Back: the same history traversal and `popstate`
 * Android's Back gesture or button makes. Layers are opened with taps, as a finger would (Chrome skips history
 * entries pushed without a user gesture when the user presses Back).
 *
 * Run: scripts/run-e2e.sh lounge-back
 */
import type { Browser, Page } from '@playwright/test';
import { test, expect, API_BASE, sendTestMessage, deleteWorlds, createTestChannel } from './fixtures';
import { chatPath, loungePath, loungeWorld, openFixture } from './fixtures/lounge';

test.describe.configure({ timeout: 120_000 });

const EVENTUAL = { timeout: 20_000 };
/** A Pixel 7's CSS size, with touch: `(pointer: coarse)` matches, so the system Back is on. */
const PIXEL = { width: 412, height: 915 };
/** A tablet's CSS size (compact), with touch. */
const TABLET = { width: 820, height: 1180 };

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const chatHeading = (page: Page, name: string) => page.getByRole('heading', { name: `# ${name}`, level: 1 });
const threadHeading = (page: Page) => page.getByRole('heading', { name: 'Thread', level: 1 });
const messages = (page: Page) => page.getByRole('list', { name: 'Messages' });
const row = (page: Page, text: string) => messages(page).getByRole('article').filter({ hasText: text });

async function openTouchSession(
  browser: Browser,
  credentials: { username: string; password: string },
  viewport: { width: number; height: number } = PIXEL,
) {
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2.625,
    storageState: { cookies: [], origins: [] },
  });
  const login = await context.request.post(`${API_BASE}/auth/login`, { data: credentials });
  if (!login.ok()) throw new Error(`Login failed: ${login.status()} ${await login.text()}`);
  const page = await context.newPage();
  await page.goto('/');
  return { context, page };
}

/** Opens the chat on the real route with the new design on, on top of the page `openTouchSession` loaded. */
async function openChat(page: Page, communityId: string, channelId: string): Promise<string> {
  const path = chatPath('real', communityId, channelId);
  await page.goto(`/#${path}?design=lounge`);
  await expect(page.locator('[data-shell="lounge"]')).toBeAttached(EVENTUAL);
  expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
  return path;
}

/** The URL is the chat's, with nothing after the path but the design switch. */
const onChat = (path: string) => new RegExp(`#${escapeRe(path)}(\\?design=lounge)?$`);

test.afterEach(async ({ request }) => deleteWorlds(request));

test.describe('Android Back closes the top layer (412 px, touch)', () => {
  test('Back closes the More menu, then the pinned sheet opened from it, then leaves the chat', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const pinned = await sendTestMessage(request, world.c1.lobbyId, 'the pinned rules of the lobby', world.owner.token);
    const pin = await request.post(`${API_BASE}/moderation/pin/${pinned.id}`, { data: {}, headers: { Authorization: `Bearer ${world.owner.token}` } });
    expect(pin.ok()).toBe(true);
    const { context, page } = await openTouchSession(browser, world.member);
    try {
      const path = await openChat(page, world.c1.id, world.c1.lobbyId);
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);

      // A menu: Back closes it and the chat stays.
      await page.getByRole('button', { name: 'More' }).tap();
      await expect(page.getByRole('menu')).toBeVisible(EVENTUAL);
      await page.goBack();
      await expect(page.getByRole('menu')).toHaveCount(0, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toBeVisible();
      await expect(page).toHaveURL(onChat(path));

      // A sheet opened from a menu item (the menu's entry goes, the sheet's comes): one Back closes the sheet.
      await page.getByRole('button', { name: 'More' }).tap();
      await page.getByRole('menuitem', { name: 'Pinned messages (1)' }).tap();
      const sheet = page.getByRole('dialog', { name: 'Pinned messages (1)' });
      await expect(sheet).toBeVisible(EVENTUAL);
      await expect(page.getByRole('menu')).toHaveCount(0);
      await page.goBack();
      await expect(sheet).toHaveCount(0, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toBeVisible();
      await expect(page).toHaveURL(onChat(path));

      // Nothing open: Back leaves the chat (no dead entry left behind by either layer).
      await page.goBack();
      await expect(page).not.toHaveURL(onChat(path), EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toHaveCount(0, EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test('Back closes the picture viewer; a layer closed by its own button leaves no entry behind', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    // A 2×1 PNG: an image the server accepts and records the size of.
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZYAwAZOsJ93W0OVsAAAAASUVORK5CYII=', 'base64');
    const { context, page } = await openTouchSession(browser, world.member);
    try {
      const path = await openChat(page, world.c1.id, world.c1.lobbyId);
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await page.locator('input[type="file"]').first().setInputFiles({ name: 'e2e-picture.png', mimeType: 'image/png', buffer: PNG });
      await page.getByRole('textbox', { name: 'Message #lobby' }).fill('a picture for the viewer');
      await page.getByRole('button', { name: 'Send message' }).tap();
      const picture = row(page, 'a picture for the viewer').getByRole('button', { name: 'Open image e2e-picture.png' });
      await expect(picture).toBeVisible(EVENTUAL);

      const viewer = page.getByRole('dialog', { name: 'e2e-picture.png' });
      await picture.tap();
      await expect(viewer).toBeVisible(EVENTUAL);
      await page.goBack();
      await expect(viewer).toHaveCount(0, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toBeVisible();
      await expect(page).toHaveURL(onChat(path));

      // Closed by its Close button: its entry goes with it, so the next Back leaves the chat at once.
      await picture.tap();
      await expect(viewer).toBeVisible(EVENTUAL);
      await viewer.getByRole('button', { name: 'Close' }).tap();
      await expect(viewer).toHaveCount(0, EVENTUAL);
      await expect.poll(() => page.evaluate(() => JSON.stringify(window.history.state)), EVENTUAL).not.toContain('__kitLayers');
      await page.goBack();
      await expect(page).not.toHaveURL(onChat(path), EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test('the thread takes one Back, also when it was opened from a sheet that navigated', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const parent = await sendTestMessage(request, world.c1.lobbyId, 'a thread with a pinned reply', world.owner.token);
    const reply = await request.post(`${API_BASE}/threads/${parent.id}/replies`, {
      data: { spans: [{ type: 'PLAINTEXT', text: 'the pinned reply' }], attachments: [] },
      headers: { Authorization: `Bearer ${world.owner.token}` },
    });
    expect(reply.ok()).toBe(true);
    const replyId = ((await reply.json()) as { id: string }).id;
    const pin = await request.post(`${API_BASE}/moderation/pin/${replyId}`, { data: {}, headers: { Authorization: `Bearer ${world.owner.token}` } });
    expect(pin.ok()).toBe(true);
    const { context, page } = await openTouchSession(browser, world.member);
    try {
      const path = await openChat(page, world.c1.id, world.c1.lobbyId);
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);

      // Straight from the row: one Back closes the thread.
      await row(page, 'a thread with a pinned reply').getByRole('button', { name: '1 reply, open the thread' }).tap();
      await expect(threadHeading(page)).toBeVisible(EVENTUAL);
      await page.goBack();
      await expect(threadHeading(page)).toHaveCount(0, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toBeVisible();

      // From the pinned sheet: the thread's route is pushed before the sheet closes, which leaves the sheet's entry
      // under the thread. Back closes the thread, and the next Back leaves the chat: the dead entry is stepped over.
      await page.getByRole('button', { name: 'More' }).tap();
      await page.getByRole('menuitem', { name: /Pinned messages/ }).tap();
      await page.getByRole('dialog').getByRole('button', { name: /the pinned reply/ }).tap();
      await expect(threadHeading(page)).toBeVisible(EVENTUAL);
      await expect(page.getByRole('dialog')).toHaveCount(0, EVENTUAL);
      await page.goBack();
      await expect(threadHeading(page)).toHaveCount(0, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toBeVisible();
      await expect(page).toHaveURL(onChat(path), EVENTUAL);
      await page.goBack();
      await expect(page).not.toHaveURL(onChat(path), EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toHaveCount(0, EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test('a plain pin (a replace from the closing sheet): one Back leaves the chat, and the header back arrow works on the first tap', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const pinned = await sendTestMessage(request, world.c1.lobbyId, 'the pinned rules of the lobby', world.owner.token);
    const pin = await request.post(`${API_BASE}/moderation/pin/${pinned.id}`, { data: {}, headers: { Authorization: `Bearer ${world.owner.token}` } });
    expect(pin.ok()).toBe(true);
    const { context, page } = await openTouchSession(browser, world.member);
    const home = new RegExp(`#${escapeRe(loungePath('real', world.c1.id))}$`);
    const lobby = page.getByRole('navigation', { name: 'Community', exact: true }).getByRole('link', { name: /^lobby/ });
    const jump = async () => {
      await page.getByRole('button', { name: 'More' }).tap();
      await page.getByRole('menuitem', { name: 'Pinned messages (1)' }).tap();
      const sheet = page.getByRole('dialog', { name: 'Pinned messages (1)' });
      await sheet.getByRole('button', { name: /the pinned rules of the lobby/ }).tap();
      await expect(sheet).toHaveCount(0, EVENTUAL);
      await expect(row(page, 'the pinned rules of the lobby')).toBeInViewport(EVENTUAL);
      // The jump's own clean-up (`?highlight=` dropped by a replace) has run.
      await expect(page).toHaveURL(onChat(chatPath('real', world.c1.id, world.c1.lobbyId)), EVENTUAL);
    };
    try {
      // From the community home, as a user gets there.
      await openFixture(page, world.c1.id, { communityName: world.c1.name, where: 'real' });
      await lobby.tap();
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await jump();
      // Back once: the community home (no duplicate chat entry left under the sheet's).
      await page.goBack();
      await expect(page).toHaveURL(home, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toHaveCount(0, EVENTUAL);

      // Again, with the header's back arrow: one tap.
      await lobby.tap();
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await jump();
      await page.getByRole('button', { name: 'Back to the community' }).tap();
      await expect(page).toHaveURL(home, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toHaveCount(0, EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test('Back closes the emoji picker sheet, and the text typed so far stays', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const { context, page } = await openTouchSession(browser, world.member);
    try {
      const path = await openChat(page, world.c1.id, world.c1.lobbyId);
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      const field = page.getByRole('textbox', { name: 'Message #lobby' });
      await field.fill('hello there');
      await page.getByRole('button', { name: 'Add emoji' }).tap();
      const picker = page.getByRole('dialog', { name: 'Add emoji' });
      await expect(picker).toBeVisible(EVENTUAL);
      await page.goBack();
      await expect(picker).toHaveCount(0, EVENTUAL);
      await expect(chatHeading(page, 'lobby')).toBeVisible();
      await expect(page).toHaveURL(onChat(path));
      await expect(field).toHaveValue('hello there');
      await page.goBack();
      await expect(page).not.toHaveURL(onChat(path), EVENTUAL);
    } finally {
      await context.close();
    }
  });
});

test.describe('Android Back on a tablet (820 px, touch)', () => {
  test('a search result jump closes the search Sheet and leaves no entry behind: one Back is the channel before (#926)', async ({
    browser,
    request,
  }) => {
    const world = await loungeWorld(request);
    const garden = await createTestChannel(request, world.c1.id, { name: 'garden' }, world.owner.token);
    await sendTestMessage(request, world.c1.lobbyId, 'a zebra wandered into the lobby', world.owner.token);
    for (let i = 0; i < 40; i++) await sendTestMessage(request, world.c1.lobbyId, `filler ${i}`, world.owner.token);
    const { context, page } = await openTouchSession(browser, world.member, TABLET);
    const gardenPath = chatPath('real', world.c1.id, garden.id);
    const lobbyPath = chatPath('real', world.c1.id, world.c1.lobbyId);
    try {
      await openChat(page, world.c1.id, garden.id);
      await expect(chatHeading(page, 'garden')).toBeVisible(EVENTUAL);
      await page.getByRole('navigation', { name: 'Community', exact: true }).getByRole('link', { name: /^lobby/ }).tap();
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await expect(row(page, 'filler 39')).toBeVisible(EVENTUAL);

      await page.getByRole('button', { name: 'More' }).tap();
      await page.getByRole('menuitem', { name: 'Search messages' }).tap();
      const sheet = page.getByRole('dialog', { name: 'Search messages' });
      await expect(sheet).toBeVisible(EVENTUAL);
      await sheet.getByRole('searchbox', { name: 'Search messages' }).fill('zebra');
      await sheet.getByRole('button', { name: /^Show the message from .*: a zebra wandered into the lobby$/ }).tap();
      await expect(sheet).toHaveCount(0, EVENTUAL);
      await expect(row(page, 'a zebra wandered into the lobby')).toBeInViewport(EVENTUAL);
      await expect(page).toHaveURL(onChat(lobbyPath), EVENTUAL);

      // One Back: the garden (neither the Sheet's entry nor a second lobby entry is left).
      await page.goBack();
      await expect(page).toHaveURL(onChat(gardenPath), EVENTUAL);
      await expect(chatHeading(page, 'garden')).toBeVisible(EVENTUAL);

      // From the garden, an "All channels" result in the lobby: still one Back, to the garden.
      await page.getByRole('button', { name: 'More' }).tap();
      await page.getByRole('menuitem', { name: 'Search messages' }).tap();
      const allSheet = page.getByRole('dialog', { name: 'Search messages' });
      await expect(allSheet).toBeVisible(EVENTUAL);
      await allSheet.getByRole('tab', { name: 'All channels' }).tap();
      await allSheet.getByRole('searchbox', { name: 'Search messages' }).fill('zebra');
      await allSheet
        .getByRole('button', { name: /^Show the message from .* in #lobby: a zebra wandered into the lobby$/ })
        .tap();
      await expect(allSheet).toHaveCount(0, EVENTUAL);
      await expect(page).toHaveURL(onChat(lobbyPath), EVENTUAL);
      await expect(row(page, 'a zebra wandered into the lobby')).toBeInViewport(EVENTUAL);
      await page.goBack();
      await expect(page).toHaveURL(onChat(gardenPath), EVENTUAL);
      await expect(chatHeading(page, 'garden')).toBeVisible(EVENTUAL);
    } finally {
      await context.close();
    }
  });
});
