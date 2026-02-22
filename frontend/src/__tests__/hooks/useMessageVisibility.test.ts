import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { ClientEvents } from '@kraken/shared';
import { useMessageVisibility } from '../../hooks/useMessageVisibility';
import { createTestWrapper } from '../test-utils/wrappers';
import { createMockSocket } from '../test-utils/mockSocket';
import type { MockSocket } from '../test-utils/mockSocket';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { UnreadCountDto } from '../../api-client';

// Mock IntersectionObserver for jsdom
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor() {}
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

describe('useMessageVisibility', () => {
  let queryClient: QueryClient;
  let mockSocket: MockSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockSocket = createMockSocket();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderVisibility(options: {
    channelId?: string;
    directMessageGroupId?: string;
    messages?: Array<{ id: string }>;
    enabled?: boolean;
  }) {
    return renderHook(
      () =>
        useMessageVisibility({
          ...options,
          messages: options.messages ?? [],
        }),
      {
        wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
      },
    );
  }

  function seedUnreadData(data: UnreadCountDto[]) {
    const key = readReceiptsControllerGetUnreadCountsQueryKey();
    queryClient.setQueryData(key, data);
  }

  function getUnreadData(): UnreadCountDto[] | undefined {
    const key = readReceiptsControllerGetUnreadCountsQueryKey();
    return queryClient.getQueryData(key);
  }

  describe('optimistic cache update', () => {
    it('clears unread count immediately on markAsRead', () => {
      seedUnreadData([
        { channelId: 'ch-1', unreadCount: 5, mentionCount: 2 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));

      const data = getUnreadData();
      expect(data).toHaveLength(1);
      expect(data![0].unreadCount).toBe(0);
      expect(data![0].mentionCount).toBe(0);
      expect(data![0].lastReadMessageId).toBe('msg-1');
    });

    it('clears unread count for DM groups', () => {
      seedUnreadData([
        { directMessageGroupId: 'dm-1', unreadCount: 3, mentionCount: 1 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ directMessageGroupId: 'dm-1' });

      act(() => result.current.markAsRead('msg-1'));

      const data = getUnreadData();
      expect(data![0].unreadCount).toBe(0);
      expect(data![0].mentionCount).toBe(0);
    });
  });

  describe('debounced socket emit', () => {
    it('does not emit socket event immediately', () => {
      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('emits socket event after 1s debounce', () => {
      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'msg-1',
        channelId: 'ch-1',
      });
    });

    it('coalesces rapid calls into a single emit with the latest message ID', () => {
      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => {
        result.current.markAsRead('msg-1');
        result.current.markAsRead('msg-2');
        result.current.markAsRead('msg-3');
      });

      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).toHaveBeenCalledTimes(1);
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'msg-3',
        channelId: 'ch-1',
      });
    });

    it('resets debounce timer on each new call', () => {
      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));

      // Advance 800ms (not enough to fire)
      act(() => vi.advanceTimersByTime(800));
      expect(mockSocket.emit).not.toHaveBeenCalled();

      // Call again — resets the timer
      act(() => result.current.markAsRead('msg-2'));

      // Advance another 800ms (1600ms from start, but only 800ms from last call)
      act(() => vi.advanceTimersByTime(800));
      expect(mockSocket.emit).not.toHaveBeenCalled();

      // Advance remaining 200ms to hit 1s from last call
      act(() => vi.advanceTimersByTime(200));
      expect(mockSocket.emit).toHaveBeenCalledTimes(1);
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'msg-2',
        channelId: 'ch-1',
      });
    });

    it('emits with directMessageGroupId payload for DMs', () => {
      const { result } = renderVisibility({ directMessageGroupId: 'dm-1' });

      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'msg-1',
        directMessageGroupId: 'dm-1',
      });
    });
  });

  describe('deduplication', () => {
    it('skips emit if same message ID was already sent', () => {
      const { result } = renderVisibility({ channelId: 'ch-1' });

      // First call + debounce fires
      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).toHaveBeenCalledTimes(1);
      mockSocket.emit.mockClear();

      // Same ID again — should not emit
      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('emits for a new message ID after previous was sent', () => {
      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));
      mockSocket.emit.mockClear();

      act(() => result.current.markAsRead('msg-2'));
      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'msg-2',
        channelId: 'ch-1',
      });
    });
  });

  describe('guard conditions', () => {
    it('does nothing when socket is null', () => {
      const { result } = renderHook(
        () => useMessageVisibility({ channelId: 'ch-1', messages: [] }),
        {
          wrapper: createTestWrapper({ queryClient, socket: null }),
        },
      );

      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('does nothing when enabled is false', () => {
      const { result } = renderVisibility({ channelId: 'ch-1', enabled: false });

      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('does nothing when neither channelId nor directMessageGroupId is provided', () => {
      const { result } = renderVisibility({});

      act(() => result.current.markAsRead('msg-1'));
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('does not emit after unmount', () => {
      const { result, unmount } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));
      unmount();

      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });
});
