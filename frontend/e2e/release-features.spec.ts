/**
 * Release smoke: channel permission presets, #channel mentions and the
 * message-authorization regression.
 */

import { test, expect, TEST_USER, API_BASE } from './fixtures';
import {
  MEMBER_USER,
  createWorld,
  createTestChannel,
  sendTestMessage,
  generateTestName,
  openSession,
  sendSpans,
  shot,
  channelUrl,
} from './fixtures';
import type { Page } from '@playwright/test';

const messageList = (page: Page) => page.getByRole('list', { name: 'Messages' });

/** Owner side: community settings -> the channel's Edit dialog -> Permissions tab. */
async function openChannelPermissions(page: Page, communityId: string, channelName: string) {
  await page.goto(`/#/community/${communityId}/edit`);
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  // The settings rows are plain boxes: take the nearest one holding an edit button
  const row = page
    .getByText(channelName, { exact: true })
    .locator("xpath=ancestor::div[.//button[@title='Edit channel']][1]");
  await row.getByRole('button', { name: 'Edit channel' }).click();
  await page.getByRole('tab', { name: 'Permissions' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Channel permission preset' })).toBeVisible();
}

async function savePreset(page: Page, preset: RegExp) {
  await page.getByRole('radio', { name: preset }).click();
  await expect(page.getByRole('radio', { name: preset })).toBeChecked();
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('Release smoke: channel permission presets', () => {
  test('Announcement preset: icon, read-only member, admin posts, back to Normal @smoke', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    const world = await createWorld(request);
    const channel = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('announce') },
      world.ownerToken,
    );
    const owner = await openSession(browser, TEST_USER);
    const member = await openSession(browser, MEMBER_USER);
    try {
      // Control: in a Normal channel the member has a usable composer
      await member.page.goto(channelUrl(world.communityId, channel.id));
      await expect(member.page.getByPlaceholder(`Message #${channel.name}`)).toBeVisible();
      await expect(member.page.getByTestId('composer-unavailable')).toHaveCount(0);

      // Admin applies the Announcement preset
      await openChannelPermissions(owner.page, world.communityId, channel.name);
      await shot(owner.page, testInfo, '3-permissions-tab-before');
      await savePreset(owner.page, /Announcement/);
      await shot(owner.page, testInfo, '3-after-save');

      // Sidebar shows the megaphone for that channel
      await owner.page.goto(channelUrl(world.communityId, channel.id));
      await expect(owner.page.getByLabel('Announcement channel')).toBeVisible();
      await shot(owner.page, testInfo, '3-admin-sidebar-megaphone');

      // The member opens the channel afresh and gets the read-only notice
      await member.page.reload();
      const notice = member.page.getByTestId('composer-unavailable');
      await expect(notice).toContainText(`#${channel.name} is read-only`);
      await expect(notice).toContainText(/Only .+ can post/);
      await expect(member.page.getByPlaceholder(`Message #${channel.name}`)).toHaveCount(0);
      await expect(member.page.getByRole('textbox', { name: /^Message #/ })).toHaveCount(0);
      await shot(member.page, testInfo, '3-member-read-only-notice');

      // The admin can still post, and the member sees it
      const adminText = generateTestName('announcement');
      const adminInput = owner.page.getByPlaceholder(`Message #${channel.name}`);
      await adminInput.fill(adminText);
      await adminInput.press('Enter');
      await expect(messageList(owner.page).getByText(adminText)).toBeVisible();
      await expect(messageList(member.page).getByText(adminText)).toBeVisible();
      await shot(owner.page, testInfo, '3-admin-posted');

      // Back to Normal: the member can post again
      await openChannelPermissions(owner.page, world.communityId, channel.name);
      await savePreset(owner.page, /Normal/);
      const memberInput = member.page.getByPlaceholder(`Message #${channel.name}`);
      await expect(memberInput).toBeVisible();
      await expect(member.page.getByTestId('composer-unavailable')).toHaveCount(0);
      const memberText = generateTestName('member-post');
      await memberInput.fill(memberText);
      await memberInput.press('Enter');
      await expect(messageList(member.page).getByText(memberText)).toBeVisible();
      await shot(member.page, testInfo, '3-member-posts-again');

      // And the megaphone is gone from the sidebar
      await owner.page.goto(channelUrl(world.communityId, channel.id));
      await expect(owner.page.getByText(channel.name, { exact: true }).first()).toBeVisible();
      await expect(owner.page.getByLabel('Announcement channel')).toHaveCount(0);
      await expect(messageList(owner.page).getByText(memberText)).toBeVisible();
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});

test.describe('Release smoke: live permission changes', () => {
  test('a member already in the channel gets the read-only notice without reloading', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    // KNOWN APP BUG (found by this spec): when the preset changes while the
    // member has the channel open, the composer's capabilities refresh (the
    // input is replaced) but the cached channel (`channelsControllerFindOne`,
    // which carries `preset`) is not invalidated, so the notice says "You can't
    // send messages in #x" instead of "#x is read-only. Only ... can post". A
    // reload shows the right copy. This test is expected to fail until that is
    // fixed; when it starts passing, Playwright flags it: delete test.fail().
    test.fail(true, 'stale channel preset in the open member session');
    const world = await createWorld(request);
    const channel = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('live') },
      world.ownerToken,
    );
    const owner = await openSession(browser, TEST_USER);
    const member = await openSession(browser, MEMBER_USER);
    try {
      await member.page.goto(channelUrl(world.communityId, channel.id));
      await expect(member.page.getByPlaceholder(`Message #${channel.name}`)).toBeVisible();

      await openChannelPermissions(owner.page, world.communityId, channel.name);
      await savePreset(owner.page, /Announcement/);

      const notice = member.page.getByTestId('composer-unavailable');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(`#${channel.name} is read-only`);
      await shot(member.page, testInfo, '3-member-live-read-only-notice');
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});

test.describe('Release smoke: #channel mentions', () => {
  test('a member mentions a channel with #name and it renders as a link @smoke', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await createWorld(request);
    const home = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('chat') },
      world.ownerToken,
    );
    const target = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('target') },
      world.ownerToken,
    );
    const member = await openSession(browser, MEMBER_USER);
    try {
      await member.page.goto(channelUrl(world.communityId, home.id));
      const input = member.page.getByPlaceholder(`Message #${home.name}`);
      await expect(input).toBeVisible();

      // The composer resolves a typed #channel-name against the channels the
      // sender can see (there is no autocomplete dropdown for # yet)
      await input.fill(`look at #${target.name}`);
      await shot(member.page, testInfo, '6-typed-channel-mention');
      await input.press('Enter');

      const mention = messageList(member.page).getByTestId('channel-mention');
      await expect(mention).toHaveText(`#${target.name}`);
      await expect(mention).toHaveAttribute('href', new RegExp(`/channel/${target.id}$`));
      await shot(member.page, testInfo, '6-mention-rendered-as-link');

      await mention.click();
      await expect(member.page).toHaveURL(new RegExp(`/channel/${target.id}$`));
      await expect(member.page.getByPlaceholder(`Message #${target.name}`)).toBeVisible();
    } finally {
      await member.context.close();
    }
  });

  test('a private channel mentioned by an admin reads "#private-channel" for a member @smoke', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await createWorld(request);
    const home = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('chat') },
      world.ownerToken,
    );
    const secret = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('secret'), isPrivate: true },
      world.ownerToken,
    );
    await sendSpans(
      request,
      home.id,
      [
        { type: 'PLAINTEXT', text: 'meet in ' },
        { type: 'CHANNEL_MENTION', channelId: secret.id },
      ],
      world.ownerToken,
    );

    const owner = await openSession(browser, TEST_USER);
    const member = await openSession(browser, MEMBER_USER);
    try {
      await owner.page.goto(channelUrl(world.communityId, home.id));
      await expect(messageList(owner.page).getByTestId('channel-mention')).toHaveText(
        `#${secret.name}`,
      );
      await shot(owner.page, testInfo, '6-admin-sees-private-mention');

      await member.page.goto(channelUrl(world.communityId, home.id));
      const hidden = messageList(member.page).getByTestId('channel-mention-hidden');
      await expect(hidden).toHaveText('#private-channel');
      await expect(member.page.getByText(secret.name)).toHaveCount(0);
      await shot(member.page, testInfo, '6-member-sees-private-channel-placeholder');
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});

