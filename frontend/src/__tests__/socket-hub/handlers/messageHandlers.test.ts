import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { PaginatedMessagesResponseDto, DmPeerReadDto } from '../../../api-client/types.gen';
import {
  handleNewMessage,
  handleUpdateMessage,
  handleDeleteMessage,
  handleReadReceiptUpdated,
} from '../../../socket-hub/handlers/messageHandlers';
import { channelMessagesQueryKey } from '../../../utils/messageQueryKeys';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  readReceiptsControllerGetDmPeerReadsQueryKey,
  userControllerGetProfileQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';

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
    pages: [{ messages: messages as never[], continuationToken: null }],
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
  });
});
