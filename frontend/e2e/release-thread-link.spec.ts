/**
 * Release smoke: a thread link (`?thread=<id>`, the shared contract the new shell writes) in the classic chat on a
 * touch layout (tablet width, real overlay history). The thread opens, its Close button closes it, and it stays
 * closed (the URL drops the param after the overlay entry has unwound, so the old entry cannot reopen it).
 */
import { test, expect, TEST_USER, deleteWorlds, createWorld, createTestChannel, sendTestMessage, generateTestName, openSession, channelUrl } from './fixtures';

test.afterEach(async ({ request }) => deleteWorlds(request));

test('classic tablet: a ?thread= link opens the thread; Close closes it and it stays closed', async ({ browser, request }) => {
  const world = await createWorld(request);
  const channel = await createTestChannel(request, world.communityId, { name: generateTestName('tl') }, world.ownerToken);
  const parent = await sendTestMessage(request, channel.id, generateTestName('thread-link-parent'), world.ownerToken);
  const reply = await request.post(`/api/threads/${parent.id}/replies`, {
    data: { spans: [{ type: 'PLAINTEXT', text: 'a reply in the linked thread' }], attachments: [] },
    headers: { Authorization: `Bearer ${world.ownerToken}` },
  });
  expect(reply.ok()).toBe(true);
  const { context, page } = await openSession(browser, TEST_USER, { width: 820, height: 1180 });
  try {
    await page.goto(`${channelUrl(world.communityId, channel.id)}?thread=${parent.id}`);
    const panel = page.getByTestId('thread-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText('a reply in the linked thread')).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('button', { name: 'Close thread' }).click();
    await expect(panel).toHaveCount(0, { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`/channel/${channel.id}$`), { timeout: 10_000 });
    // Stays closed: watch the page for 1.5 s; the panel must never come back.
    const cameBack = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const seen = () => document.querySelector('[data-testid="thread-panel"]') !== null;
          if (seen()) return resolve(true);
          const observer = new MutationObserver(() => {
            if (seen()) {
              observer.disconnect();
              resolve(true);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(false);
          }, 1500);
        }),
    );
    expect(cameBack).toBe(false);
  } finally {
    await context.close();
  }
});
