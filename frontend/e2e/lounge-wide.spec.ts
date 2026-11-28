/**
 * The Lounge chat at tablet (820 px, compact) and desktop (1440 px, wide) on the real routes
 * `/community/:communityId` and `/community/:communityId/channel/:channelId` (registered at every width in #848 C3,
 * PR 3b), with the new design on for the tab (`?design=lounge`):
 *
 *   - the community home opens the last channel, else the first text channel;
 *   - a thread opens in the right island at 1440 and in the filling right Sheet at 820;
 *   - a pin jumps to its message;
 *   - a search result jumps, in this channel and in another one, with the panel kept;
 *   - resizing 1440 → 1000 → 500 → 1440 keeps the URL and the typed draft (files queued in a composer are not kept
 *     across a resize: a known gap, #917).
 *
 * Each test builds its own world (`loungeWorld`): C1 with `general` (made with the community), `lobby`, `staff`
 * (private) and the voice room `hangout`, owned by the seeded `testuser`, and a fresh plain member N.
 *
 * Run: scripts/run-e2e.sh lounge-wide
 */
import type { Page } from '@playwright/test';
import { test, expect, API_BASE, openSession, shot, sendTestMessage, deleteWorlds, createTestChannel } from './fixtures';
import { chatPath, goTo, loungeWorld } from './fixtures/lounge';

test.describe.configure({ timeout: 120_000 });

const EVENTUAL = { timeout: 20_000 };
const COMPACT = { width: 820, height: 1180 };
const WIDE = { width: 1440, height: 900 };
const VIEWPORTS = [
  ['820', COMPACT],
  ['1440', WIDE],
] as const;

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lounge = (page: Page) => page.locator('[data-shell="lounge"]');
const chatHeading = (page: Page, name: string) => page.getByRole('heading', { name: `# ${name}`, level: 1 });
const messages = (page: Page) => page.getByRole('list', { name: 'Messages' });
const row = (page: Page, text: string) => messages(page).getByRole('article').filter({ hasText: text });
const channelLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Community', exact: true }).getByRole('link', { name: new RegExp(`^${escapeRe(name)}`) });
const membersIsland = (page: Page) => page.getByRole('complementary', { name: 'Members', exact: true });
/** The right panel `name`: the right island at wide, the filling right Sheet below it. */
const panel = (page: Page, name: string, wide: boolean) =>
  wide ? page.getByRole('complementary', { name, exact: true }) : page.getByRole('dialog', { name, exact: true });
/** The whole-hash URL of a path, with no query left over. */
const hashUrl = (path: string) => new RegExp(`#${escapeRe(path)}$`);

/** Opens a path with the new design on for this tab and waits for the new shell. A page load. */
async function openLounge(page: Page, path: string): Promise<void> {
  await page.goto(`/#${path}?design=lounge`);
  await expect(lounge(page)).toBeAttached(EVENTUAL);
}

// Drop the communities this test's worlds created so the shared `testuser` does not pile them up
test.afterEach(async ({ request }) => deleteWorlds(request));

