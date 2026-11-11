import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { PaginatedMessagesResponseDto, DmPeerReadDto } from '../../../api-client/types.gen';
import {
  handleNewMessage,
  handleUpdateMessage,
  handleDeleteMessage,
  handleMessageUnpinned,
  handleThreadReplyCountUpdated,
  handleReadReceiptUpdated,
} from '../../../socket-hub/handlers/messageHandlers';
import { channelMessagesQueryKey } from '../../../utils/messageQueryKeys';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  readReceiptsControllerGetDmPeerReadsQueryKey,
  userControllerGetProfileQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import { setActiveDmGroupId } from '../../../utils/activeDmTracking';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    channelId: 'ch-1',
    directMessageGroupId: null,
    authorId: 'user-1',
    content: 'hello',
    spans: [{ type: 'PLAINTEXT', text: 'hello' }],
    reactions: [],
    attachments: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeInfiniteData(messages: ReturnType<typeof makeMessage>[]): InfiniteData<PaginatedMessagesResponseDto> {
  return {
    pages: [{ messages: messages as never[], continuationToken: undefined }],
    pageParams: [undefined],
  };
}

describe('messageHandlers', () => {
  describe('handleNewMessage', () => {
    it('prepends a new message to the channel cache', async () => {
      const queryClient = new QueryClient();
      const existing = makeMessage({ id: 'msg-0', content: 'old' });
      const queryKey = channelMessagesQueryKey('ch-1');

      queryClient.setQueryData(queryKey, makeInfiniteData([existing]));

      const newMsg = makeMessage({ id: 'msg-1', content: 'new' });
      await handleNewMessage({ message: newMsg as never }, queryClient);

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      expect(data!.pages[0].messages).toHaveLength(2);
      expect(data!.pages[0].messages[0].id).toBe('msg-1');
    });

    it('does not duplicate an existing message', async () => {
      const queryClient = new QueryClient();
      const msg = makeMessage({ id: 'msg-1' });
      const queryKey = channelMessagesQueryKey('ch-1');

      queryClient.setQueryData(queryKey, makeInfiniteData([msg]));
      await handleNewMessage({ message: msg as never }, queryClient);

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      expect(data!.pages[0].messages).toHaveLength(1);
    });

    it('does not insert into a detached window (newest page evicted) but still bumps unread', async () => {
      const queryClient = new QueryClient();
      const queryKey = channelMessagesQueryKey('ch-1');
      const detached: InfiniteData<PaginatedMessagesResponseDto> = {
        ...makeInfiniteData([makeMessage({ id: 'stale-1' })]),
        pageParams: ['cursor-uuid'],
      };

      queryClient.setQueryData(queryKey, detached);
      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
      queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
        { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
      ]);

      const newMsg = makeMessage({ id: 'new-1', channelId: 'ch-1', authorId: 'other' });
      await handleNewMessage({ message: newMsg as never }, queryClient);

      const after = queryClient.getQueryData(queryKey);
      expect(after).toBe(detached); // untouched

      const unread = queryClient.getQueryData<{ channelId: string; unreadCount: number }[]>(
        readReceiptsControllerGetUnreadCountsQueryKey(),
      );
      expect(unread![0].unreadCount).toBe(1); // still counted
    });

    it('reconciles an own pending optimistic row in place instead of duplicating it (echo-first race)', async () => {
      const queryClient = new QueryClient();
      const queryKey = channelMessagesQueryKey('ch-1');
      const optimistic = makeMessage({
        id: 'pending-abc',
        clientId: 'pending-abc',
        clientNonce: 'nonce-abc',
        sendStatus: 'pending',
        authorId: 'me',
      });

      queryClient.setQueryData(queryKey, makeInfiniteData([optimistic]));
      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
      queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
        { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
      ]);

      const realMsg = makeMessage({ id: 'real-1', channelId: 'ch-1', authorId: 'me', clientNonce: 'nonce-abc' });
      await handleNewMessage({ message: realMsg as never }, queryClient);

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      // Exactly one row for this message — the real one — never both.
      expect(data!.pages[0].messages).toHaveLength(1);
      expect(data!.pages[0].messages[0].id).toBe('real-1');
    });

    it('multi-pending: failed-A + pending-B, echo for B reconciles B and leaves A untouched', async () => {
      const queryClient = new QueryClient();
      const queryKey = channelMessagesQueryKey('ch-1');
      const failedA = makeMessage({
        id: 'pending-a',
        clientId: 'pending-a',
        clientNonce: 'nonce-a',
        sendStatus: 'failed',
        authorId: 'me',
        spans: [{ type: 'PLAINTEXT', text: 'message A' }],
      });
      const pendingB = makeMessage({
        id: 'pending-b',
        clientId: 'pending-b',
        clientNonce: 'nonce-b',
        sendStatus: 'pending',
        authorId: 'me',
        spans: [{ type: 'PLAINTEXT', text: 'message B' }],
      });

      queryClient.setQueryData(queryKey, makeInfiniteData([pendingB, failedA]));
      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
      queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
        { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
      ]);

      const echoForB = makeMessage({
        id: 'real-b',
        clientNonce: 'nonce-b',
        channelId: 'ch-1',
        authorId: 'me',
        spans: [{ type: 'PLAINTEXT', text: 'message B' }],
      });
      await handleNewMessage({ message: echoForB as never }, queryClient);

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      const messages = data!.pages[0].messages as unknown as { id: string; clientId?: string; sendStatus?: string }[];
      expect(messages).toHaveLength(2);
      // B reconciled to the real message.
      expect(messages.find((m) => m.id === 'real-b')).toMatchObject({ clientId: 'pending-b' });
      // A's failed bubble is untouched — still present, still 'failed'.
      expect(messages.find((m) => m.clientId === 'pending-a')).toMatchObject({
        id: 'pending-a',
        sendStatus: 'failed',
      });
    });

    it('resets the query to the live edge when the DETACHED user sends their own message', async () => {
      const queryClient = new QueryClient();
      const queryKey = channelMessagesQueryKey('ch-1');
      const detached: InfiniteData<PaginatedMessagesResponseDto> = {
        ...makeInfiniteData([makeMessage({ id: 'stale-1' })]),
        pageParams: ['cursor-uuid'],
      };

      queryClient.setQueryData(queryKey, detached);
      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
      queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
        { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
      ]);
      const resetSpy = vi.spyOn(queryClient, 'resetQueries');

      const newMsg = makeMessage({ id: 'new-1', channelId: 'ch-1', authorId: 'me' });
      await handleNewMessage({ message: newMsg as never }, queryClient);

      expect(resetSpy).toHaveBeenCalledWith({ queryKey, exact: true });

      // Own messages must not bump unread even on the detached reset path.
      const unread = queryClient.getQueryData<{ channelId: string; unreadCount: number }[]>(
        readReceiptsControllerGetUnreadCountsQueryKey(),
      );
      expect(unread![0].unreadCount).toBe(0);
    });

    describe('unread suppression for the actively-viewed context (transient badge flash)', () => {
      let hasFocusSpy: ReturnType<typeof vi.spyOn>;

      afterEach(() => {
        hasFocusSpy?.mockRestore();
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        window.history.pushState({}, '', '/');
        setActiveDmGroupId(null);
      });

      it('does not increment unread when the channel is actively viewed and the tab is focused', async () => {
        hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        window.history.pushState({}, '', '/community/c1/channel/ch-1');

        const queryClient = new QueryClient();
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
        ]);

        const newMsg = makeMessage({ id: 'new-1', channelId: 'ch-1', authorId: 'other' });
        await handleNewMessage({ message: newMsg as never }, queryClient);

        const unread = queryClient.getQueryData<{ channelId: string; unreadCount: number }[]>(
          readReceiptsControllerGetUnreadCountsQueryKey(),
        );
        expect(unread![0].unreadCount).toBe(0);
      });

      it('still increments unread for the active, focused channel when detached from the live edge (#404)', async () => {
        hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        window.history.pushState({}, '', '/community/c1/channel/ch-1');

        const queryClient = new QueryClient();
        const queryKey = channelMessagesQueryKey('ch-1');
        const detached: InfiniteData<PaginatedMessagesResponseDto> = {
          ...makeInfiniteData([makeMessage({ id: 'stale-1' })]),
          pageParams: ['cursor-uuid'],
        };
        queryClient.setQueryData(queryKey, detached);
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
        ]);

        const newMsg = makeMessage({ id: 'new-1', channelId: 'ch-1', authorId: 'other' });
        await handleNewMessage({ message: newMsg as never }, queryClient);

        // Detached: message not inserted and not visible, so the bump is the
        // only signal — suppression must not apply even though the channel is
        // actively viewed and focused.
        const unread = queryClient.getQueryData<{ channelId: string; unreadCount: number }[]>(
          readReceiptsControllerGetUnreadCountsQueryKey(),
        );
        expect(unread![0].unreadCount).toBe(1);
      });

      it('still increments unread for the active channel when the tab is blurred', async () => {
        hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
        window.history.pushState({}, '', '/community/c1/channel/ch-1');

        const queryClient = new QueryClient();
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
        ]);

        const newMsg = makeMessage({ id: 'new-1', channelId: 'ch-1', authorId: 'other' });
        await handleNewMessage({ message: newMsg as never }, queryClient);

        const unread = queryClient.getQueryData<{ channelId: string; unreadCount: number }[]>(
          readReceiptsControllerGetUnreadCountsQueryKey(),
        );
        expect(unread![0].unreadCount).toBe(1);
      });

      it('still increments unread when focused but viewing a different channel', async () => {
        hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        window.history.pushState({}, '', '/community/c1/channel/other-channel');

        const queryClient = new QueryClient();
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
        ]);

        const newMsg = makeMessage({ id: 'new-1', channelId: 'ch-1', authorId: 'other' });
        await handleNewMessage({ message: newMsg as never }, queryClient);

        const unread = queryClient.getQueryData<{ channelId: string; unreadCount: number }[]>(
          readReceiptsControllerGetUnreadCountsQueryKey(),
        );
        expect(unread![0].unreadCount).toBe(1);
      });

      it('does not increment unread when the DM is actively viewed and the tab is focused', async () => {
        hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        setActiveDmGroupId('dm-1');

        const queryClient = new QueryClient();
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { directMessageGroupId: 'dm-1', unreadCount: 0, mentionCount: 0 },
        ]);

        const newMsg = makeMessage({
          id: 'new-1',
          channelId: null,
          directMessageGroupId: 'dm-1',
          authorId: 'other',
        });
        await handleNewMessage({ message: newMsg as never }, queryClient);

        const unread = queryClient.getQueryData<{ directMessageGroupId: string; unreadCount: number }[]>(
          readReceiptsControllerGetUnreadCountsQueryKey(),
        );
        expect(unread![0].unreadCount).toBe(0);
      });

      it('still increments unread for a different DM group even when focused', async () => {
        hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        setActiveDmGroupId('dm-other');

        const queryClient = new QueryClient();
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { directMessageGroupId: 'dm-1', unreadCount: 0, mentionCount: 0 },
        ]);

        const newMsg = makeMessage({
          id: 'new-1',
          channelId: null,
          directMessageGroupId: 'dm-1',
          authorId: 'other',
        });
        await handleNewMessage({ message: newMsg as never }, queryClient);

        const unread = queryClient.getQueryData<{ directMessageGroupId: string; unreadCount: number }[]>(
          readReceiptsControllerGetUnreadCountsQueryKey(),
        );
        expect(unread![0].unreadCount).toBe(1);
      });

      it('still inserts the message into the message cache even when the unread bump is suppressed', async () => {
        hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          configurable: true,
        });
        window.history.pushState({}, '', '/community/c1/channel/ch-1');

        const queryClient = new QueryClient();
        const queryKey = channelMessagesQueryKey('ch-1');
        queryClient.setQueryData(queryKey, makeInfiniteData([]));
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { channelId: 'ch-1', unreadCount: 0, mentionCount: 0 },
        ]);

        const newMsg = makeMessage({ id: 'new-1', channelId: 'ch-1', authorId: 'other' });
        await handleNewMessage({ message: newMsg as never }, queryClient);

        const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
        expect(data!.pages[0].messages).toHaveLength(1);
        expect(data!.pages[0].messages[0].id).toBe('new-1');
      });
    });
  });

  describe('handleUpdateMessage', () => {
    it('updates an existing message in the cache', async () => {
      const queryClient = new QueryClient();
      const msg = makeMessage({ id: 'msg-1', content: 'old' });
      const queryKey = channelMessagesQueryKey('ch-1');

      queryClient.setQueryData(queryKey, makeInfiniteData([msg]));

      const updated = makeMessage({ id: 'msg-1', content: 'edited' });
      await handleUpdateMessage({ message: updated as never }, queryClient);

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      expect((data!.pages[0].messages[0] as unknown as { content: string }).content).toBe('edited');
    });
  });

  describe('handleDeleteMessage', () => {
    it('removes a message from the cache', async () => {
      const queryClient = new QueryClient();
      const msg = makeMessage({ id: 'msg-1' });
      const queryKey = channelMessagesQueryKey('ch-1');

      queryClient.setQueryData(queryKey, makeInfiniteData([msg]));

      await handleDeleteMessage(
        { messageId: 'msg-1', channelId: 'ch-1', directMessageGroupId: null },
        queryClient,
      );

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      expect(data!.pages[0].messages).toHaveLength(0);
    });
  });

  describe('handleMessageUnpinned', () => {
    it('clears pin fields with explicit nulls (matching server DTO shape)', async () => {
      const queryClient = new QueryClient();
      const msg = makeMessage({
        id: 'msg-1',
        pinned: true,
        pinnedBy: 'user-2',
        pinnedAt: '2024-01-02T00:00:00Z',
      });
      const queryKey = channelMessagesQueryKey('ch-1');

      queryClient.setQueryData(queryKey, makeInfiniteData([msg]));

      await handleMessageUnpinned({ messageId: 'msg-1', channelId: 'ch-1', unpinnedBy: 'user-2' }, queryClient);

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      const updated = data!.pages[0].messages[0];
      expect(updated.pinned).toBe(false);
      expect(updated.pinnedBy).toBeNull();
      expect(updated.pinnedAt).toBeNull();
    });
  });

  describe('handleThreadReplyCountUpdated', () => {
    it('preserves a null lastReplyAt instead of converting it to undefined', async () => {
      const queryClient = new QueryClient();
      const msg = makeMessage({ id: 'msg-1', replyCount: 1, lastReplyAt: '2024-01-02T00:00:00Z' });
      const queryKey = channelMessagesQueryKey('ch-1');

      queryClient.setQueryData(queryKey, makeInfiniteData([msg]));

      await handleThreadReplyCountUpdated(
        {
          parentMessageId: 'msg-1',
          replyCount: 0,
          lastReplyAt: null,
          channelId: 'ch-1',
          directMessageGroupId: null,
        },
        queryClient,
      );

      const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
      const updated = data!.pages[0].messages[0];
      expect(updated.replyCount).toBe(0);
      expect(updated.lastReplyAt).toBeNull();
    });
  });

  describe('handleReadReceiptUpdated', () => {
    it('resets unread count for the channel', () => {
      const queryClient = new QueryClient();
      const unreadKey = readReceiptsControllerGetUnreadCountsQueryKey();

      queryClient.setQueryData(unreadKey, [
        { channelId: 'ch-1', unreadCount: 5, mentionCount: 0 },
      ]);

      handleReadReceiptUpdated(
        {
          channelId: 'ch-1',
          directMessageGroupId: null,
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-01T00:00:00Z',
        } as Parameters<typeof handleReadReceiptUpdated>[0],
        queryClient,
      );

      const data = queryClient.getQueryData<{ channelId: string; unreadCount: number }[]>(unreadKey);
      expect(data![0].unreadCount).toBe(0);
    });

    it('upserts peer read in dm-peer-reads cache', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const peerReadsKey = readReceiptsControllerGetDmPeerReadsQueryKey({
        path: { directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(peerReadsKey, [] as DmPeerReadDto[]);

      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-15T00:00:00Z',
          userId: 'alice-id',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: 'https://example.com/alice.png',
        },
        queryClient,
      );

      const peerReads = queryClient.getQueryData<DmPeerReadDto[]>(peerReadsKey);
      expect(peerReads).toHaveLength(1);
      expect(peerReads![0].userId).toBe('alice-id');
      expect(peerReads![0].lastReadAt).toBe('2024-01-15T00:00:00Z');
    });

    it('updates existing peer entry instead of duplicating', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const peerReadsKey = readReceiptsControllerGetDmPeerReadsQueryKey({
        path: { directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(peerReadsKey, [
        { userId: 'alice-id', lastReadAt: '2024-01-10T00:00:00Z' },
      ] as DmPeerReadDto[]);

      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-10',
          lastReadAt: '2024-01-20T00:00:00Z',
          userId: 'alice-id',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
        },
        queryClient,
      );

      const peerReads = queryClient.getQueryData<DmPeerReadDto[]>(peerReadsKey);
      expect(peerReads).toHaveLength(1);
      expect(peerReads![0].lastReadAt).toBe('2024-01-20T00:00:00Z');
    });

    it('does not update peer reads in a different DM group', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const otherDmKey = readReceiptsControllerGetDmPeerReadsQueryKey({
        path: { directMessageGroupId: 'dm-2' },
      });
      queryClient.setQueryData(otherDmKey, [] as DmPeerReadDto[]);

      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-01T00:00:00Z',
          userId: 'alice-id',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
        },
        queryClient,
      );

      const peerReads = queryClient.getQueryData<DmPeerReadDto[]>(otherDmKey);
      expect(peerReads).toHaveLength(0);
    });

    it('initializes peer reads cache when it does not exist yet', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      // Do NOT seed the peer reads cache — simulates WS event before REST fetch
      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-15T00:00:00Z',
          userId: 'alice-id',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
        },
        queryClient,
      );

      const peerReadsKey = readReceiptsControllerGetDmPeerReadsQueryKey({
        path: { directMessageGroupId: 'dm-1' },
      });
      const peerReads = queryClient.getQueryData<DmPeerReadDto[]>(peerReadsKey);
      expect(peerReads).toHaveLength(1);
      expect(peerReads![0].userId).toBe('alice-id');
    });

    it('skips self-reads (does not update peer reads for current user)', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const peerReadsKey = readReceiptsControllerGetDmPeerReadsQueryKey({
        path: { directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(peerReadsKey, [] as DmPeerReadDto[]);

      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-01T00:00:00Z',
          userId: 'current-user',
          username: 'me',
          displayName: 'Me',
          avatarUrl: null,
        },
        queryClient,
      );

      const peerReads = queryClient.getQueryData<DmPeerReadDto[]>(peerReadsKey);
      expect(peerReads).toHaveLength(0);
    });

    it('does not update peer reads cache when payload lacks userId', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const peerReadsKey = readReceiptsControllerGetDmPeerReadsQueryKey({
        path: { directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(peerReadsKey, [] as DmPeerReadDto[]);

      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-01T00:00:00Z',
        },
        queryClient,
      );

      const peerReads = queryClient.getQueryData<DmPeerReadDto[]>(peerReadsKey);
      expect(peerReads).toHaveLength(0);
    });

    describe('Bug-A regression matrix: cross-user DM badge clearing', () => {
      function seedForCurrentUser(queryClient: QueryClient) {
        queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'user-a' });
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { directMessageGroupId: 'g1', unreadCount: 3, mentionCount: 1, communityId: 'c1' },
        ]);
      }

      function getUnreadEntry(queryClient: QueryClient) {
        const data = queryClient.getQueryData<
          { directMessageGroupId: string; unreadCount: number; mentionCount: number; communityId?: string }[]
        >(readReceiptsControllerGetUnreadCountsQueryKey());
        return data![0];
      }

      it('userId belongs to a DM peer: own unread counts are unchanged, but peer-reads cache is updated', () => {
        const queryClient = new QueryClient();
        seedForCurrentUser(queryClient);
        const peerReadsKey = readReceiptsControllerGetDmPeerReadsQueryKey({
          path: { directMessageGroupId: 'g1' },
        });
        queryClient.setQueryData(peerReadsKey, [] as DmPeerReadDto[]);

        handleReadReceiptUpdated(
          {
            channelId: null,
            directMessageGroupId: 'g1',
            lastReadMessageId: 'msg-5',
            lastReadAt: '2024-01-01T00:00:00Z',
            userId: 'user-b',
          },
          queryClient,
        );

        const entry = getUnreadEntry(queryClient);
        expect(entry.unreadCount).toBe(3);
        expect(entry.mentionCount).toBe(1);

        const peerReads = queryClient.getQueryData<DmPeerReadDto[]>(peerReadsKey);
        expect(peerReads).toHaveLength(1);
        expect(peerReads![0].userId).toBe('user-b');
      });

      it('userId matches the current user (self-sync-with-userId variant): counts are zeroed', () => {
        const queryClient = new QueryClient();
        seedForCurrentUser(queryClient);

        handleReadReceiptUpdated(
          {
            channelId: null,
            directMessageGroupId: 'g1',
            lastReadMessageId: 'msg-5',
            lastReadAt: '2024-01-01T00:00:00Z',
            userId: 'user-a',
          },
          queryClient,
        );

        const entry = getUnreadEntry(queryClient);
        expect(entry.unreadCount).toBe(0);
        expect(entry.mentionCount).toBe(0);
      });

      it('no userId (self-sync): counts are zeroed', () => {
        const queryClient = new QueryClient();
        seedForCurrentUser(queryClient);

        handleReadReceiptUpdated(
          {
            channelId: null,
            directMessageGroupId: 'g1',
            lastReadMessageId: 'msg-5',
            lastReadAt: '2024-01-01T00:00:00Z',
          },
          queryClient,
        );

        const entry = getUnreadEntry(queryClient);
        expect(entry.unreadCount).toBe(0);
        expect(entry.mentionCount).toBe(0);
      });

      it('userId present but no profile cached yet: skips zeroing (safe — self-sync copy will still clear)', () => {
        const queryClient = new QueryClient();
        // No profile seeded.
        queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), [
          { directMessageGroupId: 'g1', unreadCount: 3, mentionCount: 1, communityId: 'c1' },
        ]);

        handleReadReceiptUpdated(
          {
            channelId: null,
            directMessageGroupId: 'g1',
            lastReadMessageId: 'msg-5',
            lastReadAt: '2024-01-01T00:00:00Z',
            userId: 'user-b',
          },
          queryClient,
        );

        const entry = getUnreadEntry(queryClient);
        expect(entry.unreadCount).toBe(3);
        expect(entry.mentionCount).toBe(1);
      });

      it('zeroing preserves extra fields (e.g. communityId) already present on the entry', () => {
        const queryClient = new QueryClient();
        seedForCurrentUser(queryClient);

        handleReadReceiptUpdated(
          {
            channelId: null,
            directMessageGroupId: 'g1',
            lastReadMessageId: 'msg-5',
            lastReadAt: '2024-01-01T00:00:00Z',
          },
          queryClient,
        );

        const entry = getUnreadEntry(queryClient);
        expect(entry.unreadCount).toBe(0);
        expect(entry.mentionCount).toBe(0);
        expect(entry.communityId).toBe('c1');
      });
    });
  });
});