test.describe('Release smoke: message authorization', () => {
  test('a member cannot edit or delete someone else\'s message, in the UI or the API @smoke', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await createWorld(request);
    const channel = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('authz') },
      world.ownerToken,
    );
    const ownerText = generateTestName('owner-msg');
    const memberText = generateTestName('member-msg');
    const ownerMessage = await sendTestMessage(request, channel.id, ownerText, world.ownerToken);
    await sendTestMessage(request, channel.id, memberText, world.memberToken);

    const member = await openSession(browser, MEMBER_USER);
    try {
      const page = member.page;
      await page.goto(channelUrl(world.communityId, channel.id));

      // Control: on their own message the member does get Edit and Delete
      const own = messageList(page).getByRole('listitem').filter({ hasText: memberText });
      await own.hover();
      await expect(own.getByRole('button', { name: 'Edit message' })).toBeVisible();
      await expect(own.getByRole('button', { name: 'Delete message' })).toBeVisible();

      // Someone else's message: toolbar shows (e.g. emoji / reply), but no Edit/Delete
      const other = messageList(page).getByRole('listitem').filter({ hasText: ownerText });
      await other.hover();
      await expect(other.getByRole('button', { name: 'Reply in thread' })).toBeVisible();
      await expect(other.getByRole('button', { name: 'Edit message' })).toHaveCount(0);
      await expect(other.getByRole('button', { name: 'Delete message' })).toHaveCount(0);
      await shot(page, testInfo, '7-member-hover-others-message');

      // Same through the context menu
      await other.click({ button: 'right' });
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /^Edit/ })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: /^Delete/ })).toHaveCount(0);
      await shot(page, testInfo, '7-member-context-menu');
      await page.keyboard.press('Escape');

      // API: the member's token is refused on both routes
      const headers = { Authorization: `Bearer ${member.token}` };
      const patch = await page.request.patch(`${API_BASE}/messages/${ownerMessage.id}`, {
        headers,
        data: { spans: [{ type: 'PLAINTEXT', text: 'hijacked' }] },
      });
      expect(patch.status()).toBe(403);
      const del = await page.request.delete(`${API_BASE}/messages/${ownerMessage.id}`, { headers });
      expect(del.status()).toBe(403);

      // The message is intact
      await page.reload();
      await expect(messageList(page).getByText(ownerText)).toBeVisible();
      await expect(messageList(page).getByText('hijacked')).toHaveCount(0);
      await shot(page, testInfo, '7-message-intact');
    } finally {
      await member.context.close();
    }
  });
});
