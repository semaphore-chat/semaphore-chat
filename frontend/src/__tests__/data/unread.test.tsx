import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createTestQueryClient, createTestWrapper } from '../test-utils';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

import { useUnreadSummary, useChannelUnread, useNotificationCount, groupUnreadByCommunity, inboxUnread } from '../../data/unread';
import { useReadReceipts } from '../../hooks/useReadReceipts';
import { handleNewMessage, handleReadReceiptUpdated } from '../../socket-hub/handlers/messageHandlers';
import { userControllerGetProfileQueryKey } from '../../api-client/@tanstack/react-query.gen';

const BASE = 'http://localhost:3000';

const COUNTS = [
  { channelId: 'ch-general', communityId: 'c-1', unreadCount: 3, mentionCount: 2 },
  { channelId: 'ch-random', communityId: 'c-1', unreadCount: 1, mentionCount: 0 },
  { channelId: 'ch-other', communityId: 'c-2', unreadCount: 0, mentionCount: 0 },
  // A DM: its unread counts once in the inbox, even though it also made a notification (F5)
  { directMessageGroupId: 'dm-1', unreadCount: 5, mentionCount: 5 },
];

function setup(counts: unknown[] = COUNTS) {
  server.use(http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(counts)));
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'me' } as never);
  const hook = renderHook(() => ({ summary: useUnreadSummary(), receipts: useReadReceipts() }), {
    wrapper: createTestWrapper({ queryClient }),
  });
  return { queryClient, ...hook };
}

describe('useUnreadSummary', () => {
  it('reads per-channel counts from the unread-counts endpoint', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.summary.channel('ch-general')).toEqual({ unread: 3, mentions: 2 }));
    expect(result.current.summary.channel('ch-random')).toEqual({ unread: 1, mentions: 0 });
    expect(result.current.summary.channel('unknown')).toEqual({ unread: 0, mentions: 0 });
    expect(result.current.summary.channel(undefined)).toEqual({ unread: 0, mentions: 0 });
  });

  it('groups channels by community', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.summary.community('c-1')).toEqual({ mentions: 2, hasUnread: true }));
    expect(result.current.summary.community('c-2')).toEqual({ mentions: 0, hasUnread: false });
    expect(result.current.summary.community('c-unknown')).toEqual({ mentions: 0, hasUnread: false });
  });

  it('counts an entry the socket inserted without communityId for no community until the refetch tags it', async () => {
    let counts: unknown[] = [{ channelId: 'ch-general', communityId: 'c-1', unreadCount: 0, mentionCount: 0 }];
    server.use(http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(counts)));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'me' } as never);
    const { result } = renderHook(() => useUnreadSummary(), { wrapper: createTestWrapper({ queryClient }) });
    await waitFor(() => expect(result.current.channel('ch-general').unread).toBe(0));

    // A message in a channel the cache has no entry for: the handler adds one
    // without communityId and invalidates; the refetch brings the tagged entry.
    counts = [...counts, { channelId: 'ch-new', communityId: 'c-1', unreadCount: 1, mentionCount: 0 }];
    let release!: () => void;
    const refetchHeld = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(`${BASE}/api/read-receipts/unread-counts`, async () => {
        await refetchHeld;
        return HttpResponse.json(counts);
      }),
    );
    await act(async () => {
      await handleNewMessage(
        { message: { id: 'm-2', channelId: 'ch-new', directMessageGroupId: null, authorId: 'someone' } as never },
        queryClient,
      );
    });

    // Before the refetch lands: counted for the channel, for no community
    await waitFor(() => expect(result.current.channel('ch-new').unread).toBe(1));
    expect(result.current.community('c-1').hasUnread).toBe(false);
    // After it: the community has it
    release();
    await waitFor(() => expect(result.current.community('c-1').hasUnread).toBe(true));
  });

  it('counts text channels only (a voice channel has no badge in the classic rows), and untyped entries', () => {
    const entries = [
      { channelId: 't', communityId: 'c', channelType: 'TEXT' as const, unreadCount: 1, mentionCount: 1 },
      { channelId: 'v', communityId: 'c', channelType: 'VOICE' as const, unreadCount: 4, mentionCount: 3 },
      { channelId: 'u', communityId: 'c', unreadCount: 0, mentionCount: 2 },
    ];
    expect(groupUnreadByCommunity(entries).get('c')).toEqual({ mentions: 3, hasUnread: true });
    expect(inboxUnread(entries)).toEqual({ directMessages: 0, mentions: 3, total: 3 });
    expect(groupUnreadByCommunity([entries[1]]).get('c')).toBeUndefined();
  });

  it('counts the inbox as DM unread + channel mentions, a DM once', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.summary.inbox).toEqual({ directMessages: 5, mentions: 2, total: 7 }));
  });

  it('changes in the same render as useReadReceipts when a socket message arrives', async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.summary.channel('ch-other').unread).toBe(0));

    await act(async () => {
      await handleNewMessage(
        { message: { id: 'm-1', channelId: 'ch-other', directMessageGroupId: null, authorId: 'someone' } as never },
        queryClient,
      );
    });

    // One render carries both readers' new value (same query, same notification)
    await waitFor(() => {
      expect(result.current.receipts.unreadCount('ch-other')).toBe(1);
      expect(result.current.summary.channel('ch-other').unread).toBe(1);
    });
    expect(result.current.summary.community('c-2').hasUnread).toBe(true);
  });

  it('clears when the read receipt arrives', async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.summary.channel('ch-general').mentions).toBe(2));

    act(() => {
      handleReadReceiptUpdated({ channelId: 'ch-general', directMessageGroupId: null, lastReadMessageId: 'm-9' } as never, queryClient);
    });

    await waitFor(() => expect(result.current.summary.channel('ch-general')).toEqual({ unread: 0, mentions: 0 }));
    expect(result.current.summary.inbox.mentions).toBe(0);
  });

  it('keeps the same object while the counts are unchanged (safe to memoize on)', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.summary.channel('ch-general').unread).toBe(3));
    const before = result.current.summary;
    rerender();
    expect(result.current.summary).toBe(before);
  });

  it('useChannelUnread reads one channel', async () => {
    server.use(http.get(`${BASE}/api/read-receipts/unread-counts`, () => HttpResponse.json(COUNTS)));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useChannelUnread('ch-general'), { wrapper: createTestWrapper({ queryClient }) });
    await waitFor(() => expect(result.current).toEqual({ unread: 3, mentions: 2 }));
  });

  it('is empty before the counts load', () => {
    expect(groupUnreadByCommunity(undefined).size).toBe(0);
    expect(inboxUnread(undefined)).toEqual({ directMessages: 0, mentions: 0, total: 0 });
  });
});

describe('useNotificationCount', () => {
  it('reads the unread notification count (the bell)', async () => {
    server.use(http.get(`${BASE}/api/notifications/unread-count`, () => HttpResponse.json({ count: 7 })));
    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useNotificationCount(), { wrapper: createTestWrapper({ queryClient }) });
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(7));
  });
});
