import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageContainer from '../../components/Message/MessageContainer';
import { createMessage, resetFactoryCounter } from '../test-utils/factories';

// ── Mock IntersectionObserver ──────────────────────────────────────────
type MockObserverInstance = {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  elements: Set<Element>;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: (entries: Partial<IntersectionObserverEntry>[]) => void;
};

let mockObserverInstances: MockObserverInstance[] = [];

class MockIntersectionObserver {
  _instance: MockObserverInstance;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    const instance: MockObserverInstance = {
      callback,
      options,
      elements: new Set(),
      observe: vi.fn((el: Element) => instance.elements.add(el)),
      unobserve: vi.fn((el: Element) => instance.elements.delete(el)),
      disconnect: vi.fn(() => instance.elements.clear()),
      trigger: (entries: Partial<IntersectionObserverEntry>[]) => {
        callback(
          entries as IntersectionObserverEntry[],
          this as unknown as IntersectionObserver,
        );
      },
    };
    this._instance = instance;
    mockObserverInstances.push(instance);
  }
  observe(el: Element) { this._instance.observe(el); }
  unobserve(el: Element) { this._instance.unobserve(el); }
  disconnect() { this._instance.disconnect(); }
}

// ── Mock child components ──────────────────────────────────────────────
vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message, isSearchHighlight, contextType }: { message: { id: string; spans: unknown[] }; isSearchHighlight?: boolean; contextType?: string }) => (
    <div data-testid={`message-${message.id}`} data-highlighted={isSearchHighlight} data-context-type={contextType}>
      message-{message.id}
    </div>
  ),
}));

vi.mock('../../components/Message/MessageSkeleton', () => ({
  default: () => <div data-testid="message-skeleton" />,
}));

vi.mock('../../components/Message/UnreadMessageDivider', () => ({
  UnreadMessageDivider: ({ unreadCount }: { unreadCount: number }) => (
    <div data-testid="unread-divider">{unreadCount} new messages</div>
  ),
}));

