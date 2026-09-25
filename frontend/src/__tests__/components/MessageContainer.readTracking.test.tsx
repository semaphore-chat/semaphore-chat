/**
 * Read tracking end to end, from the list's geometry to the socket:
 * MessageContainer + the real VirtualMessageList + the real
 * useMessageVisibility (optimistic unread clear, 1 s debounced emit,
 * background-tab stash). Only virtua (no layout in jsdom), the row renderer
 * and the unread-divider lookup are mocked.
 *
 * MessageContainer.test.tsx covers the range -> markAsRead mapping with the
 * list mocked, and VirtualMessageList.test.tsx the range reporting itself.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { ClientEvents } from '@semaphore-chat/shared';
import { renderWithProviders } from '../test-utils';
import { createTestQueryClient } from '../test-utils/queryClient';
import { createMockSocket, type MockSocket } from '../test-utils/mockSocket';
import { createMessage, resetFactoryCounter } from '../test-utils/factories';
import MessageContainer from '../../components/Message/MessageContainer';
import { readReceiptsControllerGetUnreadCountsQueryKey } from '../../api-client/@tanstack/react-query.gen';
import type { UnreadCountDto } from '../../api-client';
import type { QueryClient } from '@tanstack/react-query';
import type { Message } from '../../types/message.type';

// ── Mock virtua's VList (see VirtualMessageList.test.tsx) ──────────────
type FakeHandle = {
  scrollToIndex: ReturnType<typeof vi.fn>;
  findItemIndex: ReturnType<typeof vi.fn>;
  scrollOffset: number;
  scrollSize: number;
  viewportSize: number;
};

let capturedProps: { onScroll?: (offset: number) => void } = {};
let fakeHandle: FakeHandle;

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        capturedProps = props as typeof capturedProps;
        ReactMod.useImperativeHandle(ref, () => fakeHandle, []);
        return <div data-testid="vlist">{props.children as React.ReactNode}</div>;
      },
    ),
  };
});

vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message }: { message: { id: string } }) => (
    <div data-testid={`msg-${message.id}`}>message-{message.id}</div>
  ),
}));

vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({
    lastReadMessageId: () => undefined,
    unreadCount: () => 0,
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────
const DM_ID = 'dm-1';

/** Newest-first, like useMessages returns them: dm-msg-2 is the newest. */
const shortConversation = () =>
  [2, 1, 0].map((i) => createMessage({ id: `dm-msg-${i}`, directMessageGroupId: DM_ID, channelId: null }));

const unreadKey = readReceiptsControllerGetUnreadCountsQueryKey();

function setTabState(focused: boolean, visibility: DocumentVisibilityState) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
  Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true });
}

let socket: MockSocket;
let queryClient: QueryClient;

const conversation = (messages: Message[]) => (
  <MessageContainer
    messages={messages}
    isLoading={false}
    error={null}
    authorId="me"
    isLoadingMore={false}
    messageInput={<div />}
    directMessageGroupId={DM_ID}
  />
);

function renderConversation(messages = shortConversation()) {
  return renderWithProviders(conversation(messages), { socket, queryClient });
}

const markAsReadEmits = () =>
  socket.emit.mock.calls.filter(([event]) => event === ClientEvents.MARK_AS_READ);

const dmUnread = () =>
  queryClient.getQueryData<UnreadCountDto[]>(unreadKey)?.find((c) => c.directMessageGroupId === DM_ID);

