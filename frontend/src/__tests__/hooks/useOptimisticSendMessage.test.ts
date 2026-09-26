import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { InfiniteData } from '@tanstack/react-query';

// Mock the generated client (same pattern as useSendMessage.test.ts)
vi.mock('../../api-client/client.gen', () => ({
  client: {
    getConfig: () => ({ baseUrl: 'http://localhost:3000' }),
  },
}));

// Uploads never really run here: a pending promise stands in for each.
const uploadFileWithProgress = vi.fn((..._args: unknown[]) => new Promise(() => {}));
vi.mock('../../utils/uploadFileWithProgress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/uploadFileWithProgress')>()),
  uploadFileWithProgress: (...args: unknown[]) => uploadFileWithProgress(...args),
}));

import {
  useOptimisticSendMessage,
  useOptimisticMessageRetry,
} from '../../hooks/useOptimisticSendMessage';
import { sendMessageWithAttachments, resetAttachmentSendsForTests } from '../../utils/attachmentSend';
import { getPendingUpload, resetPendingUploadsForTests } from '../../utils/pendingUploadStore';
import { handleNewMessage } from '../../socket-hub/handlers/messageHandlers';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { channelMessagesQueryKey, channelAnchoredMessagesQueryKey } from '../../utils/messageQueryKeys';
import { userControllerGetProfileQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { PaginatedMessagesResponseDto } from '../../api-client';
import {
  createTestQueryClient,
  createMockSocket,
  createTestWrapper,
  createMessage,
  createInfiniteData,
} from '../test-utils';
import type { MockSocket } from '../test-utils';
import type { Message } from '../../types/message.type';
import type { NewMessagePayload, SendMessageResult } from '../../hooks/useSendMessage';

let queryClient: ReturnType<typeof createTestQueryClient>;
let mockSocket: MockSocket;

const queryKey = channelMessagesQueryKey('ch-1');

function seedCurrentUser() {
  queryClient.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'me' });
}

function cacheMessages(): Message[] {
  const data = queryClient.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
  return (data?.pages.flatMap(p => p.messages) ?? []) as unknown as Message[];
}

function payload(): NewMessagePayload {
  return {
    channelId: 'ch-1',
    authorId: 'me',
    spans: [{ type: 'PLAINTEXT' as never, text: 'hello' }],
    attachments: [],
    reactions: [],
    sentAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  queryClient = createTestQueryClient();
  mockSocket = createMockSocket();
  seedCurrentUser();
  // Live-edge, empty channel cache (pageParams: [undefined] === live per isDetachedFromLiveEdge).
  queryClient.setQueryData(queryKey, createInfiniteData([]));
});

