import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageContainer from '../../components/Message/MessageContainer';
import { createMessage, resetFactoryCounter } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

// ── Mock child components ──────────────────────────────────────────────
vi.mock('../../components/Message/MessageSkeleton', () => ({
  default: () => <div data-testid="message-skeleton" />,
}));

// VirtualMessageList is the SINGLE renderer now (both normal and anchored
// mode). MessageContainer's job is orchestration: which props flow down,
// FAB visibility/routing, the detached->live scroll retry, and feeding
// read-tracking from the visible-range callback. Those are exactly what this
// file tests — VirtualMessageList's own rendering/scroll mechanics (prepend,
// stick-to-bottom, anchored centering, pagination triggers, unread divider
// placement, jump-to-message) are unit-tested directly in
// VirtualMessageList.test.tsx against a mocked `virtua`, where real DOM
// order/placement can be asserted.
let lastVirtualListProps: Record<string, unknown> | null = null;
const mockScrollToBottom = vi.fn();
vi.mock('../../components/Message/VirtualMessageList', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<{ scrollToBottom: () => void }>) => {
        lastVirtualListProps = props;
        React.useImperativeHandle(ref, () => ({ scrollToBottom: mockScrollToBottom }), []);
        const orderedMessages = props.orderedMessages as Array<{ id: string }>;
        return (
          <div data-testid="virtual-message-list">
            {orderedMessages.map((m) => (
              <div key={m.id} data-testid={`vmsg-${m.id}`} />
            ))}
          </div>
        );
      },
    ),
  };
});

// ── Mock hooks ─────────────────────────────────────────────────────────
const mockMarkAsRead = vi.fn();
let lastVisibilityProps: { channelId?: string; directMessageGroupId?: string; enabled?: boolean } | null = null;
vi.mock('../../hooks/useMessageVisibility', () => ({
  useMessageVisibility: (props: { channelId?: string; directMessageGroupId?: string; enabled?: boolean }) => {
    lastVisibilityProps = props;
    return { markAsRead: mockMarkAsRead };
  },
}));

