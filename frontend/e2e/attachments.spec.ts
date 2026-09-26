/**
 * Attachment E2E Tests
 *
 * Sending a message with a file: it shows up at once as a pending message
 * with the file's upload progress, then the real attachment replaces it.
 */

import { test, expect, TEST_USER, loginViaApi } from './fixtures';
import {
  generateTestName,
  createTestCommunity,
  createTestChannel,
  deleteCommunity,
} from './fixtures';

test.describe('Attachments', () => {
  let community: { id: string; name: string };
  let channel: { id: string; name: string };
  let authToken: string;

  test.beforeAll(async ({ request }) => {
    const { accessToken } = await loginViaApi(request, TEST_USER);
    authToken = accessToken;
    community = await createTestCommunity(request, { name: generateTestName('attach-test') }, authToken);
    channel = await createTestChannel(request, community.id, { name: 'uploads', type: 'TEXT' }, authToken);
  });

  test.afterAll(async ({ request }) => {
    if (community?.id) {
      await deleteCommunity(request, community.id, authToken).catch(() => {});
    }
  });

  test('a message with a file shows its upload, then the attachment @smoke', async ({ authenticatedPage: page }) => {
    // Hold the upload until the pending state has been checked.
    let releaseUpload: () => void = () => {};
    const uploadHeld = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route('**/api/file-upload', async (route) => {
      await uploadHeld;
      await route.continue();
    });

    await page.goto(`/#/community/${community.id}/channel/${channel.id}`);
    const composer = page.getByPlaceholder(/Type a message/);
    await expect(composer).toBeVisible({ timeout: 15000 });

    const caption = `upload check ${Date.now()}`;
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'e2e-notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('attachment upload e2e\n'.repeat(64)),
    });
    await composer.fill(caption);
    await composer.press('Enter');

    // At once: the message with its text, and the file's progress.
    await expect(page.getByText(caption)).toBeVisible();
    const progress = page.getByRole('progressbar', { name: 'Uploading e2e-notes.txt' });
    await expect(progress).toBeVisible();

    releaseUpload();

    // The tile goes, the real attachment (a download card) takes its place.
    await expect(progress).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText('e2e-notes.txt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'download file' })).toBeVisible();
  });
});
