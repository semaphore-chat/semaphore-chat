import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { PaginatedMessagesResponseDto } from '../../../api-client/types.gen';
import {
  handleNewMessage,
  handleUpdateMessage,
  handleDeleteMessage,
  handleReadReceiptUpdated,
} from '../../../socket-hub/handlers/messageHandlers';
import { channelMessagesQueryKey } from '../../../utils/messageQueryKeys';
import {
  readReceiptsControllerGetUnreadCountsQueryKey,
  readReceiptsControllerGetMessageReadersQueryKey,
  userControllerGetProfileQueryKey,
} from '../../../api-client/@tanstack/react-query.gen';
import type { MessageReader } from '../../../types/read-receipt.type';

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

    it('adds reader to cached message readers queries for messages <= lastReadMessageId', () => {
      const queryClient = new QueryClient();

      // Seed current user (different from the reader)
      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      // Seed a cached readers query for msg-2 (before lastReadMessageId msg-5)
      const readersKey = readReceiptsControllerGetMessageReadersQueryKey({
        path: { messageId: 'msg-2' },
        query: { channelId: '', directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(readersKey, [] as MessageReader[]);

      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-01T00:00:00Z',
          userId: 'alice-id',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: 'https://example.com/alice.png',
        },
        queryClient,
      );

      const readers = queryClient.getQueryData<MessageReader[]>(readersKey);
      expect(readers).toHaveLength(1);
      expect(readers![0].userId).toBe('alice-id');
      expect(readers![0].username).toBe('alice');
      expect(readers![0].displayName).toBe('Alice');
      expect(readers![0].avatarUrl).toBe('https://example.com/alice.png');
    });

    it('does not add reader for messages after lastReadMessageId', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      // Seed a cached readers query for msg-9 (after lastReadMessageId msg-5)
      const readersKey = readReceiptsControllerGetMessageReadersQueryKey({
        path: { messageId: 'msg-9' },
        query: { channelId: '', directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(readersKey, [] as MessageReader[]);

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

      const readers = queryClient.getQueryData<MessageReader[]>(readersKey);
      expect(readers).toHaveLength(0);
    });

    it('skips self-reads (does not add current user to readers)', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const readersKey = readReceiptsControllerGetMessageReadersQueryKey({
        path: { messageId: 'msg-2' },
        query: { channelId: '', directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(readersKey, [] as MessageReader[]);

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

      const readers = queryClient.getQueryData<MessageReader[]>(readersKey);
      expect(readers).toHaveLength(0);
    });

    it('does not duplicate reader if already in cached readers', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const existingReader: MessageReader = {
        userId: 'alice-id',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: undefined,
        readAt: new Date(),
      };

      const readersKey = readReceiptsControllerGetMessageReadersQueryKey({
        path: { messageId: 'msg-2' },
        query: { channelId: '', directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(readersKey, [existingReader]);

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

      const readers = queryClient.getQueryData<MessageReader[]>(readersKey);
      expect(readers).toHaveLength(1);
    });

    it('does not update readers cache when payload lacks userId (self-sync event)', () => {
      const queryClient = new QueryClient();

      queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'current-user' });

      const readersKey = readReceiptsControllerGetMessageReadersQueryKey({
        path: { messageId: 'msg-2' },
        query: { channelId: '', directMessageGroupId: 'dm-1' },
      });
      queryClient.setQueryData(readersKey, [] as MessageReader[]);

      handleReadReceiptUpdated(
        {
          channelId: null,
          directMessageGroupId: 'dm-1',
          lastReadMessageId: 'msg-5',
          lastReadAt: '2024-01-01T00:00:00Z',
          // No userId/username — this is a user-room self-sync event
        },
        queryClient,
      );

      const readers = queryClient.getQueryData<MessageReader[]>(readersKey);
      expect(readers).toHaveLength(0);
    });
  });
});
