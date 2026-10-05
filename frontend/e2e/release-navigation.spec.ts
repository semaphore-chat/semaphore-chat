/**
 * Release smoke: community landing, full-page error state, private channels.
 */

import { randomUUID } from 'node:crypto';
import { test, expect, TEST_USER } from './fixtures';
import {
  MEMBER_USER,
  createWorld,
  createTestChannel,
  generateTestName,
  openSession,
  shot,
  channelUrl,
} from './fixtures';

test.describe('Release smoke: navigation', () => {
  test('opening a community lands in a text channel, not the placeholder @smoke', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await createWorld(request);
    const second = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('landing') },
      world.ownerToken,
    );
    const { context, page } = await openSession(browser, TEST_USER);
    try {
      // No channel in the URL, nothing visited yet: first visible text channel
      await page.goto(`/#/community/${world.communityId}`);
      await expect(page).toHaveURL(/#\/community\/[\w-]+\/channel\/[\w-]+/);
      await expect(page.getByText('Select a channel from the sidebar')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: /^Message #/ })).toBeVisible();
      await shot(page, testInfo, '1-landed-in-first-channel');

      // Visit a specific channel, leave, come back: lands in the last-visited one
      await page.goto(channelUrl(world.communityId, second.id));
      await expect(page.getByPlaceholder(`Message #${second.name}`)).toBeVisible();
      await page.goto(`/#/community/${world.communityId}`);
      await expect(page).toHaveURL(new RegExp(`/channel/${second.id}$`));
      await expect(page.getByPlaceholder(`Message #${second.name}`)).toBeVisible();
      await shot(page, testInfo, '1-landed-in-last-visited-channel');
    } finally {
      await context.close();
    }
  });

  test('a community that does not exist shows the full-page error with Go home @smoke', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await openSession(browser, TEST_USER);
    try {
      await page.goto(`/#/community/${randomUUID()}`);
      await expect(page.getByText('This community no longer exists')).toBeVisible();
      await expect(
        page.getByText('It may have been deleted, or the link is out of date.'),
      ).toBeVisible();
      // Not raw text: a styled state with an action
      const goHome = page.getByRole('button', { name: 'Go home' });
      await expect(goHome).toBeVisible();
      await shot(page, testInfo, '2-community-not-found');

      await goHome.click();
      await expect(page.getByText('This community no longer exists')).toHaveCount(0);
      await expect(page).not.toHaveURL(/#\/community\//);
      await shot(page, testInfo, '2-after-go-home');
    } finally {
      await context.close();
    }
  });

  test('a private channel is hidden from a member who is not on its list @smoke', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await createWorld(request);
    const visible = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('public') },
      world.ownerToken,
    );
    const secret = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('secret'), isPrivate: true },
      world.ownerToken,
    );

    const owner = await openSession(browser, TEST_USER);
    const member = await openSession(browser, MEMBER_USER);
    try {
      // Control: the owner sees the private channel (with its lock) in the sidebar
      await owner.page.goto(channelUrl(world.communityId, visible.id));
      await expect(owner.page.getByText(secret.name, { exact: true })).toBeVisible();
      await expect(owner.page.getByLabel('Private channel').first()).toBeVisible();
      await shot(owner.page, testInfo, '4-owner-sees-private-channel');

      // The member sees the public channel but not the private one
      await member.page.goto(channelUrl(world.communityId, visible.id));
      await expect(member.page.getByText(visible.name, { exact: true }).first()).toBeVisible();
      await expect(member.page.getByText(secret.name, { exact: true })).toHaveCount(0);
      await shot(member.page, testInfo, '4-member-sidebar-without-private-channel');

      // Deep link: no access, no content
      await member.page.goto(channelUrl(world.communityId, secret.id));
      await expect(member.page.getByPlaceholder(`Message #${secret.name}`)).toHaveCount(0);
      await expect(member.page.getByText(secret.name, { exact: true })).toHaveCount(0);
      await expect(
        member.page.getByText(/not found|no access|don't have access|doesn't exist|no longer exists/i).first(),
      ).toBeVisible();
      await shot(member.page, testInfo, '4-member-deep-link-no-access');
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});
