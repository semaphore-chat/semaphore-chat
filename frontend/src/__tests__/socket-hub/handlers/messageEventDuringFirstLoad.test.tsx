/**
 * A channel event that arrives while the channel's first page is still loading (the Lounge chat flake): the
 * handlers cancelled the in-flight fetch before writing, which reverts a first load to "pending" with no fetch
 * running. The message lists never go stale, so nothing loaded them again: the chat showed "No messages yet." for
 * good, and later live messages had no list to land in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useMessages } from '../../../hooks/useMessages';
import { handleNewMessage, handleReactionAdded, handleUpdateMessage } from '../../../socket-hub/handlers/messageHandlers';
import { messagesControllerFindAllForChannel } from '../../../api-client/sdk.gen';
import { createMessage, createTestQueryClient } from '../../test-utils';

vi.mock('../../../api-client/sdk.gen', () => ({
  messagesControllerFindAllForChannel: vi.fn(),
  messagesControllerFindAllForGroup: vi.fn(),
}));

const fetchPage = vi.mocked(messagesControllerFindAllForChannel);
const history = createMessage({ id: 'history-1', channelId: 'chan-1' });
const live = createMessage({ id: 'live-1', channelId: 'chan-1' });

function page(messages: unknown[]) {
  return { data: { messages, continuationToken: '' } } as never;
}

/** Renders the channel's list with its first fetch held open; `answer` lets that fetch finish. */
async function loadingChannel() {
  let answer: (value: unknown) => void = () => undefined;
  fetchPage.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)) as never);
  // Any later fetch reads the server after the event: the history and the live message.
  fetchPage.mockImplementation(async () => page([live, history]));
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useMessages('channel', 'chan-1'), { wrapper });
  await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
  expect(hook.result.current.isLoading).toBe(true);
  return { queryClient, hook, answer: (messages: unknown[]) => answer(page(messages)) };
}

describe('a channel event during the first load of its messages', () => {
  beforeEach(() => {
    fetchPage.mockReset();
  });

  it('a new message: the list still loads, and includes it', async () => {
    const { queryClient, hook, answer } = await loadingChannel();

    await handleNewMessage({ message: live as never }, queryClient);
    // The first fetch's answer was read before the message existed.
    answer([history]);

    await waitFor(() => expect(hook.result.current.messages.map((m) => m.id)).toEqual(['live-1', 'history-1']));
    expect(hook.result.current.isLoading).toBe(false);
  });

  it('an edit: the list still loads', async () => {
    const { queryClient, hook, answer } = await loadingChannel();

    await handleUpdateMessage({ message: { ...history, editedAt: '2026-11-16T00:00:00Z' } as never }, queryClient);
    answer([history]);

    await waitFor(() => expect(hook.result.current.messages.map((m) => m.id)).toContain('history-1'));
  });

  it('a reaction: the list still loads', async () => {
    const { queryClient, hook, answer } = await loadingChannel();

    await handleReactionAdded(
      { messageId: 'history-1', channelId: 'chan-1', reaction: { emoji: '🎉', userIds: ['u'] } } as never,
      queryClient,
    );
    answer([history]);

    await waitFor(() => expect(hook.result.current.messages.map((m) => m.id)).toContain('history-1'));
  });
});
