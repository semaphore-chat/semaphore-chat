import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

// The upload pipeline is mocked: these tests pin only how the hook hands the
// pipeline its error reporter.
const sendMessageWithAttachments = vi.fn();
vi.mock('../../utils/attachmentSend', () => ({
  sendMessageWithAttachments: (...args: unknown[]) => sendMessageWithAttachments(...args),
}));
vi.mock('../../hooks/useSendMessage', () => ({
  useSendMessage: () => ({ sendMessage: vi.fn() }),
}));
vi.mock('../../hooks/useOptimisticSendMessage', () => ({
  useOptimisticSendMessage: () => ({ sendMessage: vi.fn() }),
}));

import { useMessageFileUpload } from '../../hooks/useMessageFileUpload';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { NotificationProvider, useNotification } from '../../contexts/NotificationContext';
import { FileCacheProvider } from '../../contexts/AvatarCacheContext';
import { createTestQueryClient } from '../test-utils';
import { SpanType } from '../../types/message.type';

type Runtime = { notifyError?: (message: string) => void };

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <NotificationProvider>
        <FileCacheProvider>{children}</FileCacheProvider>
      </NotificationProvider>
    </QueryClientProvider>
  );
}

const spans = [{ type: SpanType.PLAINTEXT, text: 'hi' }];
const file = () => new File(['x'], 'photo.png', { type: 'image/png' });

/** Sends one file and returns the runtime the hook gave attachmentSend. */
async function sendAndCaptureRuntime(send: (c: string, s: typeof spans, f?: File[]) => Promise<void>): Promise<Runtime> {
  await act(async () => {
    await send('hi', spans, [file()]);
  });
  expect(sendMessageWithAttachments).toHaveBeenCalledTimes(1);
  return (sendMessageWithAttachments.mock.calls[0][0] as { runtime: Runtime }).runtime;
}

describe('useMessageFileUpload — injected error reporter', () => {
  beforeEach(() => {
    sendMessageWithAttachments.mockReset();
    sendMessageWithAttachments.mockResolvedValue(undefined);
  });

  it('forwards every upload/send error message to onError, unchanged', async () => {
    const onError = vi.fn();
    const { result } = renderHook(
      () => useMessageFileUpload({ contextType: VoiceSessionType.Channel, contextId: 'ch-1', authorId: 'me', onError }),
      { wrapper },
    );
    const runtime = await sendAndCaptureRuntime(result.current.handleSendMessage);

    runtime.notifyError?.("Couldn't upload photo.png: Network error");
    runtime.notifyError?.('Failed to send message');

    expect(onError.mock.calls).toEqual([["Couldn't upload photo.png: Network error"], ['Failed to send message']]);
  });

  it('with the classic wiring, the error shows as an error toast (as before the reporter was injected)', async () => {
    const { result } = renderHook(
      () => {
        const { showNotification } = useNotification();
        return useMessageFileUpload({
          contextType: VoiceSessionType.Channel,
          contextId: 'ch-1',
          authorId: 'me',
          onError: (message) => showNotification(message, 'error'),
        });
      },
      { wrapper },
    );
    const runtime = await sendAndCaptureRuntime(result.current.handleSendMessage);

    act(() => runtime.notifyError?.("Couldn't upload photo.png: Too large"));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't upload photo.png: Too large");
    expect(alert.className).toMatch(/Error/);
  });
});