beforeEach(() => {
  vi.useFakeTimers();
  resetFactoryCounter();
  capturedProps = {};
  fakeHandle = {
    scrollToIndex: vi.fn(),
    findItemIndex: vi.fn(() => 0),
    scrollOffset: 0,
    // Three short messages fit the viewport: virtua's scrollSize is
    // max(content, viewport), so equal sizes mean there's nothing to scroll.
    scrollSize: 600,
    viewportSize: 600,
  };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  socket = createMockSocket();
  queryClient = createTestQueryClient();
  queryClient.setQueryData<UnreadCountDto[]>(unreadKey, [
    { directMessageGroupId: DM_ID, unreadCount: 3, mentionCount: 0 } as UnreadCountDto,
  ]);
  setTabState(true, 'visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MessageContainer read tracking (real list + visibility hook)', () => {
  it('marks a short conversation read on open, without any scrolling', () => {
    renderConversation();

    // Optimistic: the badge clears right away.
    expect(dmUnread()).toMatchObject({ unreadCount: 0, lastReadMessageId: 'dm-msg-2' });

    // Debounced emit with the newest message.
    expect(markAsReadEmits()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(markAsReadEmits()).toEqual([
      [ClientEvents.MARK_AS_READ, { lastReadMessageId: 'dm-msg-2', directMessageGroupId: DM_ID }],
    ]);
  });

  it('does not mark read while the tab is in the background, and catches up on focus', () => {
    setTabState(false, 'hidden');
    renderConversation();
    act(() => vi.advanceTimersByTime(1000));

    expect(markAsReadEmits()).toHaveLength(0);
    expect(dmUnread()).toMatchObject({ unreadCount: 3 });

    setTabState(true, 'visible');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    act(() => vi.advanceTimersByTime(1000));

    expect(dmUnread()).toMatchObject({ unreadCount: 0 });
    expect(markAsReadEmits()).toEqual([
      [ClientEvents.MARK_AS_READ, { lastReadMessageId: 'dm-msg-2', directMessageGroupId: DM_ID }],
    ]);
  });

  it('leaves a conversation that overflows the viewport to the scroll path', () => {
    fakeHandle.scrollSize = 2000;
    const long = Array.from({ length: 40 }, (_, i) =>
      createMessage({ id: `dm-msg-${39 - i}`, directMessageGroupId: DM_ID, channelId: null }),
    );
    renderConversation(long);
    act(() => vi.advanceTimersByTime(1000));
    expect(markAsReadEmits()).toHaveLength(0);
    expect(dmUnread()).toMatchObject({ unreadCount: 3 });

    // The initial scroll to the bottom reports the range (last index 39).
    fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(39);
    act(() => capturedProps.onScroll?.(1400));
    act(() => vi.advanceTimersByTime(1000));
    expect(markAsReadEmits()).toEqual([
      [ClientEvents.MARK_AS_READ, { lastReadMessageId: 'dm-msg-39', directMessageGroupId: DM_ID }],
    ]);
  });

  // ── Sending: the optimistic row's temporary id never reaches the server ──
  describe('own sends (optimistic pending-<uuid> rows)', () => {
    /**
     * Stands in for the browser's ResizeObserver so a newly mounted row's
     * first measurement reaches VirtualMessageList's row observer, which is
     * what reports the range of a list that fits the viewport.
     */
    class FakeResizeObserver {
      static instances: FakeResizeObserver[] = [];
      readonly observed = new Set<Element>();
      constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this);
      }
      observe(el: Element) {
        this.observed.add(el);
      }
      unobserve(el: Element) {
        this.observed.delete(el);
      }
      disconnect() {
        this.observed.clear();
      }
      /** Delivers a measurement for every observed row, as a layout pass would. */
      static measureRows() {
        for (const o of FakeResizeObserver.instances) {
          const rows = [...o.observed].filter((el) => el.hasAttribute('data-message-id'));
          if (rows.length === 0) continue;
          const entries = rows.map(
            (target) =>
              ({ target, contentRect: { height: 40 }, borderBoxSize: [{ blockSize: 40 }] }) as unknown as ResizeObserverEntry,
          );
          o.callback(entries, o as unknown as ResizeObserver);
        }
      }
    }

    beforeEach(() => {
      FakeResizeObserver.instances = [];
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });

    const optimistic = (overrides: Partial<Message> = {}): Message =>
      createMessage({
        id: 'pending-abc',
        clientId: 'pending-abc',
        sendStatus: 'pending',
        directMessageGroupId: DM_ID,
        channelId: null,
        authorId: 'me',
        ...overrides,
      });

    /** The ack swaps the id in place and keeps clientId (the row's React key). */
    const confirmed = (id: string): Message => ({
      ...optimistic(),
      id,
      sendStatus: undefined,
    });

    const emittedIds = () =>
      markAsReadEmits().map(([, payload]) => (payload as { lastReadMessageId: string }).lastReadMessageId);

    it('never marks the pending id when the new row mounts, and marks the real id once the send is confirmed', () => {
      const history = shortConversation();
      const { rerender } = renderConversation(history);
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-2']);

      // Send: the optimistic row mounts at the bottom and its first
      // measurement reports the (fitting) range, which now ends on it.
      rerender(conversation([optimistic(), ...history]));
      act(() => FakeResizeObserver.measureRows());
      act(() => vi.advanceTimersByTime(1000));

      expect(emittedIds()).toEqual(['dm-msg-2']);
      expect(dmUnread()?.lastReadMessageId).toBe('dm-msg-2');

      // Ack: same row (same key, same height), so no new range report.
      rerender(conversation([confirmed('dm-msg-3'), ...history]));
      act(() => vi.advanceTimersByTime(1000));

      expect(emittedIds()).toEqual(['dm-msg-2', 'dm-msg-3']);
      expect(dmUnread()?.lastReadMessageId).toBe('dm-msg-3');
    });

    it('never marks the pending id on the scroll path, and marks the real id once the send is confirmed', () => {
      fakeHandle.scrollSize = 2000;
      const history = Array.from({ length: 40 }, (_, i) =>
        createMessage({ id: `dm-msg-${39 - i}`, directMessageGroupId: DM_ID, channelId: null }),
      );
      const { rerender } = renderConversation(history);
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(39);
      act(() => capturedProps.onScroll?.(1400));
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-39']);

      // Send, then the stick-to-bottom scroll reports a range ending on it.
      rerender(conversation([optimistic(), ...history]));
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(31).mockReturnValueOnce(40);
      act(() => capturedProps.onScroll?.(1440));
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-39']);

      rerender(conversation([confirmed('dm-msg-40'), ...history]));
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-39', 'dm-msg-40']);
    });

    it('does not mark a confirmed send that was scrolled out of view before the ack', () => {
      fakeHandle.scrollSize = 2000;
      const history = Array.from({ length: 40 }, (_, i) =>
        createMessage({ id: `dm-msg-${39 - i}`, directMessageGroupId: DM_ID, channelId: null }),
      );
      const { rerender } = renderConversation(history);

      rerender(conversation([optimistic(), ...history]));
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(31).mockReturnValueOnce(40);
      act(() => capturedProps.onScroll?.(1440));
      // Scrolled up before the ack arrived.
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(10);
      act(() => capturedProps.onScroll?.(0));
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-10']);

      rerender(conversation([confirmed('dm-msg-40'), ...history]));
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-10']);
    });

    it('never marks a failed send', () => {
      const history = shortConversation();
      const { rerender } = renderConversation(history);
      act(() => vi.advanceTimersByTime(1000));

      rerender(conversation([optimistic({ sendStatus: 'failed' }), ...history]));
      act(() => FakeResizeObserver.measureRows());
      act(() => vi.advanceTimersByTime(1000));

      expect(emittedIds()).toEqual(['dm-msg-2']);
      expect(dmUnread()?.lastReadMessageId).toBe('dm-msg-2');
    });

    it('in a background tab, catches up on focus with the real id, not the pending one', () => {
      const history = shortConversation();
      const { rerender } = renderConversation(history);
      act(() => vi.advanceTimersByTime(1000));

      setTabState(false, 'hidden');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      rerender(conversation([optimistic(), ...history]));
      act(() => FakeResizeObserver.measureRows());
      rerender(conversation([confirmed('dm-msg-3'), ...history]));
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-2']);

      setTabState(true, 'visible');
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      act(() => vi.advanceTimersByTime(1000));
      expect(emittedIds()).toEqual(['dm-msg-2', 'dm-msg-3']);
    });
  });
});