const mockGetLastReadMessageId = vi.fn((): string | undefined => undefined);
const mockGetUnreadCount = vi.fn((): number => 0);
vi.mock('../../hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({
    lastReadMessageId: mockGetLastReadMessageId,
    unreadCount: mockGetUnreadCount,
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────
const defaultProps = {
  messages: [] as ReturnType<typeof createMessage>[],
  isLoading: false,
  error: null,
  authorId: 'current-user-1',
  isLoadingMore: false,
  messageInput: <div data-testid="message-input">input</div>,
};

// ── Setup / Teardown ───────────────────────────────────────────────────
beforeEach(() => {
  resetFactoryCounter();
  lastVirtualListProps = null;
  lastVisibilityProps = null;
  mockMarkAsRead.mockClear();
  mockScrollToBottom.mockClear();
  mockGetLastReadMessageId.mockReturnValue(undefined);
  mockGetUnreadCount.mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────
describe('MessageContainer', () => {
  // ── Loading / Error / Empty states ─────────────────────────────────
  describe('loading state', () => {
    it('renders loading skeletons when isLoading is true', () => {
      renderWithProviders(<MessageContainer {...defaultProps} isLoading={true} />);

      const skeletons = screen.getAllByTestId('message-skeleton');
      expect(skeletons.length).toBe(10);
    });
  });

  describe('error state', () => {
    it('renders error message when error is set', () => {
      renderWithProviders(
        <MessageContainer {...defaultProps} error={new Error('fail')} />,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load messages");
      expect(screen.queryByText(/no messages yet/i)).not.toBeInTheDocument();
    });

    it('retries the failed (errored, active) queries from the Try again button', async () => {
      const { user, queryClient } = renderWithProviders(
        <MessageContainer {...defaultProps} error={new Error('fail')} />,
      );
      const refetchSpy = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue();

      await user.click(screen.getByRole('button', { name: /try again/i }));
      expect(refetchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'active' }));
    });

    it('shows "Channel not found" with a way out (no retry) on a 404', () => {
      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          channelId="ch-1"
          error={{ statusCode: 404, message: 'Not Found', error: 'Not Found' }}
        />,
      );

      expect(screen.getByText('Channel not found')).toBeInTheDocument();
      expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /go to home/i })).toBeInTheDocument();
    });

    it('explains a 403 (private channel / banned) instead of blaming the connection', () => {
      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          channelId="ch-1"
          error={{ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }}
        />,
      );

      expect(screen.getByText("You don't have access to this channel")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('says "Conversation not found" for a missing DM', () => {
      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          directMessageGroupId="dm-1"
          error={{ statusCode: 404, message: 'Not Found' }}
        />,
      );

      expect(screen.getByText('Conversation not found')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders default empty message when no messages', () => {
      renderWithProviders(<MessageContainer {...defaultProps} />);

      expect(
        screen.getByText('No messages yet'),
      ).toBeInTheDocument();
      expect(screen.getByText('Start the conversation!')).toBeInTheDocument();
    });

    it('renders custom empty state message', () => {
      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          emptyStateMessage="Nothing here yet!"
        />,
      );

      expect(screen.getByText('Nothing here yet!')).toBeInTheDocument();
    });

    it('does not render VirtualMessageList when there are no messages', () => {
      renderWithProviders(<MessageContainer {...defaultProps} />);
      expect(screen.queryByTestId('virtual-message-list')).not.toBeInTheDocument();
    });
  });

  // ── Rendering / renderer routing ───────────────────────────────────
  describe('rendering', () => {
    it('always renders through VirtualMessageList (single renderer, any message count)', () => {
      const messages = [createMessage({ id: 'msg-1' })];
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );
      expect(screen.getByTestId('virtual-message-list')).toBeInTheDocument();
    });

    it('renders messages in chronological order (oldest first) given newest-first input', () => {
      // Regression for the cross-message text selection bug: native selection
      // follows DOM/array order, so orderedMessages passed to the renderer
      // must be chronological even though the messages prop is newest-first.
      const messages = [
        createMessage({ id: 'msg-newest' }),
        createMessage({ id: 'msg-middle' }),
        createMessage({ id: 'msg-oldest' }),
      ];

      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      const ordered = lastVirtualListProps?.orderedMessages as Array<{ id: string }>;
      expect(ordered.map((m) => m.id)).toEqual([
        'msg-oldest',
        'msg-middle',
        'msg-newest',
      ]);
    });

    it('always renders message input outside the message list', () => {
      renderWithProviders(<MessageContainer {...defaultProps} />);
      expect(screen.getByTestId('message-input')).toBeInTheDocument();
    });

    it('passes mode, authorId, and pagination props straight through', () => {
      const onLoadMore = vi.fn();
      const onLoadNewer = vi.fn();
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          authorId="user-42"
          mode="anchored"
          continuationToken="older-token"
          onLoadMore={onLoadMore}
          onLoadNewer={onLoadNewer}
          isLoadingNewer={true}
          hasNewer={true}
        />,
      );

      expect(lastVirtualListProps).toMatchObject({
        authorId: 'user-42',
        mode: 'anchored',
        continuationToken: 'older-token',
        onLoadMore,
        onLoadNewer,
        isLoadingNewer: true,
        hasNewer: true,
      });
    });
  });

  // ── Scroll-to-bottom FAB ───────────────────────────────────────────
  describe('scroll-to-bottom FAB', () => {
    it('does not show FAB initially (atBottom defaults to true)', () => {
      const messages = [createMessage({ id: 'msg-1' })];
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows FAB when the renderer reports atBottom=false', () => {
      const messages = [createMessage({ id: 'msg-1' })];
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      act(() => {
        (lastVirtualListProps!.onAtBottomChange as (b: boolean) => void)(false);
      });

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('calls the renderer imperative scrollToBottom when FAB is clicked', async () => {
      const messages = [createMessage({ id: 'msg-1' })];
      const { user } = renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      act(() => {
        (lastVirtualListProps!.onAtBottomChange as (b: boolean) => void)(false);
      });

      await user.click(screen.getByRole('button'));
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    });

    it('hides FAB when the renderer reports atBottom=true again', () => {
      const messages = [createMessage({ id: 'msg-1' })];
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      act(() => {
        (lastVirtualListProps!.onAtBottomChange as (b: boolean) => void)(false);
      });
      expect(screen.getByRole('button')).toBeInTheDocument();

      act(() => {
        (lastVirtualListProps!.onAtBottomChange as (b: boolean) => void)(true);
      });
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows Jump to Present in normal mode when detached from the live edge, even at bottom', () => {
      const resetToPresent = vi.fn(() => Promise.resolve());
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="normal"
          isDetachedFromPresent
          resetToPresent={resetToPresent}
        />,
      );
      expect(screen.getByTestId('jump-to-present-fab')).toBeInTheDocument();
    });

    it('clicking Jump to Present resets the window to the live edge', async () => {
      const resetToPresent = vi.fn(() => Promise.resolve());
      const messages = [createMessage({ id: 'msg-1' })];

      const { user } = renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="normal"
          isDetachedFromPresent
          resetToPresent={resetToPresent}
        />,
      );
      await user.click(screen.getByTestId('jump-to-present-fab'));
      expect(resetToPresent).toHaveBeenCalled();
    });

    it('does not show Jump to Present in normal mode when not detached', () => {
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="normal"
          isDetachedFromPresent={false}
        />,
      );
      expect(screen.queryByTestId('jump-to-present-fab')).not.toBeInTheDocument();
    });
  });

  // ── Detached → live scroll follow-through (#404 fix round 3) ─────────
  describe('detached → live scroll follow-through', () => {
    beforeEach(() => {
      // Run rAF callbacks synchronously so the deferred scroll is observable
      // without waiting on a real animation frame.
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    });

    it('calls the renderer scrollToBottom once the reset completes and the refetched page renders', () => {
      const resetToPresent = vi.fn(() => Promise.resolve());
      // The stale detached window still has content (a deep-scrollback page,
      // not "no messages yet") — the renderer is mounted throughout.
      const staleMessages = [createMessage({ id: 'stale-1' })];
      const { rerender } = renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={staleMessages}
          mode="normal"
          isDetachedFromPresent
          resetToPresent={resetToPresent}
        />,
      );

      // The reset resolves and the refetched live page renders in the same
      // commit: isDetachedFromPresent flips false with non-empty messages.
      const liveMessages = [createMessage({ id: 'live-1' })];
      rerender(
        <MessageContainer
          {...defaultProps}
          messages={liveMessages}
          mode="normal"
          isDetachedFromPresent={false}
          resetToPresent={resetToPresent}
        />,
      );

      expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    });

    it('does not scroll again on a later unrelated re-render once settled', () => {
      const resetToPresent = vi.fn(() => Promise.resolve());
      const staleMessages = [createMessage({ id: 'stale-1' })];
      const { rerender } = renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={staleMessages}
          mode="normal"
          isDetachedFromPresent
          resetToPresent={resetToPresent}
        />,
      );

      const liveMessages = [createMessage({ id: 'live-1' })];
      rerender(
        <MessageContainer
          {...defaultProps}
          messages={liveMessages}
          mode="normal"
          isDetachedFromPresent={false}
          resetToPresent={resetToPresent}
        />,
      );
      // The transition itself scrolls once — sanity-check before asserting
      // it doesn't happen a second time below.
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
      mockScrollToBottom.mockClear();

      // A later, ordinary re-render (still not detached) must not re-trigger
      // the one-shot "just returned from detachment" scroll.
      const moreMessages = [createMessage({ id: 'live-2' }), ...liveMessages];
      rerender(
        <MessageContainer
          {...defaultProps}
          messages={moreMessages}
          mode="normal"
          isDetachedFromPresent={false}
          resetToPresent={resetToPresent}
        />,
      );

      expect(mockScrollToBottom).not.toHaveBeenCalled();
    });

    it('does not carry a stale detached flag across a context switch', () => {
      const resetToPresent = vi.fn(() => Promise.resolve());
      const staleMessagesA = [createMessage({ id: 'stale-a' })];
      const { rerender } = renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={staleMessagesA}
          mode="normal"
          isDetachedFromPresent
          resetToPresent={resetToPresent}
          channelId="channel-a"
        />,
      );

      // Switch context (e.g. user navigates to a different channel) while
      // still marked detached for the old channel; the new channel's own
      // (non-detached) messages load in the same commit.
      const messagesB = [createMessage({ id: 'msg-b' })];
      rerender(
        <MessageContainer
          {...defaultProps}
          messages={messagesB}
          mode="normal"
          isDetachedFromPresent={false}
          resetToPresent={resetToPresent}
          channelId="channel-b"
        />,
      );

      // The context-switch commit itself must not trigger the "returned from
      // detachment" scroll for channel-b — only a genuine detached→live
      // transition within the SAME context should.
      expect(mockScrollToBottom).not.toHaveBeenCalled();
    });
  });

  // ── Unread message divider (index computation) ────────────────────
  describe('unread message divider', () => {
    it('computes lastReadIndex in chronological order and passes it with unreadCount', () => {
      // Messages newest-first: msg-a (newest), msg-b, msg-c (oldest)
      // msg-c is the last read message.
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
        createMessage({ id: 'msg-c' }),
      ];

      mockGetLastReadMessageId.mockReturnValue('msg-c');
      mockGetUnreadCount.mockReturnValue(2);

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          channelId="channel-1"
        />,
      );

      // Chronological order: msg-c (index 0), msg-b (1), msg-a (2).
      expect(lastVirtualListProps).toMatchObject({
        lastReadIndex: 0,
        unreadCount: 2,
      });
    });

    it('reports lastReadIndex -1 when there is no last-read message', () => {
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
      ];

      mockGetLastReadMessageId.mockReturnValue(undefined);
      mockGetUnreadCount.mockReturnValue(0);

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          channelId="channel-1"
        />,
      );

      expect(lastVirtualListProps).toMatchObject({
        lastReadIndex: -1,
        unreadCount: 0,
      });
    });
  });

  // ── Highlighted message (passthrough) ──────────────────────────────
  describe('highlighted message', () => {
    it('passes highlightMessageId and highlightSeq straight through', () => {
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
      ];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          highlightMessageId="msg-b"
          highlightSeq={3}
        />,
      );

      expect(lastVirtualListProps).toMatchObject({
        highlightMessageId: 'msg-b',
        highlightSeq: 3,
      });
    });
  });

  // ── Member list ────────────────────────────────────────────────────
  describe('member list', () => {
    it('renders member list when provided and showMemberList is true', () => {
      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          memberListComponent={<div data-testid="member-list">Members</div>}
          showMemberList={true}
        />,
      );

      expect(screen.getByTestId('member-list')).toBeInTheDocument();
    });

    it('does not render member list when showMemberList is false', () => {
      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          memberListComponent={<div data-testid="member-list">Members</div>}
          showMemberList={false}
        />,
      );

      expect(screen.queryByTestId('member-list')).not.toBeInTheDocument();
    });
  });

  // ── FAB follows the composer height (mobile UX overhaul, task 11) ──
  describe('FAB offset from the measured composer', () => {
    type ROCallback = (entries: Array<Partial<ResizeObserverEntry>>) => void;
    let observers: Array<{ cb: ROCallback; targets: Element[] }> = [];
    const OriginalRO = globalThis.ResizeObserver;

    beforeEach(() => {
      observers = [];
      class FakeResizeObserver {
        private entry: { cb: ROCallback; targets: Element[] };
        constructor(cb: ROCallback) {
          this.entry = { cb, targets: [] };
          observers.push(this.entry);
        }
        observe(el: Element) { this.entry.targets.push(el); }
        unobserve() {}
        disconnect() { this.entry.targets = []; }
      }
      globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
      globalThis.ResizeObserver = OriginalRO;
    });

    function resizeComposer(height: number) {
      const composerBox = screen.getByTestId('message-input').parentElement!;
      const observer = observers.find((o) => o.targets.includes(composerBox));
      expect(observer).toBeDefined();
      act(() => {
        observer!.cb([{ target: composerBox, contentRect: { height } as DOMRectReadOnly }]);
      });
    }

    it('positions the scroll-to-bottom FAB just above the composer', () => {
      renderWithProviders(<MessageContainer {...defaultProps} messages={[createMessage({ id: 'msg-1' })]} />);
      act(() => {
        (lastVirtualListProps!.onAtBottomChange as (b: boolean) => void)(false);
      });

      resizeComposer(120);
      expect(screen.getByRole('button', { name: /scroll to latest/i })).toHaveStyle({ bottom: '136px' });

      // Composer grows (4-line draft + file tray) — the FAB moves with it.
      resizeComposer(300);
      expect(screen.getByRole('button', { name: /scroll to latest/i })).toHaveStyle({ bottom: '316px' });
    });

    it('positions Jump to Present above the composer too', () => {
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={[createMessage({ id: 'msg-1' })]} mode="anchored" jumpToPresent={vi.fn()} />,
      );
      resizeComposer(200);
      expect(screen.getByTestId('jump-to-present-fab')).toHaveStyle({ bottom: '216px' });
    });
  });

  // ── Anchored mode (jump to message) ──────────────────────────────
  describe('anchored mode', () => {
    it('shows "Jump to Present" button in anchored mode', () => {
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="anchored"
          jumpToPresent={vi.fn()}
        />,
      );

      expect(screen.getByTestId('jump-to-present-fab')).toBeInTheDocument();
      expect(screen.getByText('Jump to Present')).toBeInTheDocument();
    });

    it('does not show "Jump to Present" in normal mode', () => {
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="normal"
        />,
      );

      expect(screen.queryByTestId('jump-to-present-fab')).not.toBeInTheDocument();
    });

    it('calls jumpToPresent when "Jump to Present" button is clicked', async () => {
      const jumpToPresent = vi.fn();
      const messages = [createMessage({ id: 'msg-1' })];

      const { user } = renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="anchored"
          jumpToPresent={jumpToPresent}
        />,
      );

      await user.click(screen.getByTestId('jump-to-present-fab'));
      expect(jumpToPresent).toHaveBeenCalledTimes(1);
    });

    it('auto-transitions to normal mode via useAnchoredModeTransition once atBottom and hasNewer=false', () => {
      // Integration check that MessageContainer wires atBottom (from the
      // renderer) and hasNewer/isLoadingNewer straight into
      // useAnchoredModeTransition — the hook's own decision logic is unit
      // tested in useAnchoredModeTransition.test.ts.
      const jumpToPresent = vi.fn();
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="anchored"
          jumpToPresent={jumpToPresent}
          hasNewer={true}
          isLoadingNewer={false}
        />,
      );

      act(() => {
        (lastVirtualListProps!.onAtBottomChange as (b: boolean) => void)(false);
      });
      expect(jumpToPresent).not.toHaveBeenCalled();
    });
  });

  // ── Read tracking (fed by the renderer's visible-range callback) ──
  describe('read tracking', () => {
    const manyMessages = (n: number) =>
      Array.from({ length: n }, (_, i) => createMessage({ id: `msg-${i}` }));

    it('enables markAsRead once loaded with messages', () => {
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={manyMessages(5)} channelId="ch-1" />,
      );
      expect(lastVisibilityProps).toMatchObject({ channelId: 'ch-1', enabled: true });
    });

    it('disables markAsRead while loading', () => {
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={[]} isLoading channelId="ch-1" />,
      );
      expect(lastVisibilityProps).toMatchObject({ enabled: false });
    });

    it('marks the latest visible message from the visible range (anchored mode included — no mode gating)', () => {
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={manyMessages(200)} mode="anchored" jumpToPresent={vi.fn()} channelId="ch-1" />,
      );
      // Chronological render order is the reverse of the newest-first prop:
      // ordered[k] = msg-(199 - k). Range end 5 → msg-194.
      act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, 5));
      expect(mockMarkAsRead).toHaveBeenCalledWith('msg-194');
    });

    it('clamps an out-of-range end index to the newest message', () => {
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={manyMessages(200)} channelId="ch-1" />,
      );
      act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(190, 500));
      expect(mockMarkAsRead).toHaveBeenCalledWith('msg-0');
    });

    describe('optimistic sends (pending-<uuid> ids)', () => {
      // Newest-first like useMessages: the optimistic row is the newest.
      const pendingRow = (overrides: Record<string, unknown> = {}) =>
        createMessage({ id: 'pending-abc', clientId: 'pending-abc', sendStatus: 'pending', ...overrides });
      const history = () => manyMessages(5); // ordered[k] = msg-(4 - k)

      it('marks the newest confirmed message when the range ends on a pending row', () => {
        renderWithProviders(
          <MessageContainer {...defaultProps} messages={[pendingRow(), ...history()]} channelId="ch-1" />,
        );
        act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, 5));
        expect(mockMarkAsRead).toHaveBeenCalledTimes(1);
        expect(mockMarkAsRead).toHaveBeenCalledWith('msg-0');
      });

      it('skips failed rows too', () => {
        renderWithProviders(
          <MessageContainer
            {...defaultProps}
            messages={[pendingRow(), pendingRow({ id: 'pending-def', clientId: 'pending-def', sendStatus: 'failed' }), ...history()]}
            channelId="ch-1"
          />,
        );
        act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, 6));
        expect(mockMarkAsRead).toHaveBeenCalledWith('msg-0');
        expect(mockMarkAsRead.mock.calls.flat().some((id) => String(id).startsWith('pending-'))).toBe(false);
      });

      it('marks nothing when every visible row is still pending', () => {
        renderWithProviders(
          <MessageContainer {...defaultProps} messages={[pendingRow(), ...history()]} channelId="ch-1" />,
        );
        act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(5, 5));
        expect(mockMarkAsRead).not.toHaveBeenCalled();
      });

      it('marks the real id when a visible pending row is confirmed (id swap on ack)', () => {
        const { rerender } = renderWithProviders(
          <MessageContainer {...defaultProps} messages={[pendingRow(), ...history()]} channelId="ch-1" />,
        );
        act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, 5));
        mockMarkAsRead.mockClear();

        rerender(
          <MessageContainer
            {...defaultProps}
            messages={[pendingRow({ id: 'msg-real', sendStatus: undefined }), ...history()]}
            channelId="ch-1"
          />,
        );
        expect(mockMarkAsRead).toHaveBeenCalledTimes(1);
        expect(mockMarkAsRead).toHaveBeenCalledWith('msg-real');
      });

      it('does not mark a confirmed row that left the visible range before the ack', () => {
        const { rerender } = renderWithProviders(
          <MessageContainer {...defaultProps} messages={[pendingRow(), ...history()]} channelId="ch-1" />,
        );
        act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, 5));
        act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, 2));
        mockMarkAsRead.mockClear();

        rerender(
          <MessageContainer
            {...defaultProps}
            messages={[pendingRow({ id: 'msg-real', sendStatus: undefined }), ...history()]}
            channelId="ch-1"
          />,
        );
        expect(mockMarkAsRead).not.toHaveBeenCalled();
      });

      it('does not re-mark on unrelated re-renders', () => {
        const messages = [pendingRow(), ...history()];
        const { rerender } = renderWithProviders(
          <MessageContainer {...defaultProps} messages={messages} channelId="ch-1" />,
        );
        act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, 5));
        mockMarkAsRead.mockClear();

        rerender(<MessageContainer {...defaultProps} messages={[...messages]} channelId="ch-1" />);
        expect(mockMarkAsRead).not.toHaveBeenCalled();
      });
    });

    it('ignores invalid ranges', () => {
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={manyMessages(200)} channelId="ch-1" />,
      );
      act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(5, 2));
      act(() => (lastVirtualListProps!.onVisibleRangeChange as (s: number, e: number) => void)(0, -1));
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });
  });

  // ── aria-live announcements (useMessageListAnnouncer wiring) ─────────
  describe('live-region announcements', () => {
    const otherMessage = (id: string, text: string) =>
      createMessage({
        id,
        authorId: 'other-user',
        spans: [{ type: SpanType.PLAINTEXT, text }],
      });
    const ownMessage = (id: string, text: string) =>
      createMessage({
        id,
        authorId: 'current-user-1',
        spans: [{ type: SpanType.PLAINTEXT, text }],
      });

    function liveRegionText(): string {
      return screen.getByTestId('message-list-live-region').textContent ?? '';
    }

    function setAtBottom(atBottom: boolean) {
      act(() => {
        (lastVirtualListProps!.onAtBottomChange as (b: boolean) => void)(atBottom);
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function flushAnnouncer() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
    }

    it('is silent for the initial page load (no baseline "new message" spam)', async () => {
      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={[otherMessage('m1', 'hello there')]}
          channelId="ch-1"
        />,
      );
      await flushAnnouncer();
      expect(liveRegionText()).toBe('');
    });

    it('announces a new message from another author when not at the live edge', async () => {
      const initial = [otherMessage('m1', 'hello there')];
      const { rerender } = renderWithProviders(
        <MessageContainer {...defaultProps} messages={initial} channelId="ch-1" />,
      );
      setAtBottom(false);

      const withNew = [otherMessage('m2', 'second message'), ...initial];
      rerender(<MessageContainer {...defaultProps} messages={withNew} channelId="ch-1" />);

      await flushAnnouncer();
      expect(liveRegionText()).toContain('second message');
    });

    it('does not announce while at the bottom (message already visible)', async () => {
      const initial = [otherMessage('m1', 'hello there')];
      const { rerender } = renderWithProviders(
        <MessageContainer {...defaultProps} messages={initial} channelId="ch-1" />,
      );
      // atBottom defaults to true — never toggled false here.

      const withNew = [otherMessage('m2', 'second message'), ...initial];
      rerender(<MessageContainer {...defaultProps} messages={withNew} channelId="ch-1" />);

      await flushAnnouncer();
      expect(liveRegionText()).toBe('');
    });

    it('does not announce the reader\'s own messages', async () => {
      const initial = [otherMessage('m1', 'hello there')];
      const { rerender } = renderWithProviders(
        <MessageContainer {...defaultProps} messages={initial} channelId="ch-1" />,
      );
      setAtBottom(false);

      const withOwn = [ownMessage('m2', 'my own message'), ...initial];
      rerender(<MessageContainer {...defaultProps} messages={withOwn} channelId="ch-1" />);

      await flushAnnouncer();
      expect(liveRegionText()).toBe('');
    });

    it('coalesces several messages arriving within the batch window into a count', async () => {
      const initial = [otherMessage('m1', 'hello there')];
      const { rerender } = renderWithProviders(
        <MessageContainer {...defaultProps} messages={initial} channelId="ch-1" />,
      );
      setAtBottom(false);

      const withNew = [
        otherMessage('m3', 'third'),
        otherMessage('m2', 'second'),
        ...initial,
      ];
      rerender(<MessageContainer {...defaultProps} messages={withNew} channelId="ch-1" />);

      await flushAnnouncer();
      expect(liveRegionText()).toContain('2 new messages');
    });

    it('does not announce across a channel switch (baseline resets, not a "new message")', async () => {
      const initial = [otherMessage('m1', 'hello there')];
      const { rerender } = renderWithProviders(
        <MessageContainer {...defaultProps} messages={initial} channelId="ch-1" />,
      );
      setAtBottom(false);

      const otherChannelMessages = [otherMessage('m2', 'a different channel')];
      rerender(
        <MessageContainer {...defaultProps} messages={otherChannelMessages} channelId="ch-2" />,
      );

      await flushAnnouncer();
      expect(liveRegionText()).toBe('');
    });
  });
});