describe('useOptimisticSendMessage', () => {
  describe('optimistic insert', () => {
    it('inserts a pending row immediately, before the send settles', () => {
      mockSocket.emit.mockImplementation(() => {
        /* never acks — just checking the synchronous insert */
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      act(() => {
        void result.current.sendMessage(payload());
      });

      const messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].sendStatus).toBe('pending');
      expect(messages[0].id).toMatch(/^pending-/);
      expect(messages[0].clientId).toBe(messages[0].id);
    });

    it('never includes sendStatus/clientId in the emitted socket payload', () => {
      let emittedPayload: Record<string, unknown> | undefined;
      mockSocket.emit.mockImplementation((_event, p) => {
        emittedPayload = p as Record<string, unknown>;
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      act(() => {
        void result.current.sendMessage(payload());
      });

      expect(emittedPayload).toBeDefined();
      expect(emittedPayload).not.toHaveProperty('sendStatus');
      expect(emittedPayload).not.toHaveProperty('clientId');
      expect(emittedPayload).not.toHaveProperty('id');
    });
  });

  describe('reconciliation races (both orders)', () => {
    it('ack-first: ack settles before the WS echo arrives', async () => {
      let ack: ((id: string) => void) | undefined;
      mockSocket.emit.mockImplementation((_event, _p, ackFn) => {
        ack = ackFn as (id: string) => void;
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let sendPromise!: Promise<SendMessageResult>;
      act(() => {
        sendPromise = result.current.sendMessage(payload());
      });

      // Step 1: optimistic row present, exactly one instance.
      expect(cacheMessages()).toHaveLength(1);
      expect(cacheMessages()[0].sendStatus).toBe('pending');

      // Step 2: ack arrives first — promotes the optimistic row in place.
      await act(async () => {
        ack!('real-1');
        await sendPromise;
      });
      let messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
      expect(messages[0].sendStatus).toBeUndefined();

      // Step 3: WS echo arrives after — id already present, so it MERGES into
      // the promoted row (id match) rather than duplicating it.
      await act(async () => {
        await handleNewMessage(
          {
            message: createMessage({
              id: 'real-1',
              channelId: 'ch-1',
              authorId: 'me',
              spans: payload().spans,
            }) as never,
          },
          queryClient,
        );
      });
      messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
    });

    it('echo-first: the WS echo arrives before the ack settles', async () => {
      let ack: ((id: string) => void) | undefined;
      mockSocket.emit.mockImplementation((_event, _p, ackFn) => {
        ack = ackFn as (id: string) => void;
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let sendPromise!: Promise<SendMessageResult>;
      act(() => {
        sendPromise = result.current.sendMessage(payload());
      });

      // Step 1: optimistic row present, exactly one instance.
      expect(cacheMessages()).toHaveLength(1);
      expect(cacheMessages()[0].sendStatus).toBe('pending');

      // Step 2: WS echo arrives first — reconciles the optimistic row in place
      // (content-matches the pending row's spans, per the correlation rule).
      await act(async () => {
        await handleNewMessage(
          {
            message: createMessage({
              id: 'real-1',
              channelId: 'ch-1',
              authorId: 'me',
              spans: payload().spans,
            }) as never,
          },
          queryClient,
        );
      });
      let messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
      expect(messages[0].sendStatus).toBeUndefined();

      // Step 3: ack arrives after — must be a no-op (its clientId is already gone).
      await act(async () => {
        ack!('real-1');
        await sendPromise;
      });
      messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
    });

    it('both orders converge to the identical final cache state', async () => {
      const runOrder = async (order: 'ack-first' | 'echo-first') => {
        const qc = createTestQueryClient();
        qc.setQueryData(userControllerGetProfileQueryKey(), { id: 'me', username: 'me' });
        qc.setQueryData(queryKey, createInfiniteData([]));
        const socket = createMockSocket();
        let ack: ((id: string) => void) | undefined;
        socket.emit.mockImplementation((_event, _p, ackFn) => {
          ack = ackFn as (id: string) => void;
        });
        const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
          wrapper: createTestWrapper({ queryClient: qc, socket }),
        });

        let sendPromise!: Promise<SendMessageResult>;
        act(() => {
          sendPromise = result.current.sendMessage(payload());
        });

        const echo = () =>
          handleNewMessage(
            {
              message: createMessage({
                id: 'real-1',
                channelId: 'ch-1',
                authorId: 'me',
                spans: payload().spans,
              }) as never,
            },
            qc,
          );

        if (order === 'ack-first') {
          await act(async () => {
            ack!('real-1');
            await sendPromise;
          });
          await act(async () => {
            await echo();
          });
        } else {
          await act(async () => {
            await echo();
          });
          await act(async () => {
            ack!('real-1');
            await sendPromise;
          });
        }

        const data = qc.getQueryData<InfiniteData<PaginatedMessagesResponseDto>>(queryKey);
        return data?.pages.flatMap(p => p.messages) as unknown as Message[];
      };

      const ackFirstResult = await runOrder('ack-first');
      const echoFirstResult = await runOrder('echo-first');

      expect(ackFirstResult).toHaveLength(1);
      expect(echoFirstResult).toHaveLength(1);
      expect(ackFirstResult[0].id).toBe(echoFirstResult[0].id);
      expect(ackFirstResult[0].sendStatus).toBeUndefined();
      expect(echoFirstResult[0].sendStatus).toBeUndefined();
    });

    it('ack-first enrichment (fix round 1, Important 2): a later echo with resolved replyTo MERGES into the row instead of being dropped', async () => {
      let ack: ((id: string) => void) | undefined;
      mockSocket.emit.mockImplementation((_event, _p, ackFn) => {
        ack = ackFn as (id: string) => void;
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let sendPromise!: Promise<SendMessageResult>;
      act(() => {
        sendPromise = result.current.sendMessage(payload());
      });

      // Ack-first: promotes the row to the real id using only locally-known content.
      await act(async () => {
        ack!('real-1');
        await sendPromise;
      });
      let messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
      expect((messages[0] as unknown as { replyTo?: unknown }).replyTo).toBeUndefined();

      // The echo arrives after, carrying richer, server-resolved content
      // that the ack alone never had (e.g. a resolved replyTo object).
      await act(async () => {
        await handleNewMessage(
          {
            message: createMessage({
              id: 'real-1',
              channelId: 'ch-1',
              authorId: 'me',
              spans: payload().spans,
              replyToId: 'parent-1',
              replyTo: { id: 'parent-1', authorId: 'other', spans: [], deletedAt: null } as never,
            }) as never,
          },
          queryClient,
        );
      });

      messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
      // The enrichment landed — it's no longer discarded as a no-op dedupe.
      expect((messages[0] as unknown as { replyTo?: { id: string } }).replyTo).toMatchObject({ id: 'parent-1' });
    });
  });

  describe('concurrency guard (fix round 1, Important 3)', () => {
    it('a second concurrent retry for the same clientId no-ops instead of firing a duplicate send', async () => {
      const failed = createMessage({
        id: 'pending-xyz',
        clientId: 'pending-xyz',
        sendStatus: 'failed',
        channelId: 'ch-1',
        authorId: 'me',
      });
      queryClient.setQueryData(queryKey, createInfiniteData([failed]));

      let resolveAck: ((id: string) => void) | undefined;
      const ackPromise = new Promise<string>((resolve) => {
        resolveAck = resolve;
      });
      mockSocket.emit.mockImplementation((_event, _p, ackFn) => {
        void ackPromise.then((id) => (ackFn as (id: string) => void)(id));
      });

      const { result } = renderHook(() => useOptimisticMessageRetry(failed), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let firstRetry!: Promise<void>;
      let secondRetry!: Promise<void>;
      act(() => {
        firstRetry = result.current.retry();
        secondRetry = result.current.retry();
      });

      await act(async () => {
        resolveAck!('real-1');
        await Promise.all([firstRetry, secondRetry]);
      });

      // Only one socket.emit — the second concurrent retry() call was a no-op.
      expect(mockSocket.emit).toHaveBeenCalledTimes(1);
      const messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
    });
  });

  describe('timeout -> failed -> retry -> success', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('marks the row failed after the 10s send timeout, then retry (same clientId) succeeds', async () => {
      mockSocket.emit.mockImplementation(() => {
        /* never acks — triggers useSendMessage's 10s timeout */
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let sendPromise!: Promise<SendMessageResult>;
      act(() => {
        sendPromise = result.current.sendMessage(payload());
      });

      const clientId = cacheMessages()[0].clientId!;

      await act(async () => {
        vi.advanceTimersByTime(10000);
        await sendPromise;
      });

      let messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].sendStatus).toBe('failed');
      expect(messages[0].clientId).toBe(clientId);

      // Retry — same clientId, no duplicate row, and this time it acks.
      let retryAck: ((id: string) => void) | undefined;
      mockSocket.emit.mockImplementation((_event, _p, ackFn) => {
        retryAck = ackFn as (id: string) => void;
      });

      const failedMessage = messages[0];
      const { result: retryResult } = renderHook(() => useOptimisticMessageRetry(failedMessage), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let retryPromise!: Promise<void>;
      act(() => {
        retryPromise = retryResult.current.retry();
      });

      // Immediately reset to pending, same clientId, still one row.
      messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].sendStatus).toBe('pending');
      expect(messages[0].clientId).toBe(clientId);

      await act(async () => {
        retryAck!('real-1');
        await retryPromise;
      });

      messages = cacheMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('real-1');
      expect(messages[0].sendStatus).toBeUndefined();
    });
  });

  describe('failed -> delete', () => {
    it('removes the failed row entirely, no API call needed', () => {
      const failed = createMessage({
        id: 'pending-xyz',
        clientId: 'pending-xyz',
        sendStatus: 'failed',
        channelId: 'ch-1',
        authorId: 'me',
      });
      queryClient.setQueryData(queryKey, createInfiniteData([failed]));

      const { result } = renderHook(() => useOptimisticMessageRetry(failed), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      act(() => {
        result.current.remove();
      });

      expect(cacheMessages()).toHaveLength(0);
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('scope guard: anchored mode', () => {
    it('never writes to the anchored query key — it only ever targets the normal-mode key', async () => {
      const anchorKey = channelAnchoredMessagesQueryKey('ch-1', 'anchor-msg-1');
      const anchoredData = createInfiniteData([createMessage({ id: 'anchor-msg-1' })]);
      queryClient.setQueryData(anchorKey, anchoredData);

      let ack: ((id: string) => void) | undefined;
      mockSocket.emit.mockImplementation((_event, _p, ackFn) => {
        ack = ackFn as (id: string) => void;
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let sendPromise!: Promise<SendMessageResult>;
      act(() => {
        sendPromise = result.current.sendMessage(payload());
      });

      // The anchored cache (a completely separate query key while the UI is
      // showing a jump-to-message view) is untouched by the optimistic
      // insert — this hook only ever writes to the normal-mode key.
      expect(queryClient.getQueryData(anchorKey)).toBe(anchoredData);
      // The normal-mode window (still at the live edge underneath the
      // anchored view) does get the optimistic row.
      expect(cacheMessages()).toHaveLength(1);

      await act(async () => {
        ack!('real-1');
        await sendPromise;
      });
      expect(queryClient.getQueryData(anchorKey)).toBe(anchoredData);
    });
  });

  describe('scope guard: detached from the live edge', () => {
    it('does not insert an optimistic row when the window is detached', async () => {
      const existing = createMessage({ id: 'stale-1', channelId: 'ch-1' });
      queryClient.setQueryData(queryKey, { ...createInfiniteData([existing]), pageParams: ['cursor-uuid'] });

      let ack: ((id: string) => void) | undefined;
      mockSocket.emit.mockImplementation((_event, _p, ackFn) => {
        ack = ackFn as (id: string) => void;
      });
      const { result } = renderHook(() => useOptimisticSendMessage(VoiceSessionType.Channel, 'ch-1'), {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      });

      let sendPromise!: Promise<SendMessageResult>;
      act(() => {
        sendPromise = result.current.sendMessage(payload());
      });

      // No optimistic row was inserted — cache untouched by this hook.
      expect(cacheMessages()).toHaveLength(1);
      expect(cacheMessages()[0].id).toBe('stale-1');

      // The underlying send still happens normally (just no optimistic UI).
      await act(async () => {
        ack!('real-1');
        await sendPromise;
      });
      expect(mockSocket.emit).toHaveBeenCalled();
      // Still untouched — this hook never wrote to a detached window at all;
      // the real echo-driven reset (#416) is handled elsewhere.
      expect(cacheMessages()).toHaveLength(1);
      expect(cacheMessages()[0].id).toBe('stale-1');
    });
  });
});

describe('a failed send with attachments', () => {
  afterEach(() => {
    resetAttachmentSendsForTests();
    resetPendingUploadsForTests();
    uploadFileWithProgress.mockClear();
  });

  async function failedAttachmentRow(): Promise<Message> {
    await sendMessageWithAttachments({
      runtime: { queryClient, contextType: VoiceSessionType.Channel, contextId: 'ch-1' },
      payload: payload(),
      files: [new File(['a'], 'a.pdf', { type: 'application/pdf' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })],
      send: async () => ({ success: false, error: new Error('timed out') }),
    });
    const [row] = cacheMessages();
    expect(row.sendStatus).toBe('failed');
    return row;
  }

  it('Retry resends with the files still to upload, then uploads them to the new message', async () => {
    const failed = await failedAttachmentRow();
    let emitted: Record<string, unknown> | undefined;
    mockSocket.emit.mockImplementation((_event, p, ackFn) => {
      emitted = p as Record<string, unknown>;
      (ackFn as (id: string) => void)('real-1');
    });
    const { result } = renderHook(() => useOptimisticMessageRetry(failed), {
      wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
    });

    await act(async () => {
      await result.current.retry();
    });

    expect(emitted).toMatchObject({ pendingAttachments: 2, attachments: [] });
    expect(cacheMessages()[0]).toMatchObject({ id: 'real-1', clientId: failed.clientId });
    expect(uploadFileWithProgress).toHaveBeenCalledTimes(2);
    expect(uploadFileWithProgress.mock.calls[0][1]).toMatchObject({ resourceId: 'real-1' });
    expect(getPendingUpload('real-1')?.files.map((f) => f.status)).toEqual(['uploading', 'uploading']);
  });

  it('Delete drops the row and its files', async () => {
    const failed = await failedAttachmentRow();
    const { result } = renderHook(() => useOptimisticMessageRetry(failed), {
      wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
    });
    act(() => {
      result.current.remove();
    });
    expect(cacheMessages()).toHaveLength(0);
    expect(getPendingUpload(failed.clientId)).toBeUndefined();
    expect(uploadFileWithProgress).not.toHaveBeenCalled();
  });

  it('a text-only retry announces no files', async () => {
    const failed = createMessage({ id: 'pending-t', clientId: 'pending-t', sendStatus: 'failed', channelId: 'ch-1', authorId: 'me' });
    queryClient.setQueryData(queryKey, createInfiniteData([failed]));
    let emitted: Record<string, unknown> | undefined;
    mockSocket.emit.mockImplementation((_event, p, ackFn) => {
      emitted = p as Record<string, unknown>;
      (ackFn as (id: string) => void)('real-t');
    });
    const { result } = renderHook(() => useOptimisticMessageRetry(failed), {
      wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(emitted).toMatchObject({ pendingAttachments: 0 });
    expect(uploadFileWithProgress).not.toHaveBeenCalled();
  });
});
