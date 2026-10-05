/**
 * Release smoke: the docked right-hand panel (threads, pinned messages) on
 * wide desktop windows, and the drawer fallback on narrower ones.
 */

import { test, expect, TEST_USER } from './fixtures';
import {
  createWorld,
  createTestChannel,
  sendTestMessage,
  generateTestName,
  openSession,
  shot,
  channelUrl,
} from './fixtures';

test.describe('Release smoke: docked side panel', () => {
  test('thread and pins dock beside the chat, Esc closes, narrow windows use a drawer @smoke', async ({
    browser,
    request,
  }, testInfo) => {
    const world = await createWorld(request);
    const channel = await createTestChannel(
      request,
      world.communityId,
      { name: generateTestName('panel') },
      world.ownerToken,
    );
    const seedText = generateTestName('thread-parent');
    const message = await sendTestMessage(request, channel.id, seedText, world.ownerToken);
    // Pin it so the pinned panel has content
    const pin = await request.post(`/api/moderation/pin/${message.id}`, {
      data: {},
      headers: { Authorization: `Bearer ${world.ownerToken}` },
    });
    expect(pin.ok(), `pinning failed: ${pin.status()} ${await pin.text()}`).toBeTruthy();

    const { context, page } = await openSession(browser, TEST_USER, {
      width: 1440,
      height: 900,
    });
    try {
      await page.goto(channelUrl(world.communityId, channel.id));
      const composer = page.getByPlaceholder(`Message #${channel.name}`);
      const row = page.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({
        hasText: seedText,
      });
      await expect(row).toBeVisible();

      // Thread opens docked, and the channel's own composer stays usable
      await row.hover();
      await row.getByRole('button', { name: 'Reply in thread' }).click();
      const threadPanel = page.getByRole('complementary', { name: 'Thread' });
      await expect(threadPanel).toBeVisible();
      await expect(threadPanel.getByTestId('thread-panel')).toBeVisible();
      await expect(composer).toBeVisible();
      await shot(page, testInfo, '5-thread-docked');

      const typed = generateTestName('while-panel-open');
      await composer.fill(typed);
      await composer.press('Enter');
      await expect(page.getByRole('list', { name: 'Messages' }).getByText(typed)).toBeVisible();
      await expect(threadPanel).toBeVisible();
      await shot(page, testInfo, '5-composer-usable-with-panel');

      // Pinned messages swap the panel content
      await page.getByRole('button', { name: /^Pinned messages/ }).click();
      const pinsPanel = page.getByRole('complementary', { name: 'Pinned messages' });
      await expect(pinsPanel).toBeVisible();
      await expect(pinsPanel.getByText(seedText)).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Thread' })).toHaveCount(0);
      await expect(page.getByTestId('docked-side-panel')).toHaveCount(1);
      await shot(page, testInfo, '5-pins-swapped-in');

      // Focus moves into the panel; Esc from inside closes it
      await expect
        .poll(() => pinsPanel.evaluate((el) => el.contains(document.activeElement)))
        .toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('docked-side-panel')).toHaveCount(0);
      await expect(composer).toBeVisible();
      await shot(page, testInfo, '5-closed-with-escape');

      // At 1024px wide the thread is a drawer, not a docked panel
      await page.setViewportSize({ width: 1024, height: 800 });
      const narrowRow = page.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({
        hasText: seedText,
      });
      await narrowRow.hover();
      await narrowRow.getByRole('button', { name: 'Reply in thread' }).click();
      await expect(page.getByTestId('thread-panel')).toBeVisible();
      await expect(page.getByTestId('docked-side-panel')).toHaveCount(0);
      await expect(page.locator('.MuiDrawer-paper').getByTestId('thread-panel')).toBeVisible();
      await shot(page, testInfo, '5-thread-drawer-at-1024');
    } finally {
      await context.close();
    }
  });
});