// ── Mock hooks ─────────────────────────────────────────────────────────
const mockMarkAsRead = vi.fn();
vi.mock('../../hooks/useMessageVisibility', () => ({
  useMessageVisibility: () => ({ markAsRead: mockMarkAsRead }),
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

/** Find the column-reverse scroll container */
function getScrollContainer() {
  return screen.getByTestId('scroll-container');
}

/** Get the IntersectionObserver instance that observes a given element */
function findObserverFor(testFn: (instance: MockObserverInstance) => boolean) {
  return mockObserverInstances.find(testFn);
}

// ── Setup / Teardown ───────────────────────────────────────────────────
beforeEach(() => {
  resetFactoryCounter();
  mockObserverInstances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
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

      expect(screen.getByText('Error loading messages')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders default empty message when no messages', () => {
      renderWithProviders(<MessageContainer {...defaultProps} />);

      expect(
        screen.getByText('No messages yet. Start the conversation!'),
      ).toBeInTheDocument();
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
  });

  // ── Message rendering ──────────────────────────────────────────────
  describe('message rendering', () => {
    it('renders all messages', () => {
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
        createMessage({ id: 'msg-c' }),
      ];

      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      expect(screen.getByTestId('message-msg-a')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-b')).toBeInTheDocument();
      expect(screen.getByTestId('message-msg-c')).toBeInTheDocument();
    });

    it('renders scroll container with column-reverse layout', () => {
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      const container = getScrollContainer();
      expect(container).toBeInTheDocument();
    });

    it('always renders message input outside the scroll container', () => {
      renderWithProviders(<MessageContainer {...defaultProps} />);

      expect(screen.getByTestId('message-input')).toBeInTheDocument();
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

    it('shows FAB when bottom sentinel reports not intersecting', () => {
      const messages = [createMessage({ id: 'msg-1' })];
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      // Find the observer watching the bottom sentinel (threshold: 0)
      const bottomObserver = findObserverFor(
        (inst) => inst.options?.threshold === 0 && inst.elements.size > 0,
      );
      expect(bottomObserver).toBeDefined();

      // Simulate scrolling away from bottom
      act(() => {
        bottomObserver!.trigger([{ isIntersecting: false }]);
      });

      // FAB should now be visible
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('calls scrollTo({ top: 0 }) when FAB is clicked', async () => {
      const messages = [createMessage({ id: 'msg-1' })];
      const { user } = renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      const container = getScrollContainer();
      container.scrollTo = vi.fn();

      // Make FAB visible
      const bottomObserver = findObserverFor(
        (inst) => inst.options?.threshold === 0 && inst.elements.size > 0,
      );
      act(() => {
        bottomObserver!.trigger([{ isIntersecting: false }]);
      });

      await user.click(screen.getByRole('button'));
      expect(container.scrollTo).toHaveBeenCalledWith({
        top: 0,
        behavior: 'smooth',
      });
    });

    it('hides FAB when bottom sentinel becomes visible again', () => {
      const messages = [createMessage({ id: 'msg-1' })];
      renderWithProviders(
        <MessageContainer {...defaultProps} messages={messages} />,
      );

      const bottomObserver = findObserverFor(
        (inst) => inst.options?.threshold === 0 && inst.elements.size > 0,
      );

      // Scroll away then back
      act(() => {
        bottomObserver!.trigger([{ isIntersecting: false }]);
      });
      expect(screen.getByRole('button')).toBeInTheDocument();

      act(() => {
        bottomObserver!.trigger([{ isIntersecting: true }]);
      });
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  // ── Pagination (load more) ────────────────────────────────────────
  describe('pagination', () => {
    it('calls onLoadMore when top sentinel is intersecting', () => {
      const onLoadMore = vi.fn().mockResolvedValue(undefined);
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          continuationToken="next-page-token"
          onLoadMore={onLoadMore}
        />,
      );

      // threshold=0 observers: bottom sentinel (1st) and top sentinel (2nd)
      const thresholdZeroObservers = mockObserverInstances.filter(
        (inst) => inst.options?.threshold === 0,
      );
      expect(thresholdZeroObservers.length).toBeGreaterThanOrEqual(2);

      act(() => {
        thresholdZeroObservers[1].trigger([{ isIntersecting: true }]);
      });
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('does not call onLoadMore when isLoadingMore is true', () => {
      const onLoadMore = vi.fn().mockResolvedValue(undefined);
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          continuationToken="token"
          onLoadMore={onLoadMore}
          isLoadingMore={true}
        />,
      );

      const thresholdZeroObservers = mockObserverInstances.filter(
        (inst) => inst.options?.threshold === 0,
      );
      expect(thresholdZeroObservers.length).toBeGreaterThanOrEqual(2);

      act(() => {
        thresholdZeroObservers[1].trigger([{ isIntersecting: true }]);
      });
      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it('does not call onLoadMore without continuationToken', () => {
      const onLoadMore = vi.fn().mockResolvedValue(undefined);
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          onLoadMore={onLoadMore}
        />,
      );

      const thresholdZeroObservers = mockObserverInstances.filter(
        (inst) => inst.options?.threshold === 0,
      );
      expect(thresholdZeroObservers.length).toBeGreaterThanOrEqual(2);

      act(() => {
        thresholdZeroObservers[1].trigger([{ isIntersecting: true }]);
      });
      expect(onLoadMore).not.toHaveBeenCalled();
    });

    it('shows loading skeletons when isLoadingMore is true', () => {
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          isLoadingMore={true}
        />,
      );

      // 3 skeletons shown during loading more (in addition to the message)
      const skeletons = screen.getAllByTestId('message-skeleton');
      expect(skeletons.length).toBe(3);
    });
  });

  // ── Unread message divider ─────────────────────────────────────────
  describe('unread message divider', () => {
    it('shows divider at the correct position', () => {
      // Messages newest-first: msg-a (newest), msg-b, msg-c (oldest)
      // msg-c is the last read message (index 2 in newest-first)
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

      const divider = screen.getByTestId('unread-divider');
      expect(divider).toHaveTextContent('2 new messages');

      // Verify DOM order: in column-reverse, DOM order is newest-first.
      // The divider should appear between msg-b (unread) and msg-c (last read) in DOM,
      // which visually places it between msg-c (above) and msg-b (below).
      const container = getScrollContainer();
      const children = Array.from(container.querySelectorAll('[data-testid]'));
      const testIds = children.map((el) => el.getAttribute('data-testid'));
      const dividerIdx = testIds.indexOf('unread-divider');
      const msgBIdx = testIds.indexOf('message-msg-b');
      const msgCIdx = testIds.indexOf('message-msg-c');
      expect(dividerIdx).toBeGreaterThan(msgBIdx);
      expect(dividerIdx).toBeLessThan(msgCIdx);
    });

    it('does not show divider when unreadCount is 0', () => {
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
      ];

      mockGetLastReadMessageId.mockReturnValue('msg-b');
      mockGetUnreadCount.mockReturnValue(0);

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          channelId="channel-1"
        />,
      );

      expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument();
    });

    it('does not show divider when last read message is the newest (index 0)', () => {
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
      ];

      // Last read is the newest message — nothing is unread in view
      mockGetLastReadMessageId.mockReturnValue('msg-a');
      mockGetUnreadCount.mockReturnValue(0);

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          channelId="channel-1"
        />,
      );

      expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument();
    });
  });

  // ── Highlighted message ────────────────────────────────────────────
  describe('highlighted message', () => {
    beforeEach(() => {
      // scrollIntoView is not implemented in jsdom; mock it globally
      Element.prototype.scrollIntoView = vi.fn();
    });

    it('marks the correct message as highlighted', () => {
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
      ];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          highlightMessageId="msg-b"
        />,
      );

      expect(screen.getByTestId('message-msg-b')).toHaveAttribute(
        'data-highlighted',
        'true',
      );
      expect(screen.getByTestId('message-msg-a')).toHaveAttribute(
        'data-highlighted',
        'false',
      );
    });

    it('calls scrollIntoView on the highlighted message element', async () => {
      const messages = [
        createMessage({ id: 'msg-a' }),
        createMessage({ id: 'msg-b' }),
      ];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          highlightMessageId="msg-b"
          highlightSeq={1}
        />,
      );

      const msgEl = document.querySelector('[data-message-id="msg-b"]')!;

      await waitFor(() => {
        expect(msgEl.scrollIntoView).toHaveBeenCalledWith({
          behavior: 'instant',
          block: 'center',
        });
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

    it('calls onLoadNewer when bottom sentinel intersects in anchored mode', () => {
      const onLoadNewer = vi.fn().mockResolvedValue(undefined);
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="anchored"
          jumpToPresent={vi.fn()}
          onLoadNewer={onLoadNewer}
          isLoadingNewer={false}
          hasNewer={true}
        />,
      );

      // First threshold=0 observer is the bottom sentinel
      const bottomObserver = mockObserverInstances.find(
        (inst) => inst.options?.threshold === 0 && inst.elements.size > 0,
      );
      expect(bottomObserver).toBeDefined();

      act(() => {
        bottomObserver!.trigger([{ isIntersecting: true }]);
      });
      expect(onLoadNewer).toHaveBeenCalledTimes(1);
    });

    it('does not call onLoadNewer when isLoadingNewer is true', () => {
      const onLoadNewer = vi.fn().mockResolvedValue(undefined);
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="anchored"
          jumpToPresent={vi.fn()}
          onLoadNewer={onLoadNewer}
          isLoadingNewer={true}
          hasNewer={true}
        />,
      );

      const bottomObserver = mockObserverInstances.find(
        (inst) => inst.options?.threshold === 0 && inst.elements.size > 0,
      );

      act(() => {
        bottomObserver!.trigger([{ isIntersecting: true }]);
      });
      expect(onLoadNewer).not.toHaveBeenCalled();
    });

    it('shows loading skeletons when isLoadingNewer is true', () => {
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          mode="anchored"
          jumpToPresent={vi.fn()}
          isLoadingNewer={true}
        />,
      );

      // 3 skeletons for newer loading
      const skeletons = screen.getAllByTestId('message-skeleton');
      expect(skeletons.length).toBe(3);
    });
  });

  // ── Context type ───────────────────────────────────────────────────
  describe('context type', () => {
    it('passes "dm" context type when directMessageGroupId is set', () => {
      const messages = [createMessage({ id: 'msg-1' })];

      renderWithProviders(
        <MessageContainer
          {...defaultProps}
          messages={messages}
          directMessageGroupId="dm-group-1"
        />,
      );

      expect(screen.getByTestId('message-msg-1')).toHaveAttribute(
        'data-context-type',
        'dm',
      );
    });
  });
});
