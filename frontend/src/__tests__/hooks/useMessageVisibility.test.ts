import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { ClientEvents } from '@semaphore-chat/shared';
import { useMessageVisibility } from '../../hooks/useMessageVisibility';
import { createTestWrapper } from '../test-utils/wrappers';
import { createMockSocket } from '../test-utils/mockSocket';
import type { MockSocket } from '../test-utils/mockSocket';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { UnreadCountDto } from '../../api-client';
import { channelMessagesQueryKey, dmMessagesQueryKey } from '../../utils/messageQueryKeys';
import { createInfiniteData, createMessage } from '../test-utils/factories';

describe('useMessageVisibility', () => {
  let queryClient: QueryClient;
  let mockSocket: MockSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockSocket = createMockSocket();
    // jsdom defaults document.hasFocus() to false, but every pre-existing
    // test in this file assumes a focused/visible tab (that's the common
    // case being tested) — stub it focused by default; the "blurred tab"
    // describe block below overrides per-test.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderVisibility(options: {
    channelId?: string;
    directMessageGroupId?: string;
    enabled?: boolean;
  }) {
    return renderHook(() => useMessageVisibility(options), {
      wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
    });
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

    it('still clears unread count when the messages cache is at the live edge', () => {
      // Explicit inverse of the detached case below: a normal (non-detached)
      // messages cache must not suppress the optimistic zero.
      queryClient.setQueryData(
        channelMessagesQueryKey('ch-1'),
        createInfiniteData([createMessage({ id: 'msg-1' })]),
      );
      seedUnreadData([
        { channelId: 'ch-1', unreadCount: 5, mentionCount: 2 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));

      const data = getUnreadData();
      expect(data![0].unreadCount).toBe(0);
      expect(data![0].mentionCount).toBe(0);
    });
  });

  describe('detached from live edge (#404 catch-up window)', () => {
    it('does not zero unread/mention counts when the channel messages cache is detached', () => {
      // Simulate a deep-scrollback window: pageParams[0] is a cursor, not the
      // live page — the loaded window is stale mid-history, not the present.
      const detached = {
        ...createInfiniteData([createMessage({ id: 'stale-1' })]),
        pageParams: ['cursor-uuid'],
      };
      queryClient.setQueryData(channelMessagesQueryKey('ch-1'), detached);
      seedUnreadData([
        { channelId: 'ch-1', unreadCount: 1, mentionCount: 0 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('stale-1'));

      const data = getUnreadData();
      expect(data![0].unreadCount).toBe(1);
      expect(data![0].mentionCount).toBe(0);
      expect(data![0].lastReadMessageId).toBeUndefined();

      // The server-side watermark clamp makes the emit a safe no-op for
      // regressions, and catch-up readers still legitimately advance it —
      // so the emit must still be sent even while the cache update is skipped.
      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'stale-1',
        channelId: 'ch-1',
      });
    });

    it('does not zero unread/mention counts when the DM messages cache is detached', () => {
      const detached = {
        ...createInfiniteData([createMessage({ id: 'stale-1' })]),
        pageParams: ['cursor-uuid'],
      };
      queryClient.setQueryData(dmMessagesQueryKey('dm-1'), detached);
      seedUnreadData([
        { directMessageGroupId: 'dm-1', unreadCount: 3, mentionCount: 1 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ directMessageGroupId: 'dm-1' });

      act(() => result.current.markAsRead('stale-1'));

      const data = getUnreadData();
      expect(data![0].unreadCount).toBe(3);
      expect(data![0].mentionCount).toBe(1);

      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'stale-1',
        directMessageGroupId: 'dm-1',
      });
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
        () => useMessageVisibility({ channelId: 'ch-1' }),
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

  describe('optimistic (not yet confirmed) message ids', () => {
    it('ignores a pending-<uuid> id: no optimistic clear, no emit', () => {
      seedUnreadData([
        { directMessageGroupId: 'dm-1', unreadCount: 2, mentionCount: 1 } as UnreadCountDto,
      ]);
      const { result } = renderVisibility({ directMessageGroupId: 'dm-1' });

      act(() => result.current.markAsRead('pending-3f1c'));
      act(() => vi.advanceTimersByTime(1000));

      expect(getUnreadData()![0]).toMatchObject({ unreadCount: 2, mentionCount: 1 });
      expect(getUnreadData()![0].lastReadMessageId).toBeUndefined();
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('does not let a pending id replace a real one waiting on the debounce', () => {
      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));
      act(() => result.current.markAsRead('pending-3f1c'));
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).toHaveBeenCalledTimes(1);
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'msg-1',
        channelId: 'ch-1',
      });
    });

    it('does not stash a pending id in a background tab for the focus replay', () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('pending-3f1c'));
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('background-tab auto-read gating', () => {
    it('does not optimistically clear or emit while the tab is blurred', () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      seedUnreadData([
        { channelId: 'ch-1', unreadCount: 5, mentionCount: 2 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));

      const data = getUnreadData();
      expect(data![0].unreadCount).toBe(5);
      expect(data![0].mentionCount).toBe(2);

      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('does not optimistically clear or emit while the tab is hidden (visibilityState)', () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      seedUnreadData([
        { channelId: 'ch-1', unreadCount: 5, mentionCount: 2 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ channelId: 'ch-1' });

      act(() => result.current.markAsRead('msg-1'));

      expect(getUnreadData()![0].unreadCount).toBe(5);
      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('replays the last pending message id once focus returns', () => {
      const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      seedUnreadData([
        { channelId: 'ch-1', unreadCount: 5, mentionCount: 2 } as UnreadCountDto,
      ]);

      const { result } = renderVisibility({ channelId: 'ch-1' });

      // MessageContainer keeps calling markAsRead with the newest visible id
      // even while blurred — simulate a couple of calls, only the latest
      // should survive to be replayed.
      act(() => {
        result.current.markAsRead('msg-1');
        result.current.markAsRead('msg-2');
      });

      // Still blurred: no optimistic clear, no emit.
      expect(getUnreadData()![0].unreadCount).toBe(5);
      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).not.toHaveBeenCalled();

      // Focus regained.
      hasFocusSpy.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });

      const data = getUnreadData();
      expect(data![0].unreadCount).toBe(0);
      expect(data![0].mentionCount).toBe(0);
      expect(data![0].lastReadMessageId).toBe('msg-2');

      act(() => vi.advanceTimersByTime(1000));
      expect(mockSocket.emit).toHaveBeenCalledWith(ClientEvents.MARK_AS_READ, {
        lastReadMessageId: 'msg-2',
        channelId: 'ch-1',
      });
    });

    it('does nothing on focus regained when there was no pending blurred id', () => {
      const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      seedUnreadData([
        { channelId: 'ch-1', unreadCount: 5, mentionCount: 2 } as UnreadCountDto,
      ]);

      renderVisibility({ channelId: 'ch-1' });

      hasFocusSpy.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });

      // Nothing was pending, so the count is untouched (markAsRead was never called).
      expect(getUnreadData()![0].unreadCount).toBe(5);
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

    it('cancels pending debounce when channelId changes', () => {
      const { result, rerender } = renderHook(
        ({ channelId }: { channelId: string }) =>
          useMessageVisibility({ channelId }),
        {
          wrapper: createTestWrapper({ queryClient, socket: mockSocket }),
          initialProps: { channelId: 'ch-1' },
        },
      );

      // Start a debounce on ch-1
      act(() => result.current.markAsRead('msg-1'));

      // Switch channel before debounce fires
      rerender({ channelId: 'ch-2' });

      // Old timer fires — should NOT emit for ch-1
      act(() => vi.advanceTimersByTime(1000));

      expect(mockSocket.emit).not.toHaveBeenCalledWith(
        ClientEvents.MARK_AS_READ,
        expect.objectContaining({ channelId: 'ch-1' }),
      );
    });
  });
});
