import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useJumpToMessage } from '../../hooks/useJumpToMessage';
import { createMessage, createTestQueryClient } from '../test-utils';
import {
  messagesControllerFindAllForChannel,
  messagesControllerFindAroundForChannel,
} from '../../api-client/sdk.gen';

// Cold deep link (#Task 4): a `?highlight=` link opened before the channel's
// first page is cached. The target is far back in history, so it is NOT in
// the latest page; the hook must still enter anchored mode and highlight it,
// even though the container may clear the URL param right away.

vi.mock('../../api-client/sdk.gen', () => ({
  messagesControllerFindAllForChannel: vi.fn(),
  messagesControllerFindAllForGroup: vi.fn(async () => ({
    data: { messages: [], continuationToken: '' },
  })),
  messagesControllerFindAroundForChannel: vi.fn(),
  messagesControllerFindAroundForGroup: vi.fn(async () => ({
    data: { messages: [], olderContinuationToken: undefined, newerContinuationToken: undefined },
  })),
}));

const latestPage = (channelId: string) => ({
  data: {
    messages: [
      createMessage({ id: `${channelId}-latest-2`, channelId }),
      createMessage({ id: `${channelId}-latest-1`, channelId }),
    ],
    continuationToken: 'older-cursor',
  },
});

const aroundPage = (channelId: string, messageId: string) => ({
  data: {
    messages: [
      createMessage({ id: `${messageId}-before`, channelId }),
      createMessage({ id: messageId, channelId }),
      createMessage({ id: `${messageId}-after`, channelId }),
    ],
    olderContinuationToken: 'o',
    newerContinuationToken: 'n',
  },
});

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useJumpToMessage — cold deep link', () => {
  beforeEach(() => {
    vi.mocked(messagesControllerFindAllForChannel).mockReset();
    vi.mocked(messagesControllerFindAroundForChannel).mockReset();
    vi.mocked(messagesControllerFindAllForChannel).mockImplementation(
      (async (opts: { path: { channelId: string } }) => latestPage(opts.path.channelId)) as never,
    );
    vi.mocked(messagesControllerFindAroundForChannel).mockImplementation(
      (async (opts: { path: { channelId: string; messageId: string } }) =>
        aroundPage(opts.path.channelId, opts.path.messageId)) as never,
    );
  });

  it('enters anchored mode and highlights a target that is not in the uncached first page', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useJumpToMessage('channel', 'chan-1', 'target-msg'), { wrapper });

    // Pending from the very first render, so the container keeps the URL param.
    expect(result.current.isJumpPending).toBe(true);
    expect(result.current.highlightMessageId).toBe('target-msg');

    await waitFor(() => expect(result.current.mode).toBe('anchored'));
    await waitFor(() => expect(result.current.messages.some((m) => m.id === 'target-msg')).toBe(true));
    await waitFor(() => expect(result.current.isJumpPending).toBe(false));
    expect(result.current.highlightMessageId).toBe('target-msg');
    expect(result.current.highlightSeq).toBeGreaterThan(0);
    expect(messagesControllerFindAroundForChannel).toHaveBeenCalledWith(
      expect.objectContaining({ path: { channelId: 'chan-1', messageId: 'target-msg' } }),
    );
  });

  it('still anchors when the URL param is cleared before the first page arrives', async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ highlight }: { highlight: string | undefined }) => useJumpToMessage('channel', 'chan-1', highlight),
      { wrapper, initialProps: { highlight: 'target-msg' as string | undefined } },
    );

    // The container drops the param from the URL.
    rerender({ highlight: undefined });

    await waitFor(() => expect(result.current.mode).toBe('anchored'));
    await waitFor(() => expect(result.current.messages.some((m) => m.id === 'target-msg')).toBe(true));
    expect(result.current.highlightMessageId).toBe('target-msg');
  });

  it('stays in normal mode and settles once the target is in the first page', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useJumpToMessage('channel', 'chan-1', 'chan-1-latest-1'), { wrapper });

    await waitFor(() => expect(result.current.isJumpPending).toBe(false));
    expect(result.current.mode).toBe('normal');
    expect(result.current.highlightMessageId).toBe('chan-1-latest-1');
    expect(messagesControllerFindAroundForChannel).not.toHaveBeenCalled();
  });

  it('highlights in the new channel when switching channels with ?highlight', async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ id, highlight }: { id: string; highlight: string | undefined }) =>
        useJumpToMessage('channel', id, highlight),
      { wrapper, initialProps: { id: 'chan-1', highlight: undefined as string | undefined } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // One navigation changes both the channel and the highlight.
    rerender({ id: 'chan-2', highlight: 'far-msg' });

    expect(result.current.highlightMessageId).toBe('far-msg');
    await waitFor(() => expect(result.current.mode).toBe('anchored'));
    await waitFor(() => expect(result.current.messages.some((m) => m.id === 'far-msg')).toBe(true));
    expect(result.current.highlightMessageId).toBe('far-msg');
    expect(messagesControllerFindAroundForChannel).toHaveBeenCalledWith(
      expect.objectContaining({ path: { channelId: 'chan-2', messageId: 'far-msg' } }),
    );
  });

  it('clears the highlight when switching channels without ?highlight', async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ id, highlight }: { id: string; highlight: string | undefined }) =>
        useJumpToMessage('channel', id, highlight),
      { wrapper, initialProps: { id: 'chan-1', highlight: 'chan-1-latest-1' as string | undefined } },
    );
    await waitFor(() => expect(result.current.isJumpPending).toBe(false));
    expect(result.current.highlightMessageId).toBe('chan-1-latest-1');

    rerender({ id: 'chan-2', highlight: undefined });

    expect(result.current.highlightMessageId).toBeUndefined();
    expect(result.current.isJumpPending).toBe(false);
    expect(result.current.mode).toBe('normal');
  });
});
