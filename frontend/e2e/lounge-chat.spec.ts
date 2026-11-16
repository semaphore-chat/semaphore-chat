/**
 * The Lounge chat (PR 10c-1 read side, PR 10c-2a write side) on real data, through the hidden chat fixture
 * `/__lounge/community/:communityId/channel/:channelId` at phone width. The real channel route stays the old
 * shell's until 10c-2 (checked here too), so these run on the fixture only.
 *
 * Each test builds its own world (`loungeWorld`): C1 with `lobby` (public) and `staff` (private, the owner's),
 * owned by the seeded `testuser`, and a fresh plain member N in no private channel.
 *
 * Run: scripts/run-e2e.sh lounge-chat
 */
import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, API_BASE, openSession, shot, sendTestMessage } from './fixtures';
import { chatFixturePath, fixturePath, loungeWorld, openFixture } from './fixtures/lounge';

test.describe.configure({ timeout: 120_000 });

const EVENTUAL = { timeout: 20_000 };
const PHONE = { width: 390, height: 844 };

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const chatHeading = (page: Page, name: string) => page.getByRole('heading', { name: `# ${name}`, level: 1 });
const messages = (page: Page) => page.getByRole('list', { name: 'Messages' });
const row = (page: Page, text: string) => messages(page).getByRole('article').filter({ hasText: text });

/** Opens the chat fixture with the new design on for this tab (`?design=lounge`), plus any other query. */
async function openChat(page: Page, communityId: string, channelId: string, query = ''): Promise<void> {
  const extra = query ? `${query}&` : '';
  await page.goto(`/#${chatFixturePath(communityId, channelId)}?${extra}design=lounge`);
  await expect(page.locator('[data-shell="lounge"]')).toBeAttached(EVENTUAL);
}

async function serverUnreadCount(request: Parameters<typeof sendTestMessage>[0], token: string, channelId: string) {
  const res = await request.get(`${API_BASE}/read-receipts/unread-counts`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = (await res.json()) as Array<{ channelId?: string | null; unreadCount: number }>;
  return rows.find((r) => r.channelId === channelId)?.unreadCount ?? 0;
}

test.describe('The Lounge chat on the chat fixture (390 px)', () => {
  test('a channel row opens the chat; history, a live message and the read reach the server; Back returns to the row', async ({
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
      await openFixture(page, world.c1.id, { communityName: world.c1.name });
      const lobby = page.getByRole('navigation', { name: 'Community', exact: true }).getByRole('link', { name: /^lobby/ });
      await expect(lobby).toHaveAccessibleName(/unread/, EVENTUAL);
      await lobby.click();

      await expect(page).toHaveURL(new RegExp(`#${escapeRe(chatFixturePath(world.c1.id, world.c1.lobbyId))}$`));
      await expect(chatHeading(page, 'lobby')).toBeVisible(EVENTUAL);
      await expect(row(page, 'anyone around?')).toBeVisible(EVENTUAL);
      await expect(messages(page).getByRole('separator', { name: 'Today' })).toBeVisible();
      // N had never read the channel: the server's count goes to 0 once the newest message is in view.
      await expect.poll(() => serverUnreadCount(request, world.member.token, world.c1.lobbyId), EVENTUAL).toBe(0);

      // A message from someone else arrives live, in the list.
      await sendTestMessage(request, world.c1.lobbyId, 'on my way', world.owner.token);
      await expect(row(page, 'on my way')).toBeVisible(EVENTUAL);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await shot(page, testInfo, 'c1-chat-with-history');

      // Opening the quoted message is an in-chat jump: it replaces the entry, so one Back still leaves the chat.
      await row(page, 'replying to the first').getByRole('button', { name: /^Reply to / }).click();
      await expect(page).toHaveURL(new RegExp(`#${escapeRe(chatFixturePath(world.c1.id, world.c1.lobbyId))}$`), EVENTUAL);

      await page.getByRole('button', { name: 'Back to the community' }).click();
      await expect(page).toHaveURL(new RegExp(`#${escapeRe(fixturePath(world.c1.id))}$`));
      await expect(lobby).toBeFocused(EVENTUAL);
      await expect(lobby).not.toHaveAccessibleName(/unread/, EVENTUAL);
    } finally {
      await context.close();
    }
  });

  test('a cold ?highlight= deep link lands on that message, and the address stays on the fixture', async ({ browser, request }, testInfo) => {
    const world = await loungeWorld(request);
    let target = '';
    for (let i = 1; i <= 40; i += 1) {
      const sent = await sendTestMessage(request, world.c1.lobbyId, `numbered message ${i}`, world.owner.token);
      if (i === 3) target = sent.id;
    }
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await openChat(page, world.c1.id, world.c1.lobbyId, `highlight=${target}`);
      const highlighted = row(page, 'numbered message 3');
      await expect(highlighted).toBeInViewport(EVENTUAL);
      // The param is cleared once the jump settles, to the fixture's own path (not the real channel route).
      await expect(page).toHaveURL(new RegExp(`#${escapeRe(chatFixturePath(world.c1.id, world.c1.lobbyId))}$`), EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toBeAttached();
      await shot(page, testInfo, 'c2-deep-link');

      // A cold link has nothing to go back to: Back replaces the entry with the community's home.
      await page.getByRole('button', { name: 'Back to the community' }).click();
      await expect(page).toHaveURL(new RegExp(`#${escapeRe(fixturePath(world.c1.id))}$`), EVENTUAL);
    } finally {
      await context.close();
    }
  });

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
      await expect(page).toHaveURL(new RegExp(`#${escapeRe(fixturePath(world.c1.id))}$`), EVENTUAL);
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
      await (await actionsOf('who is around tonight?')).getByRole('button', { name: 'Reply' }).click();
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

  test('a reader in the old shell sees the Lounge user’s message, edit, reaction and delete', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const n = await openSession(browser, world.member, PHONE);
    // The owner reads the same channel in the old shell (the real route, the new design off).
    const classic = await openSession(browser, TEST_USER, { width: 1280, height: 800 });
    try {
      await openChat(n.page, world.c1.id, world.c1.lobbyId);
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
    } finally {
      await n.context.close();
      await classic.context.close();
    }
  });

  test('the real channel route stays the old shell’s chat, even with the new design on', async ({ browser, request }) => {
    const world = await loungeWorld(request);
    const { context, page } = await openSession(browser, world.member, PHONE);
    try {
      await page.goto(`/#/community/${world.c1.id}/channel/${world.c1.lobbyId}?design=lounge`);
      await expect(page.getByRole('textbox', { name: /^Message #lobby/ })).toBeVisible(EVENTUAL);
      await expect(page.locator('[data-shell="lounge"]')).toHaveCount(0);
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
