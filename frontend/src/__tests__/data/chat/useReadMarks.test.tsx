import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { ClientEvents } from '@semaphore-chat/shared';
import { useReadMarks, type UseReadMarksOptions } from '../../../data/chat/useReadMarks';
import { createTestWrapper } from '../../test-utils/wrappers';
import { createMockSocket, type MockSocket } from '../../test-utils/mockSocket';
import { createInfiniteData, createMessage, resetFactoryCounter } from '../../test-utils/factories';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../../../api-client/@tanstack/react-query.gen';
import type { UnreadCountDto } from '../../../api-client';
import { channelMessagesQueryKey } from '../../../utils/messageQueryKeys';
import type { Message } from '../../../types/message.type';

// useReadReceipts' query reads the seeded cache instead of the network.
vi.mock('../../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api-client/@tanstack/react-query.gen')>();
  return {
    ...actual,
    readReceiptsControllerGetUnreadCountsOptions: () => ({
      queryKey: actual.readReceiptsControllerGetUnreadCountsQueryKey(),
      queryFn: () => Promise.resolve([]),
      staleTime: Infinity,
    }),
  };
});

const CHANNEL = 'channel-1';

describe('useReadMarks', () => {
  let queryClient: QueryClient;
  let socket: MockSocket;

  beforeEach(() => {
    resetFactoryCounter();
    vi.useFakeTimers();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    socket = createMockSocket();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function seedUnread(data: UnreadCountDto[]) {
    queryClient.setQueryData(readReceiptsControllerGetUnreadCountsQueryKey(), data);
  }
  const unread = () => queryClient.getQueryData<UnreadCountDto[]>(readReceiptsControllerGetUnreadCountsQueryKey());

  function renderReadMarks(initial: Partial<UseReadMarksOptions> & { orderedMessages: Message[] }) {
    const scrollToBottomRef = { current: vi.fn() };
    const atBottomRef = { current: true };
    const view = renderHook((props: Partial<UseReadMarksOptions> & { orderedMessages: Message[] }) =>
      useReadMarks({
        isLoading: false,
        channelId: CHANNEL,
        contextKey: CHANNEL,
        scrollToBottomRef,
        atBottomRef,
        ...props,
      }), {
      initialProps: initial,
      wrapper: createTestWrapper({ queryClient, socket }),
    });
    return { ...view, scrollToBottomRef, atBottomRef };
  }

  const markEmits = () =>
    socket.emit.mock.calls.filter(([event]) => event === ClientEvents.MARK_AS_READ).map(([, payload]) => payload);

  it('marks the newest confirmed message in the visible range, skipping optimistic rows', () => {
    const ordered = [
      createMessage({ id: 'a' }),
      createMessage({ id: 'b' }),
      createMessage({ id: 'pending-1', clientId: 'c-1', sendStatus: 'pending' }),
    ];
    seedUnread([{ channelId: CHANNEL, unreadCount: 2, mentionCount: 1 } as UnreadCountDto]);
    const { result } = renderReadMarks({ orderedMessages: ordered });

    act(() => result.current.handleVisibleRangeChange(0, 2));

    // Optimistic cache clear at once, the emit after the 1 s debounce.
    expect(unread()![0]).toMatchObject({ unreadCount: 0, mentionCount: 0, lastReadMessageId: 'b' });
    act(() => vi.advanceTimersByTime(1000));
    expect(markEmits()).toEqual([{ lastReadMessageId: 'b', channelId: CHANNEL }]);
  });

  it('clamps an overshooting range and ignores an empty or inverted one', () => {
    const ordered = [createMessage({ id: 'a' }), createMessage({ id: 'b' })];
    const { result } = renderReadMarks({ orderedMessages: ordered });

    act(() => result.current.handleVisibleRangeChange(3, 1));
    act(() => result.current.handleVisibleRangeChange(0, -1));
    act(() => vi.advanceTimersByTime(1000));
    expect(markEmits()).toEqual([]);

    act(() => result.current.handleVisibleRangeChange(-4, 40));
    act(() => vi.advanceTimersByTime(1000));
    expect(markEmits()).toEqual([{ lastReadMessageId: 'b', channelId: CHANNEL }]);
  });

  it('marks the real id when an optimistic row in view is confirmed (no new range)', () => {
    const a = createMessage({ id: 'a' });
    const pending = createMessage({ id: 'pending-1', clientId: 'c-1', sendStatus: 'pending' });
    const { result, rerender } = renderReadMarks({ orderedMessages: [a, pending] });

    act(() => result.current.handleVisibleRangeChange(1, 1));
    act(() => vi.advanceTimersByTime(1000));
    // Only the optimistic row is in range: nothing confirmed to mark yet.
    expect(markEmits()).toEqual([]);

    // The ack swaps the id in place (same clientId).
    const confirmed = createMessage({ id: 'real-1', clientId: 'c-1' });
    rerender({ orderedMessages: [a, confirmed] });
    act(() => vi.advanceTimersByTime(1000));
    expect(markEmits()).toEqual([{ lastReadMessageId: 'real-1', channelId: CHANNEL }]);
  });

  it('does not clear the badge in a detached window (the emit still goes out)', () => {
    queryClient.setQueryData(channelMessagesQueryKey(CHANNEL), {
      ...createInfiniteData([createMessage({ id: 'old-1' })]),
      pageParams: ['cursor-uuid'],
    });
    seedUnread([{ channelId: CHANNEL, unreadCount: 3, mentionCount: 1 } as UnreadCountDto]);
    const { result } = renderReadMarks({
      orderedMessages: [createMessage({ id: 'old-1' })],
      isDetachedFromPresent: true,
    });

    act(() => result.current.handleVisibleRangeChange(0, 0));

    expect(unread()![0]).toMatchObject({ unreadCount: 3, mentionCount: 1 });
    act(() => vi.advanceTimersByTime(1000));
    expect(markEmits()).toEqual([{ lastReadMessageId: 'old-1', channelId: CHANNEL }]);
  });

  it('puts the unread divider after the last read message', () => {
    const ordered = [createMessage({ id: 'a' }), createMessage({ id: 'b' }), createMessage({ id: 'c' })];
    seedUnread([{ channelId: CHANNEL, unreadCount: 1, mentionCount: 0, lastReadMessageId: 'b' } as UnreadCountDto]);
    const { result } = renderReadMarks({ orderedMessages: ordered });

    expect(result.current.lastReadIndex).toBe(1);
    expect(result.current.unreadCount).toBe(1);
  });

  it('has no divider when the last read message is not loaded', () => {
    seedUnread([{ channelId: CHANNEL, unreadCount: 4, mentionCount: 0, lastReadMessageId: 'gone' } as UnreadCountDto]);
    const { result } = renderReadMarks({ orderedMessages: [createMessage({ id: 'a' })] });

    expect(result.current.lastReadIndex).toBe(-1);
  });

  it('scrolls to the bottom once a detached window is back at the live edge, retrying until it lands', () => {
    const { rerender, scrollToBottomRef, atBottomRef } = renderReadMarks({
      orderedMessages: [createMessage({ id: 'old-1' })],
      isDetachedFromPresent: true,
    });
    atBottomRef.current = false;

    // The reset clears the data first: no scroll while the list is empty.
    rerender({ orderedMessages: [], isDetachedFromPresent: false });
    act(() => vi.advanceTimersByTime(100));
    expect(scrollToBottomRef.current).not.toHaveBeenCalled();

    rerender({ orderedMessages: [createMessage({ id: 'new-1' })], isDetachedFromPresent: false });
    act(() => vi.advanceTimersByTime(16 * 3));
    const tries = scrollToBottomRef.current.mock.calls.length;
    expect(tries).toBeGreaterThan(1);

    atBottomRef.current = true;
    act(() => vi.advanceTimersByTime(16 * 20));
    expect(scrollToBottomRef.current.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('does not carry the detached flag across a channel switch', () => {
    const { rerender, scrollToBottomRef } = renderReadMarks({
      orderedMessages: [createMessage({ id: 'old-1' })],
      isDetachedFromPresent: true,
    });

    rerender({
      orderedMessages: [createMessage({ id: 'x-1', channelId: 'channel-2' })],
      channelId: 'channel-2',
      contextKey: 'channel-2',
      isDetachedFromPresent: false,
    });
    act(() => vi.advanceTimersByTime(100));
    expect(scrollToBottomRef.current).not.toHaveBeenCalled();
  });

  it('jumps a detached window to the present through resetToPresent', () => {
    const resetToPresent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderReadMarks({ orderedMessages: [createMessage({ id: 'a' })], resetToPresent });

    act(() => result.current.handleDetachedJumpToPresent());
    expect(resetToPresent).toHaveBeenCalledTimes(1);
  });
});
