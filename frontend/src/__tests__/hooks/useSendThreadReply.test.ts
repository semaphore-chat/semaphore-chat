import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ClientEvents, ErrorCode } from '@semaphore-chat/shared';

vi.mock('../../api-client/client.gen', () => ({
  client: { getConfig: () => ({ baseUrl: 'http://localhost:3000' }) },
}));

import { useSendThreadReply } from '../../hooks/useSendThreadReply';
import { SEND_ACK_TIMEOUT_MS } from '../../utils/sendAck';
import { SpanType } from '../../types/message.type';
import { createTestQueryClient, createMockSocket, createTestWrapper } from '../test-utils';
import type { MockSocket } from '../test-utils';

let socket: MockSocket;
const acks: unknown[] = [];
const spans = [{ type: SpanType.PLAINTEXT, text: 'hello' }];

function render() {
  return renderHook(() => useSendThreadReply('parent-1'), {
    wrapper: createTestWrapper({ queryClient: createTestQueryClient(), socket, isConnected: true }),
  });
}

beforeEach(() => {
  acks.length = 0;
  socket = createMockSocket();
  socket.connected = true;
  socket.emit.mockImplementation((_event: string, ...args: unknown[]) => {
    const ack = args[1] as ((answer: unknown) => void) | undefined;
    if (acks.length > 0) ack?.(acks.shift());
  });
});

afterEach(() => vi.useRealTimers());

describe('useSendThreadReply', () => {
  it('emits SEND_THREAD_REPLY with the parent, the spans, pending files and a nonce; an ack clears', async () => {
    acks.push({ ok: true, messageId: 'reply-1' });
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.sendReply>> = null;
    await act(async () => {
      outcome = await result.current.sendReply({ content: 'hello', spans, pendingAttachments: 2 });
    });
    expect(outcome).toEqual({ clear: true, messageId: 'reply-1' });
    expect(socket.emit).toHaveBeenCalledWith(
      ClientEvents.SEND_THREAD_REPLY,
      expect.objectContaining({ parentMessageId: 'parent-1', spans, attachments: [], pendingAttachments: 2, clientNonce: expect.any(String) }),
      expect.any(Function),
    );
  });

  it('a refused send keeps the text and says why; the same text reuses its nonce, new text gets a new one', async () => {
    const refused = { ok: false, error: { errorCode: ErrorCode.SLOWMODE, message: 'Slowmode is on', retryable: true } };
    acks.push(refused, refused, refused);
    const { result } = render();
    const outcomes: unknown[] = [];
    await act(async () => {
      outcomes.push(await result.current.sendReply({ content: 'hello', spans }));
      outcomes.push(await result.current.sendReply({ content: 'hello', spans }));
      outcomes.push(await result.current.sendReply({ content: 'hello there', spans }));
    });
    expect(outcomes[0]).toEqual({ clear: false, error: 'Slowmode is on' });
    const nonces = socket.emit.mock.calls.map((call) => (call[1] as { clientNonce: string }).clientNonce);
    expect(nonces[1]).toBe(nonces[0]);
    expect(nonces[2]).not.toBe(nonces[0]);
  });

  it('a reply deleted while sending clears and says so', async () => {
    acks.push({ ok: false, error: { errorCode: ErrorCode.MESSAGE_DELETED, message: 'Gone', retryable: false } });
    const { result } = render();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.sendReply({ content: 'hello', spans });
    });
    expect(outcome).toEqual({ clear: true, error: 'That reply was deleted' });
  });

  it('no answer within the time-out is a failure that keeps the text', async () => {
    vi.useFakeTimers();
    const { result } = render();
    let outcome: unknown;
    await act(async () => {
      const pending = result.current.sendReply({ content: 'hello', spans });
      await vi.advanceTimersByTimeAsync(SEND_ACK_TIMEOUT_MS + 1);
      outcome = await pending;
    });
    expect(outcome).toEqual({ clear: false, error: 'Failed to send' });
  });

  it('not connected: nothing is sent and nothing is said', async () => {
    socket.connected = false;
    const { result } = render();
    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await result.current.sendReply({ content: 'hello', spans });
    });
    expect(outcome).toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