test.describe('The Lounge chat at tablet and desktop (real routes)', () => {
  for (const [label, viewport] of VIEWPORTS) {
    const wide = viewport === WIDE;

    test(`the community home opens the first text channel, then the last one opened (${label} px)`, async ({ browser, request }, testInfo) => {
      const world = await loungeWorld(request);
      const { context, page } = await openSession(browser, world.member, viewport);
      const home = `/community/${world.c1.id}`;
      try {
        // Nothing remembered yet: the first text channel by position (`general`, made with the community). The home's
        // entry is replaced, and the new shell shows the chat beside the community's list, with no Back.
        await openLounge(page, home);
        await expect(chatHeading(page, 'general')).toBeVisible(EVENTUAL);
        await expect(page).toHaveURL(new RegExp(`#${escapeRe(home)}/channel/[^/?]+$`), EVENTUAL);
        await expect(lounge(page)).toBeAttached();
        await expect(channelLink(page, 'lobby')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to the community' })).toHaveCount(0);
        if (wide) await expect(membersIsland(page)).toBeVisible();
        await shot(page, testInfo, `w1-home-first-channel-${label}`);

        // Another channel from the list, then the home again (an in-app navigation): the last one opened.
        await channelLink(page, 'lobby').click();
        await expect(page).toHaveURL(hashUrl(chatPath('real', world.c1.id, world.c1.lobbyId)), EVENTUAL);
        await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
        await goTo(page, home);
        await expect(page).toHaveURL(hashUrl(chatPath('real', world.c1.id, world.c1.lobbyId)), EVENTUAL);
        await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);

        // And after a page load too (the last channel is kept per user and community).
        await openLounge(page, home);
        await expect(page).toHaveURL(hashUrl(chatPath('real', world.c1.id, world.c1.lobbyId)), EVENTUAL);
        await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      } finally {
        await context.close();
      }
    });

    test(`a thread opens in the ${wide ? 'right island' : 'right Sheet'}, takes a reply, and Close returns to the channel (${label} px)`, async ({
      browser,
      request,
    }, testInfo) => {
      const world = await loungeWorld(request);
      const parent = await sendTestMessage(request, world.c1.lobbyId, 'a thread for the wide layout', world.owner.token);
      const started = await request.post(`${API_BASE}/threads/${parent.id}/replies`, {
        data: { spans: [{ type: 'PLAINTEXT', text: 'the first reply' }], attachments: [] },
        headers: { Authorization: `Bearer ${world.owner.token}` },
      });
      expect(started.ok()).toBe(true);
      const real = chatPath('real', world.c1.id, world.c1.lobbyId);
      const { context, page } = await openSession(browser, world.member, viewport);
      try {
        await openLounge(page, real);
        await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
        await row(page, 'a thread for the wide layout').getByRole('button', { name: '1 reply, open the thread' }).click();

        const thread = panel(page, 'Thread', wide);
        await expect(thread).toBeVisible(EVENTUAL);
        await expect(thread.getByText('the first reply')).toBeVisible(EVENTUAL);
        await expect(page).toHaveURL(new RegExp(`#${escapeRe(real)}\\?.*thread=${parent.id}`));
        if (wide) {
          // Beside the live channel, in the members' place (they are hidden under it).
          await expect(membersIsland(page)).toBeHidden();
          await expect(chatHeading(page, 'lobby')).toBeVisible();
          await expect(page.getByRole('textbox', { name: 'Message #lobby' })).toBeVisible();
        }
        await shot(page, testInfo, `w2-thread-${label}`);

        const field = thread.getByRole('textbox', { name: 'Reply in thread' });
        await field.fill('a reply from the wide layout');
        await thread.getByRole('button', { name: 'Send message' }).click();
        await expect(thread.getByText('a reply from the wide layout')).toBeVisible(EVENTUAL);
        await expect(field).toHaveValue('');

        await thread.getByRole('button', { name: 'Close thread' }).click();
        await expect(thread).toHaveCount(0, EVENTUAL);
        await expect(page).toHaveURL(hashUrl(real), EVENTUAL);
        await expect(chatHeading(page, 'lobby')).toBeVisible();
        if (wide) await expect(membersIsland(page)).toBeVisible();
        await expect(row(page, 'a thread for the wide layout').getByRole('button', { name: '2 replies, open the thread' })).toBeVisible(EVENTUAL);
      } finally {
        await context.close();
      }
    });

    test(`a pin jumps to its message (${label} px)`, async ({ browser, request }, testInfo) => {
      const world = await loungeWorld(request);
      const pinnedOne = await sendTestMessage(request, world.c1.lobbyId, 'the pinned rules of the lobby', world.owner.token);
      const pinned = await request.post(`${API_BASE}/moderation/pin/${pinnedOne.id}`, {
        data: {},
        headers: { Authorization: `Bearer ${world.owner.token}` },
      });
      expect(pinned.ok()).toBe(true);
      for (let i = 0; i < 40; i++) await sendTestMessage(request, world.c1.lobbyId, `filler ${i}`, world.owner.token);
      const real = chatPath('real', world.c1.id, world.c1.lobbyId);
      const { context, page } = await openSession(browser, world.member, viewport);
      try {
        await openLounge(page, real);
        await expect(row(page, 'filler 39')).toBeVisible(EVENTUAL);
        await expect(row(page, 'the pinned rules of the lobby')).not.toBeInViewport();
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('menuitem', { name: 'Pinned messages (1)' }).click();
        const pins = panel(page, wide ? 'Pinned messages' : 'Pinned messages (1)', wide);
        await expect(pins).toBeVisible(EVENTUAL);
        await shot(page, testInfo, `w3-pins-${label}`);
        await pins.getByRole('button', { name: /the pinned rules of the lobby/ }).click();
        await expect(row(page, 'the pinned rules of the lobby')).toBeInViewport(EVENTUAL);
        // The jump replaces the entry and settles on the chat's own path.
        await expect(page).toHaveURL(hashUrl(real), EVENTUAL);
        // At wide the panel stays beside the chat, so the next pin is one click away.
        if (wide) await expect(pins).toBeVisible();
      } finally {
        await context.close();
      }
    });

    test(`a search result jumps in this channel and to another channel, with the panel kept (${label} px)`, async ({
      browser,
      request,
    }, testInfo) => {
      const world = await loungeWorld(request);
      const garden = await createTestChannel(request, world.c1.id, { name: 'garden' }, world.owner.token);
      await sendTestMessage(request, world.c1.lobbyId, 'a zebra wandered into the lobby', world.owner.token);
      for (let i = 0; i < 40; i++) await sendTestMessage(request, world.c1.lobbyId, `filler ${i}`, world.owner.token);
      await sendTestMessage(request, garden.id, 'a zebra grazing in the garden', world.owner.token);
      const lobbyPath = chatPath('real', world.c1.id, world.c1.lobbyId);
      const gardenPath = chatPath('real', world.c1.id, garden.id);
      const { context, page } = await openSession(browser, world.member, viewport);
      try {
        await openLounge(page, lobbyPath);
        await expect(row(page, 'filler 39')).toBeVisible(EVENTUAL);
        const search = panel(page, 'Search messages', wide);
        const field = search.getByRole('searchbox', { name: 'Search messages' });
        const openSearch = async () => {
          await page.getByRole('button', { name: 'More' }).click();
          await page.getByRole('menuitem', { name: 'Search messages' }).click();
          await expect(search).toBeVisible(EVENTUAL);
          await expect(field).toBeFocused();
          await field.fill('zebra');
        };
        /**
         * The panel stays open after a jump. At 820 it is the filling right Sheet, a modal layer over the chat (the
         * chat under it is inert), so the chat is checked once the Sheet is closed.
         */
        const closeSheet = async () => {
          if (wide) return;
          await search.getByRole('button', { name: 'Close search' }).click();
          await expect(search).toHaveCount(0, EVENTUAL);
        };
        await openSearch();

        // This channel: the lobby's message only.
        const here = search.getByRole('button', { name: /^Show the message from .*: a zebra wandered into the lobby$/ });
        await expect(here).toBeVisible(EVENTUAL);
        await expect(search.getByRole('button', { name: /grazing in the garden/ })).toHaveCount(0);
        await shot(page, testInfo, `w4-search-channel-${label}`);
        await here.click();
        await expect(page).toHaveURL(hashUrl(lobbyPath), EVENTUAL);
        await expect(search).toBeVisible();
        await closeSheet();
        await expect(row(page, 'a zebra wandered into the lobby')).toBeInViewport(EVENTUAL);
        // Reopened at 820, the search starts afresh (#920).
        if (!wide) await openSearch();

        // All channels: the garden's message, named with its channel. It opens the garden with the panel still open,
        // its text and scope kept.
        await search.getByRole('tab', { name: 'All channels' }).click();
        const there = search.getByRole('button', { name: /^Show the message from .* in #garden: a zebra grazing in the garden$/ });
        await expect(there).toBeVisible(EVENTUAL);
        await shot(page, testInfo, `w4-search-all-${label}`);
        await there.click();
        await expect(page).toHaveURL(hashUrl(gardenPath), EVENTUAL);
        await expect(search).toBeVisible();
        await expect(field).toHaveValue('zebra');
        await expect(search.getByRole('tab', { name: 'All channels' })).toHaveAttribute('aria-selected', 'true');
        await closeSheet();
        await expect(chatHeading(page, 'garden')).toBeVisible(EVENTUAL);
        await expect(row(page, 'a zebra grazing in the garden')).toBeInViewport(EVENTUAL);

        // A new entry: Back is the lobby again.
        await page.goBack();
        await expect(page).toHaveURL(hashUrl(lobbyPath), EVENTUAL);
        await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      } finally {
        await context.close();
      }
    });
  }

  test('resizing 1440 → 1000 → 500 → 1440 keeps the URL and the typed draft', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    await sendTestMessage(request, world.c1.lobbyId, 'something to answer', world.owner.token);
    const real = chatPath('real', world.c1.id, world.c1.lobbyId);
    const { context, page } = await openSession(browser, world.member, WIDE);
    try {
      await openLounge(page, real);
      await expect(row(page, 'something to answer')).toBeVisible(EVENTUAL);
      const composer = page.getByRole('textbox', { name: 'Message #lobby' });
      await composer.fill('half a thought');
      await expect(membersIsland(page)).toBeVisible(EVENTUAL);
      for (const width of [1000, 500, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        // The layout for this width is on screen before anything else is read: the members island at wide only, Back to
        // the community on a phone only (tablet and desktop show the community's list instead).
        if (width >= 1200) await expect(membersIsland(page), `${width}px`).toBeVisible(EVENTUAL);
        else await expect(membersIsland(page), `${width}px`).toHaveCount(0, EVENTUAL);
        await expect(page.getByRole('button', { name: 'Back to the community' }), `${width}px`).toHaveCount(width < 600 ? 1 : 0, EVENTUAL);
        await expect(lounge(page), `${width}px`).toBeAttached();
        await expect(chatHeading(page, 'lobby'), `${width}px`).toBeVisible(EVENTUAL);
        await expect(page, `${width}px`).toHaveURL(hashUrl(real));
        await expect(row(page, 'something to answer'), `${width}px`).toBeInViewport(EVENTUAL);
        await expect(composer, `${width}px`).toHaveValue('half a thought', EVENTUAL);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${width}px`).toBe(false);
      }
    } finally {
      await context.close();
    }
  });
});
