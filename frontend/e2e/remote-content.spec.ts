/**
 * "Load pictures and previews from other sites" (Settings > Privacy, `loadRemoteContent`) in both shells, on real
 * data: with it off, no request leaves the reader's browser for another host (link-preview picture and site icon, a
 * lone GIF link, a webhook avatar); with it on, those pictures load (served here by `page.route`, so the test never
 * reaches the real network).
 *
 * The server only builds link previews for public pages, so the messages API's answer gets a preview and a webhook
 * added on the way to the page; the GIF link is a real message.
 *
 * Run: scripts/run-e2e.sh remote-content
 */
import type { Page, Route } from '@playwright/test';
import { test, expect, API_BASE, openSession, sendTestMessage, deleteWorlds } from './fixtures';
import { chatPath, loungeWorld, type LoungeWorld } from './fixtures/lounge';

test.describe.configure({ timeout: 120_000 });

const EVENTUAL = { timeout: 20_000 };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const BANNER = 'https://pictures.remote-e2e.test/banner.png';
// Not `favicon.ico`: Chromium keeps requests for that name out of Playwright's request events.
const ICON = 'https://pictures.remote-e2e.test/site-icon.png';
const AVATAR = 'https://bots.remote-e2e.test/deploy.png';
const GIF = 'https://media.giphy.com/media/remote-e2e/giphy.gif';
/** A 1x1 PNG, the answer for every picture from another site. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test.afterEach(async ({ request }) => deleteWorlds(request));

type Shell = 'classic' | 'lounge';

/** Three messages: a link (its preview added on the way), a lone GIF link, and one the page sees as a webhook's. */
async function seed(request: Parameters<typeof sendTestMessage>[0], world: LoungeWorld) {
  const link = await sendTestMessage(request, world.c1.lobbyId, 'the route https://trailheads.remote-e2e.test/ridge', world.owner.token);
  await sendTestMessage(request, world.c1.lobbyId, GIF, world.owner.token);
  const hook = await sendTestMessage(request, world.c1.lobbyId, 'deployed by the bot', world.owner.token);
  return { linkId: link.id, hookId: hook.id };
}

/** Adds the link preview and the webhook to the channel's messages as the page receives them. */
async function decorateMessages(page: Page, ids: { linkId: string; hookId: string }) {
  await page.route(/\/api\/messages\/channel\/[^/?]+/, async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { messages?: Array<Record<string, unknown>> };
    for (const message of body.messages ?? []) {
      if (message.id === ids.linkId) {
        message.linkPreviews = [
          {
            url: 'https://trailheads.remote-e2e.test/ridge',
            title: 'The ridge loop, in late autumn',
            description: 'Eleven kilometres and one steep climb.',
            siteName: 'Trailheads',
            imageUrl: BANNER,
            faviconUrl: ICON,
          },
        ];
      }
      if (message.id === ids.hookId) {
        message.authorId = null;
        message.webhook = { id: 'wh-remote-e2e', name: 'Deploy bot', avatarUrl: AVATAR };
      }
    }
    await route.fulfill({ response, json: body });
  });
}

/** Every http(s) request the page makes to a host other than the app's own. */
function recordOtherHosts(page: Page, appOrigin: string): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== appOrigin) seen.push(request.url());
  });
  return seen;
}

async function setLoadRemoteContent(request: Parameters<typeof sendTestMessage>[0], token: string, on: boolean) {
  const res = await request.patch(`${API_BASE}/appearance-settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { loadRemoteContent: on },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).loadRemoteContent).toBe(on);
}

async function openChannel(page: Page, shell: Shell, world: LoungeWorld) {
  const path = chatPath('real', world.c1.id, world.c1.lobbyId);
  await page.goto(shell === 'lounge' ? `/#${path}?design=lounge` : `/#${path}`);
  if (shell === 'lounge') await expect(page.locator('[data-shell="lounge"]')).toBeAttached(EVENTUAL);
  await expect(page.getByText('deployed by the bot')).toBeVisible(EVENTUAL);
  await expect(page.getByText('The ridge loop, in late autumn')).toBeVisible(EVENTUAL);
}

for (const shell of ['classic', 'lounge'] as const) {
  test(`off: the words show and no request leaves for another host (${shell})`, async ({ browser, request, baseURL }) => {
    const world = await loungeWorld(request);
    const ids = await seed(request, world);
    await setLoadRemoteContent(request, world.member.token, false);
    const { context, page } = await openSession(browser, world.member, shell === 'lounge' ? PHONE : DESKTOP);
    try {
      const otherHosts = recordOtherHosts(page, new URL(baseURL!).origin);
      await decorateMessages(page, ids);
      await openChannel(page, shell, world);
      // The GIF stays its link (its words show), and the webhook is named.
      await expect(page.getByText(GIF).first()).toBeVisible();
      await expect(page.getByText('Deploy bot').first()).toBeVisible();
      // Give lazy pictures their chance: scroll the rows through view, then let the network settle.
      await page.getByText('The ridge loop, in late autumn').scrollIntoViewIfNeeded();
      await page.waitForLoadState('networkidle');
      expect(otherHosts).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test(`on: the pictures load from their sites (${shell})`, async ({ browser, request, baseURL }) => {
    const world = await loungeWorld(request);
    const ids = await seed(request, world);
    await setLoadRemoteContent(request, world.member.token, true);
    const { context, page } = await openSession(browser, world.member, shell === 'lounge' ? PHONE : DESKTOP);
    try {
      const otherHosts = recordOtherHosts(page, new URL(baseURL!).origin);
      await page.route(/remote-e2e\.test\/|media\.giphy\.com\//, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
      );
      await decorateMessages(page, ids);
      await openChannel(page, shell, world);
      await expect.poll(() => [...new Set(otherHosts)], EVENTUAL).toEqual(expect.arrayContaining([GIF, ICON, AVATAR]));
    } finally {
      await context.close();
    }
  });
}
