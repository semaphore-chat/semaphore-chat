/**
 * The Lounge chat (PR 10c-1 read side, PR 10c-2a write side) on real data at phone width, on the real channel route
 * `/community/:communityId/channel/:channelId` (PR 10c-2b, the new design on) and, where cheap, on the hidden chat
 * fixture `/__lounge/community/:communityId/channel/:channelId` too (`LOUNGE_WHERES`). The real route stays the old
 * shell's with the new design off, at tablet width, for its search and for a voice channel (checked here).
 *
 * Each test builds its own world (`loungeWorld`): C1 with `lobby` (public) and `staff` (private, the owner's),
 * owned by the seeded `testuser`, and a fresh plain member N in no private channel.
 *
 * Run: scripts/run-e2e.sh lounge-chat
 */
import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, API_BASE, openSession, shot, sendTestMessage, deleteWorlds } from './fixtures';
import { chatFixturePath, chatPath, goTo, LOUNGE_WHERES, loungePath, loungeWorld, openFixture, type LoungeWhere } from './fixtures/lounge';

test.describe.configure({ timeout: 120_000 });

const EVENTUAL = { timeout: 20_000 };
const PHONE = { width: 390, height: 844 };

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const chatHeading = (page: Page, name: string) => page.getByRole('heading', { name: `# ${name}`, level: 1 });
const messages = (page: Page) => page.getByRole('list', { name: 'Messages' });
const row = (page: Page, text: string) => messages(page).getByRole('article').filter({ hasText: text });

/** Opens a channel's chat on `where` with the new design on for this tab (`?design=lounge`), plus any other query. */
async function openChat(page: Page, communityId: string, channelId: string, query = '', where: LoungeWhere = 'fixture'): Promise<void> {
  const extra = query ? `${query}&` : '';
  await page.goto(`/#${chatPath(where, communityId, channelId)}?${extra}design=lounge`);
  await expect(page.locator('[data-shell="lounge"]')).toBeAttached(EVENTUAL);
}

/** The whole-hash URL of a path. */
const hashUrl = (path: string) => new RegExp(`#${escapeRe(path)}$`);

