import { expect, test, type Page } from '@playwright/test';
import { openStory } from './story.ts';

/**
 * Threads and pinned messages in the Lounge chat (PR 10d-B), in a real browser at phone width: the thread opens at
 * its parent with its heading focused, Tab never reaches the covered channel, Back gives focus to "3 replies" (never
 * the page), and the pinned sheet returns focus to More; a jump leaves focus in the chat.
 */
const PHONE = { width: 390, height: 844 };

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? null,
      name: el?.getAttribute('aria-label') ?? el?.textContent?.trim().slice(0, 40) ?? null,
      // Inside the conversation a thread covers (ChatPane marks it): never focusable while covered.
      inert: el?.closest('[data-chat-pane-covered]') != null,
      body: el === document.body,
    };
  });

async function waitForFocus(page: Page, check: (f: Awaited<ReturnType<typeof focused>>) => boolean) {
  await expect.poll(async () => check(await focused(page)), { timeout: 5_000 }).toBe(true);
}

test('the thread opens at its parent with its heading focused; Tab stays out of the covered channel', async ({ page }) => {
  await openStory(page, 'channel-chat--thread-open', PHONE);
  await waitForFocus(page, (f) => f.tag === 'H1' && f.name === 'Thread');
  // The parent is the first row, at the top of the list.
  const top = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].filter((row) => row.closest('[inert]') === null);
    const list = rows[0]?.closest('[role="list"]')?.getBoundingClientRect();
    return { first: rows[0]?.textContent?.includes('const party') ?? false, atTop: list ? Math.abs(rows[0].getBoundingClientRect().top - list.top) < 4 : false };
  });
  expect(top).toEqual({ first: true, atTop: true });
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    expect(f.inert, JSON.stringify(f)).toBe(false);
  }
});

test('Back closes the thread: focus returns to "3 replies", the channel is no longer inert, the URL loses ?thread=', async ({ page }) => {
  await openStory(page, 'channel-chat--thread-open', PHONE);
  await waitForFocus(page, (f) => f.tag === 'H1');
  await page.getByRole('button', { name: 'Back to # general' }).click();
  await waitForFocus(page, (f) => f.name === '3 replies, open the thread');
  expect(await page.evaluate(() => document.querySelector('[data-chat-pane-covered]'))).toBeNull();
});

test('a long thread loads at the top and scrolls to its last reply without dropping focus', async ({ page }) => {
  await openStory(page, 'channel-chat--thread-long', PHONE);
  await waitForFocus(page, (f) => f.tag === 'H1');
  // The list's one Tab stop is the parent (the first row): Tab reaches it, then End goes to the last reply.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const onParent = await page.evaluate(
      () => document.activeElement?.hasAttribute('data-row-focus-target') === true && document.activeElement?.textContent?.includes('const party') === true,
    );
    if (onParent) break;
  }
  expect(await page.evaluate(() => document.activeElement?.textContent?.includes('const party') ?? false)).toBe(true);
  await page.keyboard.press('End');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[data-message-id]')?.textContent ?? document.activeElement?.tagName ?? ''))
    .toContain('reply 40');
});

test('the pinned sheet: Escape returns focus to More; a jump closes it and leaves focus in the chat', async ({ page }) => {
  await openStory(page, 'channel-chat--pinned-list', PHONE);
  await expect(page.getByRole('dialog', { name: 'Pinned messages (4)' })).toBeVisible();
  await page.keyboard.press('Escape');
  await waitForFocus(page, (f) => f.name === 'More');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Pinned messages/ }).click();
  await page.getByRole('button', { name: /Show the message from kwam3: screens from last night/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await waitForFocus(page, (f) => !f.body && !f.inert);
});

test('a pinned thread reply opens its thread with the heading focused; Back returns to the channel, focus not on the page', async ({ page }) => {
  await openStory(page, 'channel-chat--pinned-list', PHONE);
  await page.getByRole('button', { name: /Show the message from dropbear: can we do 9:15/ }).click();
  await waitForFocus(page, (f) => f.tag === 'H1' && f.name === 'Thread');
  await page.getByRole('button', { name: 'Back to # general' }).click();
  await waitForFocus(page, (f) => !f.body && !f.inert);
});

test('no sideways scroll at 390 px in the thread and the pinned sheet', async ({ page }) => {
  for (const id of ['channel-chat--thread-long', 'channel-chat--pinned-list-many']) {
    await openStory(page, id, PHONE);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
});
