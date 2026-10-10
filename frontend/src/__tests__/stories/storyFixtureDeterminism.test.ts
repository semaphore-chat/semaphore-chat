/**
 * A story that opens a DM conversation must not seed that conversation unread.
 *
 * A screen story renders the app **at a route**, and the app marks the conversation that route
 * opens read as soon as its newest message is visible (`useMessageVisibility`, frontend/src/hooks/
 * useMessageVisibility.ts). Seeding unread on the open conversation therefore leaves the Direct
 * Messages unread badge (the community rail, the mobile bottom navigation) depending on whether
 * that asynchronous clear has landed by the time the page is captured — the same story comes out
 * with a different number from one capture to the next. Seed it with `withOpenedContextRead()`
 * instead: that is the state the app converges to, so the badge no longer depends on the timing.
 *
 * A story whose conversation cannot load (a hanging or failing endpoint, no messages at all) never
 * gets to the read state, so its seed is not a race and stays: those stories document the app
 * never clearing it.
 *
 * This walks every story that has MSW handlers and a route opening a DM conversation, and — for
 * the ones whose messages load — asserts the badge its handlers serve is the same with and without
 * the app's clear.
 */
import type { HttpHandler } from 'msw';
import { server } from '../msw/server';

interface UnreadRow {
  channelId?: string;
  directMessageGroupId?: string;
  unreadCount: number;
}

type Story = ((...args: unknown[]) => unknown) & { msw?: HttpHandler[]; path?: string };

/** How long a story's messages may take before we treat the conversation as never loading. */
const MESSAGES_LOAD_TIMEOUT_MS = 1000;

/** The DM group a route opens, if it opens one (the DM list, and everything else, opens none). */
function openedDmGroupId(path: string): string | undefined {
  return /^\/direct-messages\/([^/?#]+)/.exec(path)?.[1];
}

/** The rail's Direct Messages badge: the unread counts of every DM group. */
function dmUnreadTotal(rows: UnreadRow[]): number {
  return rows.filter((row) => row.directMessageGroupId).reduce((sum, row) => sum + row.unreadCount, 0);
}

/** `rows` with the opened conversation zeroed — what the app's own mark-as-read does. */
function afterOpenedDmCleared(rows: UnreadRow[], dmGroupId: string): UnreadRow[] {
  return rows.map((row) => (row.directMessageGroupId === dmGroupId ? { ...row, unreadCount: 0 } : row));
}

/** The story's answer for `url`, or `undefined` when it errors or never arrives. */
async function servedBody(story: Story, url: string): Promise<unknown> {
  server.use(...(story.msw ?? []));
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(MESSAGES_LOAD_TIMEOUT_MS) });
    return response.ok ? ((await response.json()) as unknown) : undefined;
  } catch {
    return undefined;
  } finally {
    server.resetHandlers();
  }
}

/** Whether the app gets a page of messages for `dmGroupId` from this story (it clears the unread then). */
async function messagesLoad(story: Story, dmGroupId: string): Promise<boolean> {
  const body = (await servedBody(story, `/api/messages/group/${dmGroupId}`)) as { messages?: unknown[] } | undefined;
  return Array.isArray(body?.messages) && body.messages.length > 0;
}

describe('story fixtures seed their open conversation read', () => {
  it('the Direct Messages badge is the same whether or not the app has cleared the open conversation', async () => {
    const modules = import.meta.glob('../../stories/**/*.stories.tsx', { eager: true }) as Record<
      string,
      Record<string, unknown>
    >;
    const racing: { story: string; openDm: string; served: number; afterClear: number }[] = [];
    let checked = 0;

    for (const [file, module] of Object.entries(modules)) {
      for (const [name, exportValue] of Object.entries(module)) {
        const story = exportValue as Story;
        if (typeof story !== 'function' || !story.msw || !story.path) continue;
        const dmGroupId = openedDmGroupId(story.path);
        if (!dmGroupId) continue;
        if (!(await messagesLoad(story, dmGroupId))) continue;
        const rows = (await servedBody(story, '/api/read-receipts/unread-counts')) as UnreadRow[] | undefined;
        if (!Array.isArray(rows)) continue;
        checked += 1;

        const served = dmUnreadTotal(rows);
        const afterClear = dmUnreadTotal(afterOpenedDmCleared(rows, dmGroupId));
        if (served !== afterClear) {
          racing.push({
            story: `${file.replace('../../stories/', '')}#${name}`,
            openDm: dmGroupId,
            served,
            afterClear,
          });
        }
      }
    }

    expect(checked).toBeGreaterThan(5);
    expect(racing).toEqual([]);
  }, 120_000);
});