async function serverUnreadCount(request: Parameters<typeof sendTestMessage>[0], token: string, channelId: string) {
  const res = await request.get(`${API_BASE}/read-receipts/unread-counts`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = (await res.json()) as Array<{ channelId?: string | null; unreadCount: number }>;
  return rows.find((r) => r.channelId === channelId)?.unreadCount ?? 0;
}

// Drop the communities this test's worlds created so the shared `testuser` does not pile them up
test.afterEach(async ({ request }) => deleteWorlds(request));

test.describe('The Lounge chat (390 px)', () => {
  for (const where of LOUNGE_WHERES) {
  test(`a channel row opens the chat; history, a live message and the read reach the server; Back returns to the row (${where})`, async ({
    browser,
    request,
  }, testInfo) => {
    const world = await loungeWorld(request);
    const first = await sendTestMessage(request, world.c1.lobbyId, 'first of the evening', world.owner.token);
    await sendTestMessage(request, world.c1.lobbyId, 'anyone around?', world.owner.token);
    // A reply quoting the first message.
    const reply = await request.post(`${API_BASE}/messages`, {
      data: { channelId: world.c1.lobbyId, spans: [{ type: 'PLAINTEXT', text: 'replying to the first' }], attachments: [], replyToId: first.id },
      headers: { Authorization: `Bearer ${world.owner.token}` },
    });
    expect(reply.ok()).toBe(true);
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await openFixture(page, world.c1.id, { communityName: world.c1.name, where });
      const lobby = page.getByRole('navigation', { name: 'Community', exact: true }).getByRole('link', { name: /^lobby/ });
      await expect(lobby).toHaveAccessibleName(/unread/, EVENTUAL);
      await lobby.click();

      await expect(page).toHaveURL(hashUrl(chatPath(where, world.c1.id, world.c1.lobbyId)));
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached();
      await expect(row(page, 'anyone around?')).toBeVisible(EVENTUAL);
      await expect(messages(page).getByRole('separator', { name: 'Today' })).toBeVisible();
      // N had never read the channel: the server's count goes to 0 once the newest message is in view.
      await expect.poll(() => serverUnreadCount(request, world.member.token, world.c1.lobbyId), EVENTUAL).toBe(0);

      // A message from someone else arrives live, in the list.
      await sendTestMessage(request, world.c1.lobbyId, 'on my way', world.owner.token);
      await expect(row(page, 'on my way')).toBeVisible(EVENTUAL);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await shot(page, testInfo, `c1-chat-with-history-${where}`);

      // Opening the quoted message is an in-chat jump: it replaces the entry, so one Back still leaves the chat.
      await row(page, 'replying to the first').getByRole('button', { name: /^Reply to / }).click();
      await expect(page).toHaveURL(hashUrl(chatPath(where, world.c1.id, world.c1.lobbyId)), EVENTUAL);

      await page.getByRole('button', { name: 'Back to the community' }).click();
      await expect(page).toHaveURL(hashUrl(loungePath(where, world.c1.id)));
      await expect(lobby).toBeFocused(EVENTUAL);
      await expect(lobby).not.toHaveAccessibleName(/unread/, EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test(`a cold ?highlight= deep link lands on that message, and the address stays on the chat's own path (${where})`, async ({ browser, request }, testInfo) => {
    const world = await loungeWorld(request);
    let target = '';
    for (let i = 1; i <= 40; i += 1) {
      const sent = await sendTestMessage(request, world.c1.lobbyId, `numbered message ${i}`, world.owner.token);
      if (i === 3) target = sent.id;
    }
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await openChat(page, world.c1.id, world.c1.lobbyId, `highlight=${target}`, where);
      const highlighted = row(page, 'numbered message 3');
      await expect(highlighted).toBeInViewport(EVENTUAL);
      // The param is cleared once the jump settles, to the chat's own path (the fixture stays on the fixture).
      await expect(page).toHaveURL(hashUrl(chatPath(where, world.c1.id, world.c1.lobbyId)), EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached();
      await shot(page, testInfo, `c2-deep-link-${where}`);

      // A cold link has nothing to go back to: Back replaces the entry with the community's home.
      await page.getByRole('button', { name: 'Back to the community' }).click();
      await expect(page).toHaveURL(hashUrl(loungePath(where, world.c1.id)), EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached();
    } finally {
      await context.close();
    }
  });
  }

  test('a private channel’s members are the channel’s own, not the community’s', async ({ browser, request }, testInfo) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, TEST_USER, PHONE);
    try {
      await openChat(page, world.c1.id, world.c1.staffId!);
      await expect(chatHeading(page, 'staff')).toBeVisible(EVENTUAL);
      await expect(page.getByRole('img', { name: 'Private channel' })).toBeVisible();
      await page.getByRole('button', { name: 'Members', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: 'Members' });
      await expect(sheet).toBeVisible(EVENTUAL);
      // The owner (display name "Test User") is in it; N, a plain member of the community, is not.
      await expect(sheet.getByRole('button', { name: /^Test User\b/ })).toBeVisible(EVENTUAL);
      await expect(sheet.getByRole('button', { name: new RegExp(`^${escapeRe(world.member.username)}\\b`) })).toHaveCount(0);
      await shot(page, testInfo, 'c3-private-members');
      await page.keyboard.press('Escape');

      // The public channel lists the community, N included.
      await openChat(page, world.c1.id, world.c1.lobbyId);
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await page.getByRole('button', { name: 'Members', exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: 'Members' }).getByRole('button', { name: new RegExp(`^${escapeRe(world.member.username)}\\b`) }),
      ).toBeVisible(EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test('a member who cannot read a private channel is told so, with a way back', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await openChat(page, world.c1.id, world.c1.staffId!);
      await expect(page.getByRole('heading', { name: /You don't have access to this channel|Channel not found/ })).toBeVisible(EVENTUAL);
      await page.getByRole('button', { name: 'Go to the community' }).click();
      await expect(page).toHaveURL(hashUrl(loungePath('fixture', world.c1.id)), EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test('the write side: send (a second user sees it), reply, react, edit, delete, attach and mention', async ({ browser, request }, testInfo) => {
    const world = await loungeWorld(request);
    await sendTestMessage(request, world.c1.lobbyId, 'who is around tonight?', world.owner.token);
    const n = await openSession(browser, world.member, PHONE);
    const owner = await openSession(browser, TEST_USER, PHONE);
    try {
      await openChat(n.page, world.c1.id, world.c1.lobbyId);
      await openChat(owner.page, world.c1.id, world.c1.lobbyId);
      const page = n.page;
      await expect(row(page, 'who is around tonight?')).toBeVisible(EVENTUAL);
      const field = page.getByRole('textbox', { name: 'Message #lobby' });
      const send = page.getByRole('button', { name: 'Send message' });
      // Opens a row's actions from the keyboard (Enter on the focused row).
      const actionsOf = async (text: string) => {
        // The first row with the words: the original, not a reply quoting it.
        await row(page, text).first().focus();
        await page.keyboard.press('Enter');
        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible(EVENTUAL);
        return sheet;
      };

      // Send: it shows here, and arrives for the other user.
      await field.fill('me, from the new composer');
      await send.click();
      await expect(row(page, 'me, from the new composer')).toBeVisible(EVENTUAL);
      await expect(row(owner.page, 'me, from the new composer')).toBeVisible(EVENTUAL);
      await expect(field).toHaveValue('');

      // Reply: the banner, then the reply's quote.
      await (await actionsOf('who is around tonight?')).getByRole('button', { name: 'Reply', exact: true }).click();
      await expect(page.getByText('Replying to', { exact: false })).toBeVisible(EVENTUAL);
      await field.fill('count me in');
      await send.click();
      await expect(row(page, 'count me in').getByRole('button', { name: /^Reply to .*who is around tonight\?/ })).toBeVisible(EVENTUAL);

      // React through the sheet.
      await (await actionsOf('who is around tonight?')).getByRole('button', { name: 'React with party' }).click();
      await expect(row(page, 'who is around tonight?').first().getByRole('button', { name: /reaction, 1$/ })).toBeVisible(EVENTUAL);
      await expect(row(owner.page, 'who is around tonight?').first().getByRole('button', { name: /reaction, 1$/ })).toBeVisible(EVENTUAL);

      // Edit in place: Enter saves.
      await (await actionsOf('me, from the new composer')).getByRole('button', { name: 'Edit message' }).click();
      const editor = page.getByRole('textbox', { name: 'Edit message' });
      await expect(editor).toBeFocused(EVENTUAL);
      await editor.fill('me, edited in place');
      await editor.press('Enter');
      await expect(row(page, 'me, edited in place')).toContainText('(edited)', EVENTUAL);
      await expect(row(owner.page, 'me, edited in place')).toBeVisible(EVENTUAL);

      // Delete asks first.
      await (await actionsOf('me, edited in place')).getByRole('button', { name: 'Delete message' }).click();
      const confirm = page.getByRole('dialog', { name: 'Delete this message?' }).or(page.getByRole('alertdialog', { name: 'Delete this message?' }));
      await expect(confirm).toBeVisible(EVENTUAL);
      await confirm.getByRole('button', { name: 'Delete message' }).click();
      await expect(row(page, 'me, edited in place')).toHaveCount(0, EVENTUAL);
      await expect(row(owner.page, 'me, edited in place')).toHaveCount(0, EVENTUAL);

      // Attach a file: the tray, then the sent file.
      await page.getByTestId('chat-composer-file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bring snacks') });
      await expect(page.getByRole('group', { name: /^notes\.txt/ })).toBeVisible(EVENTUAL);
      await field.fill('the list');
      await send.click();
      await expect(row(page, 'the list').getByRole('button', { name: /^Download notes\.txt/ })).toBeVisible(EVENTUAL);
      await expect(row(owner.page, 'the list').getByRole('button', { name: /^Download notes\.txt/ })).toBeVisible(EVENTUAL);

      // Mention with the suggestion list.
      await field.fill('');
      await field.pressSequentially('ping @testu');
      const option = page.getByRole('listbox', { name: 'Mention suggestions' }).getByRole('option', { name: /testuser/ });
      await expect(option).toBeVisible(EVENTUAL);
      await option.click();
      await expect(field).toHaveValue(/^ping @testuser /);
      await expect(field).toBeFocused();
      await send.click();
      await expect(row(page, 'ping').getByRole('button', { name: '@testuser' })).toBeVisible(EVENTUAL);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await shot(page, testInfo, 'c4-write-side');
    } finally {
      await n.context.close();
      await owner.context.close();
    }
  });

  for (const where of LOUNGE_WHERES) {
  test(`a reader in the old shell sees the Lounge user’s message, edit, reaction and delete (${where})`, async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const n = await openSession(browser, world.member, PHONE);
    // The owner reads the same channel in the old shell (the real route, the new design off).
    const classic = await openSession(browser, TEST_USER, { width: 1280, height: 800 });
    try {
      if (where === 'real') {
        // From the community home, as a user gets there.
        await openFixture(n.page, world.c1.id, { communityName: world.c1.name, where });
        await n.page.getByRole('navigation', { name: 'Community', exact: true }).getByRole('link', { name: /^lobby/ }).click();
        await expect(chatHeading(n.page, 'lobby')).toBeVisible(EVENTUAL);
      } else {
        await openChat(n.page, world.c1.id, world.c1.lobbyId);
      }
      await classic.page.goto(`/#/community/${world.c1.id}/channel/${world.c1.lobbyId}`);
      await expect(classic.page.getByRole('textbox', { name: /^Message #lobby/ }).or(classic.page.getByPlaceholder(/lobby/))).toBeVisible(EVENTUAL);
      await expect(classic.page.locator('[data-shell="lounge"]')).toHaveCount(0);
      const body = (text: string) => classic.page.getByTestId('message-body').filter({ hasText: text });

      const page = n.page;
      await page.getByRole('textbox', { name: 'Message #lobby' }).fill('hello from the new shell');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(body('hello from the new shell')).toBeVisible(EVENTUAL);

      const actionsOf = async (text: string) => {
        await row(page, text).first().focus();
        await page.keyboard.press('Enter');
        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible(EVENTUAL);
        return sheet;
      };
      await (await actionsOf('hello from the new shell')).getByRole('button', { name: 'React with party' }).click();
      await expect(classic.page.getByText('🎉 1')).toBeVisible(EVENTUAL);

      await (await actionsOf('hello from the new shell')).getByRole('button', { name: 'Edit message' }).click();
      const editor = page.getByRole('textbox', { name: 'Edit message' });
      await editor.fill('hello, edited in the new shell');
      await editor.press('Enter');
      await expect(body('hello, edited in the new shell')).toBeVisible(EVENTUAL);

      await (await actionsOf('hello, edited in the new shell')).getByRole('button', { name: 'Delete message' }).click();
      const confirm = page.getByRole('dialog', { name: 'Delete this message?' }).or(page.getByRole('alertdialog', { name: 'Delete this message?' }));
      await confirm.getByRole('button', { name: 'Delete message' }).click();
      await expect(body('hello, edited in the new shell')).toHaveCount(0, EVENTUAL);
      await expect(row(page, 'hello, edited in the new shell')).toHaveCount(0, EVENTUAL);

      // Back to the community home, still the new shell.
      await page.getByRole('button', { name: 'Back to the community' }).click();
      await expect(page).toHaveURL(hashUrl(loungePath(where, world.c1.id)), EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached();
    } finally {
      await n.context.close();
      await classic.context.close();
    }
  });
  }

  test('the real channel route is the old shell’s with the new design off; the account setting turns it on', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, world.member, PHONE);
    const real = chatPath('real', world.c1.id, world.c1.lobbyId);
    try {
      await page.goto(`/#${real}`);
      await expect(page.getByRole('textbox', { name: /^Message #lobby/ })).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);
      await expect(chatHeading(page, 'lobby')).toHaveCount(0);

      // The account's (hidden) switch, no preview: a reload on the chat's URL is the new shell's chat.
      const res = await request.patch(`${API_BASE}/appearance-settings`, {
        headers: { Authorization: `Bearer ${world.member.token}` },
        data: { newDesign: true },
      });
      expect(res.ok()).toBe(true);
      await page.reload();
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached();
      await expect(page).toHaveURL(hashUrl(real));
    } finally {
      await context.close();
    }
  });

  test('the real route stays the old shell’s at 820 px, for its search and for a voice channel (the call view)', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, world.member, { width: 820, height: 1180 });
    const real = chatPath('real', world.c1.id, world.c1.lobbyId);
    try {
      await page.goto(`/#${real}?design=lounge`);
      await expect(page.getByRole('textbox', { name: /^Message #lobby/ })).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);

      await page.setViewportSize(PHONE);
      // The chat's search stays the old shell's full-screen search.
      await page.goto(`/#${real}/search`);
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);
      await expect(page.getByPlaceholder('Search #lobby')).toBeVisible(EVENTUAL);

      // A voice channel's route is the old shell's call view, also on a cold link with nothing known yet.
      await page.goto(`/#${chatPath('real', world.c1.id, world.c1.hangoutId)}`);
      await expect(page.getByText('Voice channel', { exact: true })).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0, EVENTUAL);
      await expect(page.getByRole('textbox', { name: /^Message #/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // The scroll place is NOT kept across a shell swap: each shell mounts its own list, which opens at the newest
  // message (the read marks are shared, so nothing is marked read twice). The URL and the draft are kept.
  test('resizing across the phone boundary in the chat keeps the URL and the draft; each shell reopens at the newest message', async ({
    browser,
    request,
  }) => {
    const world = await loungeWorld(request);
    for (let i = 1; i <= 40; i += 1) await sendTestMessage(request, world.c1.lobbyId, `numbered message ${i}`, world.owner.token);
    const { context, page } = await openSession(browser, world.member, PHONE);
    const real = chatPath('real', world.c1.id, world.c1.lobbyId);
    const inView = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    };
    try {
      await openChat(page, world.c1.id, world.c1.lobbyId, '', 'real');
      await expect(row(page, 'numbered message 40')).toBeVisible(EVENTUAL);
      await page.getByRole('textbox', { name: 'Message #lobby' }).fill('half a thought');
      // Scroll back to an older message: the newest leaves the view.
      const older = row(page, 'numbered message 12');
      const box = await messages(page).boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      for (let i = 0; i < 30 && !(await older.isVisible().catch(() => false)); i += 1) await page.mouse.wheel(0, -400);
      await older.scrollIntoViewIfNeeded();
      await expect(older).toBeInViewport();
      await expect(row(page, 'numbered message 40')).not.toBeInViewport();

      await page.setViewportSize({ width: 820, height: 1180 });
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0, EVENTUAL);
      await expect(page).toHaveURL(hashUrl(real));
      const classicNewest = page.getByTestId('message-body').filter({ hasText: 'numbered message 40' });
      await expect(classicNewest).toBeVisible(EVENTUAL);
      expect(await classicNewest.evaluate(inView)).toBe(true);
      await expect(page.getByRole('textbox', { name: /^Message #lobby/ })).toHaveValue('half a thought', EVENTUAL);

      await page.setViewportSize(PHONE);
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await expect(page).toHaveURL(hashUrl(real));
      await expect(row(page, 'numbered message 40')).toBeInViewport(EVENTUAL);
      // The older message the user had scrolled to is not where they were: the place is not kept.
      // Bounded and auto-retrying: a row virtua dropped from the DOM counts as out of view and does not hang.
      await expect(row(page, 'numbered message 12')).not.toBeInViewport(EVENTUAL);
      await expect(page.getByRole('textbox', { name: 'Message #lobby' })).toHaveValue('half a thought', EVENTUAL);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    } finally {
      await context.close();
    }
  });

  // The chat fixture is the new shell's at every width, so a resize keeps the one list: only its height changes (the
  // rows are one line at both widths). It keeps the reader's place (#921): at the newest message the newest stays in
  // view; scrolled up, the older message stays in view and the list is not pulled to the bottom.
  test('resizing across the phone boundary in the chat fixture keeps the reader at the newest message, or at an older one', async ({
    browser,
    request,
  }) => {
    const world = await loungeWorld(request);
    for (let i = 1; i <= 40; i += 1) await sendTestMessage(request, world.c1.lobbyId, `numbered message ${i}`, world.owner.token);
    const numbered = (page: Page, n: number) => messages(page).getByRole('article').filter({ hasText: new RegExp(`numbered message ${n}$`) });
    const TABLET = { width: 820, height: 1180 };
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await openChat(page, world.c1.id, world.c1.lobbyId);
      await expect(numbered(page, 40)).toBeInViewport(EVENTUAL);
      // The list's laid-out height per viewport width, so the "scrolled up" loop below can wait for a resize.
      const heightAt = new Map<number, number>();
      for (const viewport of [TABLET, PHONE, TABLET, PHONE]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('[data-shell="lounge"]'), `${viewport.width}px`).toBeAttached();
        await expect(numbered(page, 40), `${viewport.width}px`).toBeInViewport(EVENTUAL);
        heightAt.set(viewport.width, await messages(page).evaluate((el) => el.clientHeight));
      }

      // Scroll back to an older message: the newest leaves the view.
      const older = numbered(page, 10);
      const box = await messages(page).boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      // Scroll to the very top first, so virtua has measured every row (the older page's rows are estimated
      // until they render, and their real heights would otherwise shift the reader while the test resizes).
      for (let i = 0; i < 40 && !(await numbered(page, 1).isVisible().catch(() => false)); i += 1) {
        await page.mouse.wheel(0, -400);
      }
      for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, -400);
      // Then put the older message in the middle of the view, with room on both sides.
      await older.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect(older).toBeInViewport();
      await expect(numbered(page, 40)).not.toBeInViewport();
      for (const viewport of [TABLET, PHONE]) {
        await page.setViewportSize(viewport);
        // The list's height is what changes (the rows are one line at both widths): wait for it before asserting.
        await expect
          .poll(() => messages(page).evaluate((el) => el.clientHeight), { ...EVENTUAL, message: `${viewport.width}px` })
          .toBe(heightAt.get(viewport.width));
        await expect(older, `${viewport.width}px`).toBeInViewport(EVENTUAL);
      }
      await expect(numbered(page, 40)).not.toBeInViewport();
    } finally {
      await context.close();
    }
  });

  test('a cold link to a chat in another community makes it the last opened: the classic Home tab returns there', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await openChat(page, world.c2.id, world.c2.lobbyId, '', 'real');
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await goTo(page, '/direct-messages');
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0, EVENTUAL);
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await expect(page).toHaveURL(hashUrl(loungePath('real', world.c2.id)), EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached(EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test("with the new design off the chat fixture is the old shell's Page not found", async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await page.goto(`/#${chatFixturePath(world.c1.id, world.c1.lobbyId)}`);
      await expect(page.getByText('Page not found')).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe('The Lounge chat: rich rows (390 px, real route)', () => {
  // A 2×1 PNG: an image the server accepts and records the size of.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZYAwAZOsJ93W0OVsAAAAASUVORK5CYII=', 'base64');
  const GIF_URL = 'https://media.giphy.com/media/e2e-lounge/giphy.gif';
  // A 1×1 GIF, served for the GIF's address so the test needs no network.
  const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

  test('a picture opens the full-size viewer and Escape returns to it; a GIF link is drawn as the GIF; who reacted', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    await sendTestMessage(request, world.c1.lobbyId, GIF_URL, world.owner.token);
    const { context, page } = await openSession(browser, world.member, PHONE);
    let gifReferer: string | undefined = 'not asked';
    await page.route(GIF_URL, async (route) => {
      gifReferer = route.request().headers()['referer'];
      await route.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
    });
    try {
      await openChat(page, world.c1.id, world.c1.lobbyId, '', 'real');
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);

      // The GIF: drawn (no link text), asked for without a Referer.
      const gif = messages(page).getByRole('button', { name: 'Open image GIF' });
      await expect(gif).toBeVisible(EVENTUAL);
      await expect(gif.locator('img')).toHaveAttribute('src', GIF_URL);
      await expect.poll(() => gifReferer, EVENTUAL).toBeUndefined();
      await expect(messages(page).getByText(GIF_URL)).toHaveCount(0);

      // Send a picture from the composer; it shows as a picture, and opens the viewer.
      const field = page.getByRole('textbox', { name: 'Message #lobby' });
      await page.locator('input[type="file"]').first().setInputFiles({ name: 'e2e-picture.png', mimeType: 'image/png', buffer: PNG });
      await field.fill('a picture for the viewer');
      await page.getByRole('button', { name: 'Send message' }).click();
      const picture = row(page, 'a picture for the viewer').getByRole('button', { name: 'Open image e2e-picture.png' });
      await expect(picture).toBeVisible(EVENTUAL);
      await picture.click();
      const viewer = page.getByRole('dialog', { name: 'e2e-picture.png' });
      await expect(viewer).toBeVisible(EVENTUAL);
      await expect(viewer.getByRole('img', { name: 'e2e-picture.png' })).toBeVisible(EVENTUAL);
      await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0, EVENTUAL);
      await expect(picture).toBeFocused();

      // React through the actions, then a right-click on the chip says who reacted.
      const target = row(page, 'a picture for the viewer');
      await target.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('dialog').getByRole('button', { name: 'React with party' }).click();
      const chip = target.getByRole('button', { name: /reaction, 1$/ });
      await expect(chip).toBeVisible(EVENTUAL);
      await chip.click({ button: 'right' });
      const people = page.getByRole('dialog', { name: 'Reactions' });
      await expect(people).toBeVisible(EVENTUAL);
      await expect(people.getByText(world.member.username)).toBeVisible(EVENTUAL);
      // A right-click shows the people; it does not take the reaction back.
      await page.keyboard.press('Escape');
      await expect(people).toHaveCount(0, EVENTUAL);
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    } finally {
      await context.close();
    }
  });
});

test.describe('The Lounge chat: threads and pinned messages (390 px, real route)', () => {
  const threadHeading = (page: Page) => page.getByRole('heading', { name: 'Thread', level: 1 });

  test('a classic user’s thread: the Lounge reader opens it, replies, the classic user sees it; reload and Back', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const parent = await sendTestMessage(request, world.c1.lobbyId, 'shall we start a thread?', world.owner.token);
    const started = await request.post(`${API_BASE}/threads/${parent.id}/replies`, {
      data: { spans: [{ type: 'PLAINTEXT', text: 'first reply from classic' }], attachments: [] },
      headers: { Authorization: `Bearer ${world.owner.token}` },
    });
    expect(started.ok()).toBe(true);
    const real = chatPath('real', world.c1.id, world.c1.lobbyId);
    const reader = await openSession(browser, world.member, PHONE);
    try {
      const page = reader.page;
      await openChat(page, world.c1.id, world.c1.lobbyId, '', 'real');
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      const replies = row(page, 'shall we start a thread?').getByRole('button', { name: '1 reply, open the thread' });
      await expect(replies).toBeVisible(EVENTUAL);
      await replies.click();
      await expect(threadHeading(page)).toBeFocused(EVENTUAL);
      await expect(page).toHaveURL(new RegExp(`#${escapeRe(real)}\\?.*thread=${parent.id}`));
      await expect(page.getByText('first reply from classic')).toBeVisible(EVENTUAL);

      // A reply from the Lounge; it shows in the thread once the server has it.
      const field = page.getByRole('textbox', { name: 'Reply in thread' });
      await field.fill('a reply from the lounge');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(page.getByRole('list', { name: 'Messages' }).getByText('a reply from the lounge')).toBeVisible(EVENTUAL);
      await expect(field).toHaveValue('');

      // The classic user (1280 px, old shell) sees it in their thread panel.
      const classic = await openSession(browser, { username: TEST_USER.username, password: TEST_USER.password }, { width: 1280, height: 800 });
      try {
        await classic.page.goto(`/#${real}`);
        await classic.page.getByRole('button', { name: /2 replies/ }).click({ timeout: 20_000 });
        await expect(classic.page.getByTestId('thread-panel').getByText('a reply from the lounge')).toBeVisible(EVENTUAL);
      } finally {
        await classic.context.close();
      }

      // A reload on ?thread= opens it again (the entry keeps its state, so Back still steps back one entry) and Back
      // closes it to the channel, focus kept off the page.
      await page.reload();
      await expect(threadHeading(page)).toBeVisible(EVENTUAL);
      await expect(page.getByText('a reply from the lounge')).toBeVisible(EVENTUAL);
      await page.getByRole('button', { name: 'Back to # lobby' }).click();
      await expect(threadHeading(page)).toHaveCount(0, EVENTUAL);
      await expect(page).toHaveURL(hashUrl(real));
      await expect(chatHeading(page, 'lobby')).toBeVisible();
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    } finally {
      await reader.context.close();
    }
  });

  test('pinned messages: the list from More, a jump to the message, a pinned thread reply opens its thread', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const pinnedOne = await sendTestMessage(request, world.c1.lobbyId, 'the pinned rules of the lobby', world.owner.token);
    const parent = await sendTestMessage(request, world.c1.lobbyId, 'a thread with a pinned reply', world.owner.token);
    const reply = await request.post(`${API_BASE}/threads/${parent.id}/replies`, {
      data: { spans: [{ type: 'PLAINTEXT', text: 'the pinned reply' }], attachments: [] },
      headers: { Authorization: `Bearer ${world.owner.token}` },
    });
    expect(reply.ok()).toBe(true);
    const replyId = ((await reply.json()) as { id: string }).id;
    for (const id of [pinnedOne.id, replyId]) {
      const pinned = await request.post(`${API_BASE}/moderation/pin/${id}`, { data: {}, headers: { Authorization: `Bearer ${world.owner.token}` } });
      expect(pinned.ok()).toBe(true);
    }
    for (let i = 0; i < 30; i++) await sendTestMessage(request, world.c1.lobbyId, `filler ${i}`, world.owner.token);
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await openChat(page, world.c1.id, world.c1.lobbyId, '', 'real');
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Pinned messages (2)' }).click();
      const sheet = page.getByRole('dialog', { name: 'Pinned messages (2)' });
      await expect(sheet).toBeVisible(EVENTUAL);
      // A plain member: no Unpin.
      await expect(sheet.getByRole('button', { name: /Unpin/ })).toHaveCount(0);
      await sheet.getByRole('button', { name: /the pinned rules of the lobby/ }).click();
      await expect(sheet).toHaveCount(0, EVENTUAL);
      await expect(row(page, 'the pinned rules of the lobby')).toBeInViewport(EVENTUAL);

      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: /Pinned messages/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: /the pinned reply/ }).click();
      await expect(threadHeading(page)).toBeFocused(EVENTUAL);
      await expect(page.getByText('the pinned reply')).toBeVisible(EVENTUAL);
      // Back closes the thread (it was opened into its own entry), the channel kept underneath.
      await page.getByRole('button', { name: 'Back to # lobby' }).click();
      await expect(threadHeading(page)).toHaveCount(0, EVENTUAL);
      await expect(row(page, 'a thread with a pinned reply')).toBeInViewport(EVENTUAL);
    } finally {
      await context.close();
    }
  });
});

test.describe('The Lounge chat: composer extras (390 px, real route)', () => {
  // A 2×1 PNG (an image the server accepts: a custom emoji, a pasted picture).
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZYAwAZOsJ93W0OVsAAAAASUVORK5CYII=', 'base64');
  const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
  const GIF_SENT = 'https://media.tenor.com/e2e-lounge-medium.gif';
  const GIF_PREVIEW = 'https://media.tenor.com/e2e-lounge-preview.gif';

  test('emoji and custom emoji from the picker, a reaction no quick one has, a GIF and a pasted picture; the other user sees them', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const world = await loungeWorld(request);
    const auth = { Authorization: `Bearer ${world.owner.token}` };
    // The community's custom emoji (the owner may manage them).
    const upload = await request.post(`${API_BASE}/file-upload`, {
      headers: auth,
      multipart: { file: { name: 'e2e_blob.png', mimeType: 'image/png', buffer: PNG }, resourceType: 'CUSTOM_EMOJI', resourceId: world.c1.id },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const created = await request.post(`${API_BASE}/custom-emoji/community/${world.c1.id}`, {
      headers: auth,
      data: { name: 'e2e_blob', fileId: ((await upload.json()) as { id: string }).id },
    });
    expect(created.ok(), await created.text()).toBe(true);
    await sendTestMessage(request, world.c1.lobbyId, 'react to me', world.owner.token);

    const n = await openSession(browser, world.member, PHONE);
    const owner = await openSession(browser, TEST_USER, PHONE);
    const page = n.page;
    // GIF search on, against a stubbed provider (no network to Tenor or Giphy in CI).
    await page.route('**/api/instance/settings/public', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), gifSearchEnabled: true } });
    });
    await page.route('**/api/gifs/featured**', (route) =>
      route.fulfill({
        json: { results: [{ id: 'e2e-gif', title: 'e2e dance', url: GIF_SENT, previewUrl: GIF_PREVIEW, mediumUrl: GIF_SENT, width: 1, height: 1 }], next: '' },
      }),
    );
    for (const context of [n.context, owner.context]) {
      await context.route('https://media.tenor.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: GIF }));
    }
    try {
      // The session's page loaded the public settings before the stub: load them again through it.
      await page.reload();
      await openChat(page, world.c1.id, world.c1.lobbyId, '', 'real');
      await openChat(owner.page, world.c1.id, world.c1.lobbyId, '', 'real');
      await expect(row(page, 'react to me')).toBeVisible(EVENTUAL);
      const field = page.getByRole('textbox', { name: 'Message #lobby' });
      const send = page.getByRole('button', { name: 'Send message' });

      // An emoji and a custom emoji from the picker, inserted where the caret is.
      await field.fill('hello there');
      await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5));
      await page.getByRole('button', { name: 'Add emoji' }).click();
      let picker = page.getByRole('dialog', { name: 'Add emoji' });
      await expect(picker).toBeVisible(EVENTUAL);
      await picker.getByRole('searchbox', { name: 'Search emoji' }).fill('fire');
      await picker.getByRole('button', { name: 'fire' }).first().click();
      await expect(picker).toHaveCount(0, EVENTUAL);
      await expect(field).toHaveValue('hello🔥 there');
      await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
      await page.getByRole('button', { name: 'Add emoji' }).click();
      picker = page.getByRole('dialog', { name: 'Add emoji' });
      await picker.getByRole('button', { name: ':e2e_blob:' }).click();
      await expect(field).toHaveValue('hello🔥 there:e2e_blob:');
      await send.click();
      await expect(row(owner.page, 'hello🔥 there')).toBeVisible(EVENTUAL);
      await expect(row(owner.page, 'hello🔥 there').getByRole('img', { name: ':e2e_blob:' })).toBeVisible(EVENTUAL);

      // A reaction no quick reaction has, through More reactions; the other user sees it.
      await row(page, 'react to me').focus();
      await page.keyboard.press('Enter');
      await page.getByRole('dialog').getByRole('button', { name: 'More reactions' }).click();
      const reactions = page.getByRole('dialog', { name: 'Add reaction' });
      await expect(reactions).toBeVisible(EVENTUAL);
      await reactions.getByRole('searchbox', { name: 'Search emoji' }).fill('pizza');
      await reactions.getByRole('button', { name: 'pizza' }).first().click();
      await expect(reactions).toHaveCount(0, EVENTUAL);
      await expect(row(page, 'react to me').getByRole('button', { name: /reaction, 1$/ })).toBeVisible(EVENTUAL);
      await expect(row(owner.page, 'react to me').getByRole('button', { name: /reaction, 1$/ })).toContainText('🍕', EVENTUAL);

      // A GIF from the picker is sent at once.
      await page.getByRole('button', { name: 'Send a GIF' }).click();
      const gifs = page.getByRole('dialog', { name: 'GIFs' });
      await gifs.getByRole('button', { name: 'e2e dance' }).click();
      await expect(gifs).toHaveCount(0, EVENTUAL);
      await expect(owner.page.getByRole('list', { name: 'Messages' }).locator(`img[src="${GIF_SENT}"]`)).toBeVisible(EVENTUAL);

      // A picture pasted into the field goes to the tray and is sent.
      await field.focus();
      await field.evaluate((el, base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const data = new DataTransfer();
        data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, PNG.toString('base64'));
      await expect(page.getByRole('group', { name: /^pasted\.png/ })).toBeVisible(EVENTUAL);
      await field.fill('a pasted picture');
      await send.click();
      await expect(row(owner.page, 'a pasted picture').getByRole('button', { name: 'Open image pasted.png' })).toBeVisible(EVENTUAL);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await shot(page, testInfo, 'c5-composer-extras');
    } finally {
      await n.context.close();
      await owner.context.close();
    }
  });
});
