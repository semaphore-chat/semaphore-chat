import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClientProvider, type InfiniteData } from '@tanstack/react-query';

// Mock the generated client (same pattern as useSendMessage.test.ts)
vi.mock('../../api-client/client.gen', () => ({
  client: {
    getConfig: () => ({ baseUrl: 'http://localhost:3000' }),
  },
}));

import { useMessageFileUpload } from '../../hooks/useMessageFileUpload';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { NotificationProvider } from '../../contexts/NotificationContext';
import { channelMessagesQueryKey, dmMessagesQueryKey } from '../../utils/messageQueryKeys';
import { getPendingUpload, resetPendingUploadsForTests } from '../../utils/pendingUploadStore';
import { resetAttachmentSendsForTests } from '../../utils/attachmentSend';
import { userControllerGetProfileQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { PaginatedMessagesResponseDto } from '../../api-client';
import {
  createTestQueryClient,
  createMockSocket,
  createInfiniteData,
} from '../test-utils';
import type { MockSocket } from '../test-utils';
import type { Message } from '../../types/message.type';
import { SocketContext } from '../../utils/SocketContext';

let queryClient: ReturnType<typeof createTestQueryClient>;
let mockSocket: MockSocket;

const queryKey = channelMessagesQueryKey('ch-1');

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(
      SocketContext.Provider,
      { value: { socket: mockSocket as never, isConnected: true } },
      React.createElement(NotificationProvider, null, children),
    ),
  );
}

function cacheMessages(): Message[] {
  const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
  return (data?.pages.flatMap(p => p.messages) ?? []) as unknown as Message[];
}

beforeEach(() => {
  queryClient = createTestQueryClient();
  mockSocket = createMockSocket();
  queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'me' });
  queryClient.setQueryData(queryKey, createInfiniteData([]));
});

afterEach(() => {
  resetAttachmentSendsForTests();
  resetPendingUploadsForTests();
});

describe('useMessageFileUpload — optimistic rows', () => {
  it('inserts an optimistic pending row for a plain (no-attachment) send', async () => {
    mockSocket.emit.mockImplementation(() => {
      /* never acks — just checking the synchronous insert */
    });

    const { result } = renderHook(
      () => useMessageFileUpload({ contextType: VoiceSessionType.Channel, contextId: 'ch-1', authorId: 'me' }),
      { wrapper },
    );

    act(() => {
      void result.current.handleSendMessage('hello', [{ type: 'PLAINTEXT' as never, text: 'hello' }]);
    });

    const messages = cacheMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].sendStatus).toBe('pending');
  });

  it('inserts an optimistic pending row for a send with attachments, with its files waiting', async () => {
    mockSocket.emit.mockImplementation(() => {
      /* never acks — checking the synchronous insert */
    });

    const { result } = renderHook(
      () => useMessageFileUpload({ contextType: VoiceSessionType.Channel, contextId: 'ch-1', authorId: 'me' }),
      { wrapper },
    );

    const file = new File(['data'], 'photo.png', { type: 'image/png' });

    act(() => {
      void result.current.handleSendMessage('hello', [{ type: 'PLAINTEXT' as never, text: 'hello' }], [file]);
    });

    const messages = cacheMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].sendStatus).toBe('pending');
    expect(messages[0].pendingAttachments).toBe(1);
    expect(getPendingUpload(messages[0].clientId)?.files.map((f) => [f.name, f.status])).toEqual([['photo.png', 'waiting']]);
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({ channelId: 'ch-1', pendingAttachments: 1, attachments: [] }),
      expect.any(Function),
    );
  });

  it('does the same in a DM', async () => {
    mockSocket.emit.mockImplementation(() => {});
    queryClient.setQueryData(dmMessagesQueryKey('dm-1'), createInfiniteData([]));

    const { result } = renderHook(
      () => useMessageFileUpload({ contextType: VoiceSessionType.Dm, contextId: 'dm-1', authorId: 'me' }),
      { wrapper },
    );

    act(() => {
      void result.current.handleSendMessage('', [{ type: 'PLAINTEXT' as never, text: '' }], [new File(['x'], 'a.pdf', { type: 'application/pdf' })]);
    });

    const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(dmMessagesQueryKey('dm-1'));
    const [row] = (data?.pages.flatMap((p) => p.messages) ?? []) as unknown as Message[];
    expect(row).toMatchObject({ directMessageGroupId: 'dm-1', sendStatus: 'pending', pendingAttachments: 1 });
    expect(mockSocket.emit).toHaveBeenCalledWith('sendDirectMessage', expect.anything(), expect.any(Function));
  });
});
