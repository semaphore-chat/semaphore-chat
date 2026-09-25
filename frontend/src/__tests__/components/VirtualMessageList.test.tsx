import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import VirtualMessageList, {
  type VirtualMessageListHandle,
} from '../../components/Message/VirtualMessageList';
import { createMessage, resetFactoryCounter } from '../test-utils/factories';
import { TYPING_INDICATOR_HEIGHT } from '../../constants/layout';

// ── Mock virtua's VList ────────────────────────────────────────────────
// jsdom can't do real layout, so we mock VList: it renders its children into a
// plain div, installs a controllable imperative handle, and captures the props
// (shift, onScroll) so tests can drive scroll events and assert wiring.
type FakeHandle = {
  scrollToIndex: ReturnType<typeof vi.fn>;
  scrollTo: ReturnType<typeof vi.fn>;
  scrollBy: ReturnType<typeof vi.fn>;
  findItemIndex: ReturnType<typeof vi.fn>;
  getItemOffset: ReturnType<typeof vi.fn>;
  getItemSize: ReturnType<typeof vi.fn>;
  scrollOffset: number;
  scrollSize: number;
  viewportSize: number;
  cache: unknown;
};

let capturedProps: { shift?: boolean; onScroll?: (offset: number) => void } = {};
let fakeHandle: FakeHandle;

vi.mock('virtua', async () => {
  const ReactMod = await import('react');
  return {
    VList: ReactMod.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        capturedProps = props as typeof capturedProps;
        ReactMod.useImperativeHandle(ref, () => fakeHandle, []);
        return (
          <div data-testid="vlist">{props.children as React.ReactNode}</div>
        );
      },
    ),
  };
});

// ── Mock child components ──────────────────────────────────────────────
vi.mock('../../components/Message/MessageComponent', () => ({
  default: ({ message, contextType }: { message: { id: string }; contextType?: string }) => (
    <div data-testid={`msg-${message.id}`} data-context-type={contextType}>
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

// ── Helpers ────────────────────────────────────────────────────────────
const messages = (n: number) =>
  Array.from({ length: n }, (_, i) => createMessage({ id: `msg-${i}` }));

const baseProps = {
  authorId: 'current-user',
  isLoadingMore: false,
  unreadCount: 0,
  lastReadIndex: -1,
};

function makeHandle(overrides: Partial<FakeHandle> = {}): FakeHandle {
  return {
    scrollToIndex: vi.fn(),
    scrollTo: vi.fn(),
    scrollBy: vi.fn(),
    findItemIndex: vi.fn(() => 0),
    getItemOffset: vi.fn(() => 0),
    getItemSize: vi.fn(() => 0),
    scrollOffset: 0,
    scrollSize: 1000,
    viewportSize: 400,
    cache: {},
    ...overrides,
  };
}

// ── ResizeObserver stand-in ────────────────────────────────────────────
// jsdom has no ResizeObserver (and no layout), so tests that exercise the
// row observer install this fake with vi.stubGlobal and deliver
// notifications by hand via resizeRows().
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
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
}

function installFakeResizeObserver() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
}

const rowEl = (id: string) => document.querySelector(`[data-message-id="${id}"]`);

/** Deliver a ResizeObserver notification, as the browser would after layout,
 * for the given rows (message id -> new height in px) to every observer
 * currently watching them. */
function resizeRows(heights: Record<string, number>) {
  for (const observer of FakeResizeObserver.instances) {
    const entries = Object.entries(heights)
      .map(([id, height]) => ({ target: rowEl(id), height }))
      .filter(({ target }) => target !== null && observer.observed.has(target))
      .map(({ target, height }) => ({
        target,
        contentRect: { height } as DOMRectReadOnly,
        borderBoxSize: [{ blockSize: height, inlineSize: 600 }],
      }));
    if (entries.length === 0) continue;
    act(() =>
      observer.callback(
        entries as unknown as ResizeObserverEntry[],
        observer as unknown as ResizeObserver,
      ),
    );
  }
}

beforeEach(() => {
  resetFactoryCounter();
  capturedProps = {};
  fakeHandle = makeHandle();
  // Run rAF callbacks synchronously (stick-to-bottom defers via rAF).
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VirtualMessageList', () => {
  it('renders a row with data-message-id for each message', () => {
    render(<VirtualMessageList {...baseProps} orderedMessages={messages(3)} />);
    expect(document.querySelector('[data-message-id="msg-0"]')).toBeTruthy();
    expect(document.querySelector('[data-message-id="msg-1"]')).toBeTruthy();
    expect(document.querySelector('[data-message-id="msg-2"]')).toBeTruthy();
  });

  it('keeps the same DOM node across an optimistic id swap when clientId is stable (no remount, PR-13 fix round 1 Minor 6)', () => {
    const pending = createMessage({ id: 'pending-1', clientId: 'pending-1', sendStatus: 'pending' });
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={[pending]} />,
    );
    const beforeNode = document.querySelector('[data-message-id="pending-1"]');
    expect(beforeNode).toBeTruthy();

    // Reconciliation swaps id -> the real server id but retains clientId
    // (see messageCacheUpdaters.ts) so the row's React key (clientId ?? id)
    // stays stable across the swap.
    const settled = createMessage({ id: 'real-1', clientId: 'pending-1' });
    rerender(<VirtualMessageList {...baseProps} orderedMessages={[settled]} />);

    const afterNode = document.querySelector('[data-message-id="real-1"]');
    expect(afterNode).toBeTruthy();
    // Same DOM node — proves React reconciled in place rather than
    // unmounting the old row and mounting a new one (which would blink).
    expect(afterNode).toBe(beforeNode);
  });

  it('places the unread divider before the first unread message', () => {
    // lastReadIndex 1 → divider before index 2 (msg-2)
    render(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(4)}
        unreadCount={2}
        lastReadIndex={1}
      />,
    );
    const divider = screen.getByTestId('unread-divider');
    const row2 = document.querySelector('[data-message-id="msg-2"]')!;
    // Divider is rendered inside the msg-2 row, before its message content.
    expect(row2.contains(divider)).toBe(true);
    expect(divider).toHaveTextContent('2 new messages');
  });

  it('scrolls to the newest message on initial mount', () => {
    render(<VirtualMessageList {...baseProps} orderedMessages={messages(5)} />);
    expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(4, { align: 'end' });
  });

  it('re-homes to the bottom on context switch even when the message count is unchanged', () => {
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={messages(5)} resetKey="ch-1" />,
    );
    fakeHandle.scrollToIndex.mockClear();

    // Same length (5) — positioning must still re-run for the new context.
    rerender(
      <VirtualMessageList {...baseProps} orderedMessages={messages(5)} resetKey="ch-2" />,
    );

    expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(4, { align: 'end' });
  });

  it('notifies onAtBottomChange(true) on context switch so FAB state is not stale', () => {
    const onAtBottomChange = vi.fn();
    const { rerender } = render(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(5)}
        resetKey="ch-1"
        onAtBottomChange={onAtBottomChange}
      />,
    );

    // Scroll up in the old context: offset 0 → 600px from bottom → not atBottom.
    act(() => capturedProps.onScroll?.(0));
    expect(onAtBottomChange).toHaveBeenLastCalledWith(false);
    onAtBottomChange.mockClear();

    rerender(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(5)}
        resetKey="ch-2"
        onAtBottomChange={onAtBottomChange}
      />,
    );

    expect(onAtBottomChange).toHaveBeenCalledWith(true);
  });

  it('triggers onLoadMore when the visible start index nears the top', () => {
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    fakeHandle.findItemIndex = vi.fn(() => 2); // near top
    render(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(50)}
        continuationToken="next"
        onLoadMore={onLoadMore}
      />,
    );
    act(() => capturedProps.onScroll?.(50));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not trigger onLoadMore without a continuation token', () => {
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    fakeHandle.findItemIndex = vi.fn(() => 2);
    render(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(50)}
        onLoadMore={onLoadMore}
      />,
    );
    act(() => capturedProps.onScroll?.(50));
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not trigger onLoadMore when far from the top', () => {
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    fakeHandle.findItemIndex = vi.fn(() => 40); // far from top
    render(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(50)}
        continuationToken="next"
        onLoadMore={onLoadMore}
      />,
    );
    act(() => capturedProps.onScroll?.(500));
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('reports atBottom true near the bottom and false while scrolled up', () => {
    const onAtBottomChange = vi.fn();
    // scrollSize 1000, viewport 400 → bottom offset is 600.
    fakeHandle = makeHandle({ scrollSize: 1000, viewportSize: 400 });
    render(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(50)}
        onAtBottomChange={onAtBottomChange}
      />,
    );
    onAtBottomChange.mockClear();

    act(() => capturedProps.onScroll?.(600)); // distance 0 → pinned
    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);

    act(() => capturedProps.onScroll?.(100)); // distance 500 → not pinned
    expect(onAtBottomChange).toHaveBeenLastCalledWith(false);
  });

  it('reports the visible index range on scroll', () => {
    const onVisibleRangeChange = vi.fn();
    fakeHandle.findItemIndex = vi
      .fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20);
    render(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={messages(50)}
        onVisibleRangeChange={onVisibleRangeChange}
      />,
    );
    act(() => capturedProps.onScroll?.(300));
    expect(onVisibleRangeChange).toHaveBeenCalledWith(10, 20);
  });

  it('sets shift=true only on the render where an older page is prepended', () => {
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={messages(5)} />,
    );
    // Initial render: no prepend.
    expect(capturedProps.shift).toBe(false);

    // Prepend an older message (new oldest id at the start, length grows).
    const older = createMessage({ id: 'older' });
    rerender(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[older, ...messages(5)]}
      />,
    );
    expect(capturedProps.shift).toBe(true);
  });

  it('does not set shift when a newer message is appended', () => {
    const initial = messages(5);
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={initial} />,
    );
    const newer = createMessage({ id: 'newer' });
    rerender(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[...initial, newer]}
      />,
    );
    expect(capturedProps.shift).toBe(false);
  });

  it('sets shift=true when an older page prepends at the cap and evicts the newest page (length unchanged)', () => {
    const initial = messages(5);
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={initial} />,
    );
    // Pin to the bottom, as the reader typically is when a background
    // older-page load evicts the newest page.
    act(() => capturedProps.onScroll?.(600));
    fakeHandle.scrollToIndex.mockClear();

    // At MESSAGE_MAX_PAGES, an older-page prepend evicts the newest page:
    // same length (5), new oldest id, and the newest id also changes.
    const older = createMessage({ id: 'at-cap-older' });
    const atCap = [older, ...initial.slice(0, 4)]; // drop msg-4 (newest)
    rerender(<VirtualMessageList {...baseProps} orderedMessages={atCap} />);

    expect(capturedProps.shift).toBe(true);
    // Stick-to-bottom must be suppressed even though the newest id changed.
    expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not set shift when only the oldest message is dropped (length shrinks)', () => {
    const initial = messages(5);
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={initial} />,
    );
    const shrunk = initial.slice(1); // drop msg-0 (oldest), no prepend
    rerender(<VirtualMessageList {...baseProps} orderedMessages={shrunk} />);

    expect(capturedProps.shift).toBe(false);
  });

  it('sticks to the bottom when a newer message arrives while pinned', () => {
    const initial = messages(5);
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={initial} />,
    );
    // Pin to bottom via a scroll event at the bottom offset.
    act(() => capturedProps.onScroll?.(600));
    fakeHandle.scrollToIndex.mockClear();

    const newer = createMessage({ id: 'newer' });
    rerender(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[...initial, newer]}
      />,
    );
    // Scrolls to the new last index (rAF is synchronous in the test).
    expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(5, { align: 'end' });
  });

  it('does not stick to the bottom when a newer message arrives while scrolled up', () => {
    const initial = messages(5);
    const { rerender } = render(
      <VirtualMessageList {...baseProps} orderedMessages={initial} />,
    );
    act(() => capturedProps.onScroll?.(100)); // scrolled up → not pinned
    fakeHandle.scrollToIndex.mockClear();

    const newer = createMessage({ id: 'newer' });
    rerender(
      <VirtualMessageList
        {...baseProps}
        orderedMessages={[...initial, newer]}
      />,
    );
    expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
  });

  it('exposes scrollToBottom via the imperative handle', () => {
    const ref = React.createRef<VirtualMessageListHandle>();
    render(
      <VirtualMessageList
        {...baseProps}
        ref={ref}
        orderedMessages={messages(5)}
      />,
    );
    fakeHandle.scrollToIndex.mockClear();
    act(() => ref.current?.scrollToBottom());
    expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(4, { align: 'end' });
  });

  // The typing indicator floats (absolutely positioned) over the bottom of
  // the list; a permanent spacer at the end of the list keeps the newest
  // message above it. The spacer lives INSIDE the last row, so it is part of
  // that item's measured size: scrollToIndex(last, { align: 'end' }) — used by
  // initial positioning, stick-to-bottom and scrollToBottom — lands at the
  // true bottom, spacer included, and item indices stay 1:1 with messages.
  describe('typing-indicator spacer', () => {
    const spacers = () => document.querySelectorAll('[data-testid="typing-indicator-spacer"]');

    it('renders exactly one spacer, as tall as the typing indicator, at the end of the list', () => {
      render(<VirtualMessageList {...baseProps} orderedMessages={messages(3)} />);
      expect(spacers()).toHaveLength(1);
      const spacer = spacers()[0] as HTMLElement;
      expect(spacer.style.height).toBe(`${TYPING_INDICATOR_HEIGHT}px`);
      expect(spacer.getAttribute('aria-hidden')).toBe('true');
      // Last thing in the list, inside the newest message's row.
      const lastRow = document.querySelector('[data-message-id="msg-2"]')!;
      expect(lastRow.contains(spacer)).toBe(true);
      expect(lastRow.lastElementChild).toBe(spacer);
    });

    it('does not add an extra list item (indices stay 1:1 with messages)', () => {
      render(<VirtualMessageList {...baseProps} orderedMessages={messages(3)} />);
      const vlist = document.querySelector('[data-testid="vlist"]')!;
      expect(vlist.children).toHaveLength(3);
    });

    it('moves to the new last row and sticks to the true bottom when a newer message arrives while pinned', () => {
      const initial = messages(5);
      const { rerender } = render(
        <VirtualMessageList {...baseProps} orderedMessages={initial} />,
      );
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[...initial, createMessage({ id: 'newer' })]}
        />,
      );
      expect(spacers()).toHaveLength(1);
      expect(
        document.querySelector('[data-message-id="newer"]')!.contains(spacers()[0]),
      ).toBe(true);
      // align 'end' on the row that contains the spacer = the bottom of the
      // scroll content, not the bottom of the message text.
      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(5, { align: 'end' });
    });

    it('counts a scroll offset at the very bottom (spacer included) as pinned', () => {
      const onAtBottomChange = vi.fn();
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(5)}
          onAtBottomChange={onAtBottomChange}
        />,
      );
      onAtBottomChange.mockClear();
      // scrollSize 1000, viewport 400 → max offset 600 (spacer is inside it).
      act(() => capturedProps.onScroll?.(600));
      expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
    });

    it('keeps the spacer in anchored mode (the indicator overlays that list too)', () => {
      render(
        <VirtualMessageList {...baseProps} mode="anchored" orderedMessages={messages(4)} />,
      );
      expect(spacers()).toHaveLength(1);
      expect(document.querySelector('[data-message-id="msg-3"]')!.contains(spacers()[0])).toBe(true);
    });
  });

  describe('jump-to-message', () => {
    it('scrolls to the highlighted message centered', () => {
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(10)}
          highlightMessageId="msg-3"
          highlightSeq={1}
        />,
      );
      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(3, { align: 'center' });
    });

    it('re-scrolls and remounts the row (flash re-fires) when highlightSeq bumps', () => {
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(10)}
          highlightMessageId="msg-3"
          highlightSeq={1}
        />,
      );
      const firstNode = document.querySelector('[data-message-id="msg-3"]');
      fakeHandle.scrollToIndex.mockClear();

      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(10)}
          highlightMessageId="msg-3"
          highlightSeq={2}
        />,
      );
      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(3, { align: 'center' });
      // The `${id}-hl-${seq}` key change remounts the row, restarting the flash.
      const secondNode = document.querySelector('[data-message-id="msg-3"]');
      expect(secondNode).toBeTruthy();
      expect(firstNode!.isSameNode(secondNode)).toBe(false);
    });

    it('does not re-scroll on rerenders with the same highlightSeq', () => {
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(10)}
          highlightMessageId="msg-3"
          highlightSeq={1}
        />,
      );
      fakeHandle.scrollToIndex.mockClear();
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(10)}
          highlightMessageId="msg-3"
          highlightSeq={1}
        />,
      );
      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalledWith(3, { align: 'center' });
    });

    it('ignores highlight targets that are not in the loaded window', () => {
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(10)}
          highlightMessageId="not-loaded"
          highlightSeq={1}
        />,
      );
      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalledWith(
        expect.anything(),
        { align: 'center' },
      );
    });
  });

  describe('anchored mode', () => {
    it('centers on the highlightMessageId target on initial mount (double-rAF re-assert)', () => {
      const onAtBottomChange = vi.fn();
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(20)}
          mode="anchored"
          highlightMessageId="msg-10"
          highlightSeq={1}
          onAtBottomChange={onAtBottomChange}
        />,
      );
      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(10, { align: 'center' });
      // Never falls back to the normal-mode bottom jump.
      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalledWith(19, { align: 'end' });
      expect(onAtBottomChange).toHaveBeenCalledWith(false);
    });

    it('falls back to mid-list centering when no highlightMessageId is present (flash already expired)', () => {
      const onAtBottomChange = vi.fn();
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(11)}
          mode="anchored"
          onAtBottomChange={onAtBottomChange}
        />,
      );
      // 11 messages, indices 0-10 — midpoint is index 5.
      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(5, { align: 'center' });
      expect(onAtBottomChange).toHaveBeenCalledWith(false);
    });

    it('re-centers on a fresh anchor when highlightSeq bumps while already anchored', () => {
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(20)}
          mode="anchored"
          highlightMessageId="msg-10"
          highlightSeq={1}
        />,
      );
      fakeHandle.scrollToIndex.mockClear();

      // Re-anchoring to a different message (e.g. a second search-hit click)
      // swaps the underlying data window; the highlightSeq bump must still
      // re-center even though initial positioning already completed once.
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(20)}
          mode="anchored"
          highlightMessageId="msg-3"
          highlightSeq={2}
        />,
      );
      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(3, { align: 'center' });
    });

    it('re-runs positioning when mode flips from normal to anchored, even with an unchanged resetKey', () => {
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(20)}
          mode="normal"
          resetKey="ch-1"
        />,
      );
      fakeHandle.scrollToIndex.mockClear();

      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(20)}
          mode="anchored"
          resetKey="ch-1"
          highlightMessageId="msg-7"
          highlightSeq={1}
        />,
      );
      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(7, { align: 'center' });
    });

    it('does NOT stick to the bottom when a newer page appends while pinned in anchored mode', () => {
      const initial = messages(5);
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={initial}
          mode="anchored"
          hasNewer={true}
        />,
      );
      // Pin to the bottom of the currently-loaded anchored window.
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      // A newer page appends below the viewport (oldest id unchanged).
      const newer = createMessage({ id: 'newer' });
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[...initial, newer]}
          mode="anchored"
          hasNewer={true}
        />,
      );
      // No stick-to-bottom jump — would strand the reader past the loaded
      // page and cascade newer loads to the present.
      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
      // Also confirmed via `shift`: an append never sets shift (oldestId
      // unchanged), matching the existing prepend-only isPrepend contract.
      expect(capturedProps.shift).toBe(false);
    });

    it('does not set shift when a newer-page load crosses MESSAGE_MAX_PAGES and evicts the oldest page (both boundary ids change)', () => {
      // TanStack's infinite-query cap evicts from the END OPPOSITE the fetch
      // direction. Anchored newer-loads fetch via fetchPreviousPage (pages
      // prepended at the front), so at the cap the OLDEST page (the array's
      // tail) is evicted while the new newer page is added at the front —
      // same "oldestId changed AND newestId changed, length unchanged"
      // signature as the older-load prepend-at-cap case (see the sibling
      // test above in the top-level describe), but this is an append, not a
      // prepend: shift must stay false or virtua's scroll compensation would
      // fire backwards and jump the viewport.
      const initial = messages(5);
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={initial}
          mode="anchored"
          hasNewer={true}
        />,
      );
      // Pin to the bottom, as the reader typically is when a background
      // newer-page load evicts the oldest page.
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      // Same length (5): drop msg-0 (oldest, evicted), append a newer page.
      const newer = createMessage({ id: 'at-cap-newer' });
      const atCap = [...initial.slice(1), newer];
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={atCap}
          mode="anchored"
          hasNewer={true}
        />,
      );

      expect(capturedProps.shift).toBe(false);
    });

    it('does not set shift when a page-granular newer-load eviction drops several messages from the front while appending several at the back', () => {
      // TanStack's maxPages eviction is PAGE-granular, not single-message: a
      // cap-crossing anchored newer-load drops the ENTIRE oldest page (up to
      // the around-page's 50-message size), not just its first message. Here
      // a previous window of 8 has its oldest 3 messages evicted while 3
      // newer messages are appended — the new head is `prevMessages[3]`, not
      // `prevMessages[1]`, so a shift-by-one-only check misses this.
      const initial = messages(8);
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={initial}
          mode="anchored"
          hasNewer={true}
        />,
      );
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      // Drop the oldest 3 (a whole evicted page), append 3 newer (a whole
      // newly-fetched page). Length is unchanged (8), but the new head sits
      // 3 slots into the previous array, not 1.
      const newer = [
        createMessage({ id: 'at-cap-newer-1' }),
        createMessage({ id: 'at-cap-newer-2' }),
        createMessage({ id: 'at-cap-newer-3' }),
      ];
      const atCap = [...initial.slice(3), ...newer];
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={atCap}
          mode="anchored"
          hasNewer={true}
        />,
      );

      expect(capturedProps.shift).toBe(false);
    });

    it('does not set shift for a realistic 25-message-page eviction at the anchored around-page cap', () => {
      // Mirrors production dimensions: useAnchoredMessages fetches with
      // limit: 25, and the initial "around" page is 50 — so a realistic
      // newer-load-at-cap eviction drops an entire 25-message page from a
      // ~50-message loaded window.
      const initial = messages(50);
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={initial}
          mode="anchored"
          hasNewer={true}
        />,
      );
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      const newer = Array.from({ length: 25 }, (_, i) =>
        createMessage({ id: `at-cap-newer-${i}` }),
      );
      const atCap = [...initial.slice(25), ...newer];
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={atCap}
          mode="anchored"
          hasNewer={true}
        />,
      );

      expect(capturedProps.shift).toBe(false);
    });

    it('does not set shift when a partial-page eviction grows the length while still classifying as an append', () => {
      // A partial-page eviction (fewer messages evicted than appended) grows
      // `len` relative to the previous render — the classifier must not
      // require len === prevLen (or len >= prevLen in the wrong direction)
      // to still recognize this as an append, not a prepend.
      const initial = messages(8);
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={initial}
          mode="anchored"
          hasNewer={true}
        />,
      );
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      // Drop the oldest 3, append 5 newer — net length grows from 8 to 10.
      const newer = Array.from({ length: 5 }, (_, i) =>
        createMessage({ id: `at-cap-newer-${i}` }),
      );
      const atCap = [...initial.slice(3), ...newer];
      expect(atCap.length).toBe(10);
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={atCap}
          mode="anchored"
          hasNewer={true}
        />,
      );

      expect(capturedProps.shift).toBe(false);
    });

    it('still sets shift=true for a genuine older-page prepend at the cap in anchored mode (mirror of the append case above)', () => {
      // Anchored mode also supports scrolling further into history via
      // onLoadMore (older). At the cap that evicts the NEWEST page (same
      // eviction direction as normal mode) — a genuine prepend, which must
      // still set shift=true. Pins down that isCapEvictionAppend's overlap
      // check doesn't accidentally swallow this legitimate case too.
      const initial = messages(5);
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={initial}
          mode="anchored"
          hasNewer={true}
        />,
      );
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      // Same length (5): drop msg-4 (newest, evicted), prepend an older page.
      const older = createMessage({ id: 'at-cap-older' });
      const atCap = [older, ...initial.slice(0, 4)];
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={atCap}
          mode="anchored"
          hasNewer={true}
        />,
      );

      expect(capturedProps.shift).toBe(true);
    });

    it('triggers onLoadNewer when the visible end index nears the bottom of the loaded window', () => {
      const onLoadNewer = vi.fn().mockResolvedValue(undefined);
      fakeHandle.findItemIndex = vi
        .fn()
        .mockReturnValueOnce(30) // start
        .mockReturnValueOnce(48); // end — near the last index (49)
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(50)}
          mode="anchored"
          hasNewer={true}
          isLoadingNewer={false}
          onLoadNewer={onLoadNewer}
        />,
      );
      act(() => capturedProps.onScroll?.(900));
      expect(onLoadNewer).toHaveBeenCalledTimes(1);
    });

    it('does not trigger onLoadNewer when hasNewer is false', () => {
      const onLoadNewer = vi.fn().mockResolvedValue(undefined);
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(49);
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(50)}
          mode="anchored"
          hasNewer={false}
          onLoadNewer={onLoadNewer}
        />,
      );
      act(() => capturedProps.onScroll?.(900));
      expect(onLoadNewer).not.toHaveBeenCalled();
    });

    it('does not trigger onLoadNewer when isLoadingNewer is true', () => {
      const onLoadNewer = vi.fn().mockResolvedValue(undefined);
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(49);
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(50)}
          mode="anchored"
          hasNewer={true}
          isLoadingNewer={true}
          onLoadNewer={onLoadNewer}
        />,
      );
      act(() => capturedProps.onScroll?.(900));
      expect(onLoadNewer).not.toHaveBeenCalled();
    });

    it('does not trigger onLoadNewer when far from the bottom of the loaded window', () => {
      const onLoadNewer = vi.fn().mockResolvedValue(undefined);
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(15); // far from end (49)
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(50)}
          mode="anchored"
          hasNewer={true}
          onLoadNewer={onLoadNewer}
        />,
      );
      act(() => capturedProps.onScroll?.(300));
      expect(onLoadNewer).not.toHaveBeenCalled();
    });

    it('does not trigger onLoadNewer in normal mode even if hasNewer/onLoadNewer are (incorrectly) supplied', () => {
      const onLoadNewer = vi.fn().mockResolvedValue(undefined);
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(30).mockReturnValueOnce(49);
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(50)}
          mode="normal"
          hasNewer={true}
          onLoadNewer={onLoadNewer}
        />,
      );
      act(() => capturedProps.onScroll?.(900));
      expect(onLoadNewer).not.toHaveBeenCalled();
    });
  });

  describe('loading skeletons', () => {
    it('shows top skeletons while isLoadingMore is true', () => {
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(5)}
          isLoadingMore={true}
        />,
      );
      expect(screen.getAllByTestId('message-skeleton').length).toBe(3);
    });

    it('shows bottom skeletons while isLoadingNewer is true (anchored mode)', () => {
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(5)}
          mode="anchored"
          isLoadingNewer={true}
        />,
      );
      expect(screen.getAllByTestId('message-skeleton').length).toBe(3);
    });

    it('shows both top and bottom skeletons when both are loading', () => {
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(5)}
          mode="anchored"
          isLoadingMore={true}
          isLoadingNewer={true}
        />,
      );
      expect(screen.getAllByTestId('message-skeleton').length).toBe(6);
    });

    it('shows no skeletons when neither is loading', () => {
      render(<VirtualMessageList {...baseProps} orderedMessages={messages(5)} />);
      expect(screen.queryByTestId('message-skeleton')).not.toBeInTheDocument();
    });
  });

  describe('context type', () => {
    it('passes the dm context type to messages when directMessageGroupId is set', () => {
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(1)}
          directMessageGroupId="dm-group-1"
        />,
      );
      expect(screen.getByTestId('msg-msg-0')).toHaveAttribute('data-context-type', 'dm');
    });

    it('passes the channel context type by default', () => {
      render(<VirtualMessageList {...baseProps} orderedMessages={messages(1)} />);
      expect(screen.getByTestId('msg-msg-0')).toHaveAttribute('data-context-type', 'channel');
    });
  });

  // Read tracking is fed from the visible range, which was only ever reported
  // from virtua's onScroll. A conversation short enough to fit the viewport
  // never scrolls (scrolling to the last row is a no-op), so it was never
  // marked read.
  describe('visible range when the whole list fits (no scroll event)', () => {
    // virtua's scrollSize is max(content, viewport), so "fits" means equal.
    const fitting = () => makeHandle({ scrollSize: 400, viewportSize: 400 });

    it('reports the whole list as visible on mount when it fits the viewport', () => {
      fakeHandle = fitting();
      const onVisibleRangeChange = vi.fn();
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(3)}
          onVisibleRangeChange={onVisibleRangeChange}
        />,
      );
      expect(onVisibleRangeChange).toHaveBeenCalledWith(0, 2);
    });

    it('does not report before virtua has measured the viewport', () => {
      fakeHandle = makeHandle({ scrollSize: 0, viewportSize: 0 });
      const onVisibleRangeChange = vi.fn();
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(3)}
          onVisibleRangeChange={onVisibleRangeChange}
        />,
      );
      expect(onVisibleRangeChange).not.toHaveBeenCalled();
    });

    it('reports once the rows are measured and turn out to fit', () => {
      installFakeResizeObserver();
      fakeHandle = makeHandle({ scrollSize: 0, viewportSize: 0 });
      const onVisibleRangeChange = vi.fn();
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(3)}
          onVisibleRangeChange={onVisibleRangeChange}
        />,
      );
      expect(onVisibleRangeChange).not.toHaveBeenCalled();

      // virtua measures the viewport and the rows; the rows' first
      // ResizeObserver notifications follow.
      fakeHandle.viewportSize = 400;
      fakeHandle.scrollSize = 400;
      resizeRows({ 'msg-0': 60, 'msg-1': 60, 'msg-2': 84 });

      expect(onVisibleRangeChange).toHaveBeenCalledWith(0, 2);
    });

    it('reports the new newest message when one arrives while the list still fits', () => {
      installFakeResizeObserver();
      fakeHandle = fitting();
      const onVisibleRangeChange = vi.fn();
      const initial = messages(3);
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={initial}
          onVisibleRangeChange={onVisibleRangeChange}
        />,
      );
      onVisibleRangeChange.mockClear();

      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[...initial, createMessage({ id: 'newer' })]}
          onVisibleRangeChange={onVisibleRangeChange}
        />,
      );
      // The new row mounts and is measured.
      resizeRows({ newer: 60 });

      expect(onVisibleRangeChange).toHaveBeenLastCalledWith(0, 3);
    });

    it('reports to a new callback (e.g. the socket connected after mount)', () => {
      fakeHandle = fitting();
      const first = vi.fn();
      const { rerender } = render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(3)}
          onVisibleRangeChange={first}
        />,
      );
      const second = vi.fn();
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(3)}
          onVisibleRangeChange={second}
        />,
      );
      expect(second).toHaveBeenCalledWith(0, 2);
    });

    it('leaves an overflowing list to the scroll path (no report without a scroll)', () => {
      installFakeResizeObserver();
      // Default handle: 1000px of content in a 400px viewport.
      const onVisibleRangeChange = vi.fn();
      render(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={messages(50)}
          onVisibleRangeChange={onVisibleRangeChange}
        />,
      );
      resizeRows({ 'msg-48': 60, 'msg-49': 60 });
      expect(onVisibleRangeChange).not.toHaveBeenCalled();

      // Scrolling still reports, as before.
      fakeHandle.findItemIndex = vi.fn().mockReturnValueOnce(40).mockReturnValueOnce(49);
      act(() => capturedProps.onScroll?.(600));
      expect(onVisibleRangeChange).toHaveBeenCalledWith(40, 49);
    });
  });

  // virtua keeps the scroll position when a row resizes (it only compensates
  // for rows above the viewport), so a row in view that grows pushes the
  // bottom of the list below the fold: a reaction added to the newest
  // message, an image or GIF finishing loading, a link preview expanding.
  describe('stays pinned when a rendered row grows', () => {
    const renderPinned = (props: Partial<React.ComponentProps<typeof VirtualMessageList>> = {}) => {
      installFakeResizeObserver();
      const utils = render(
        <VirtualMessageList {...baseProps} orderedMessages={messages(5)} {...props} />,
      );
      // First measurement of the rendered rows.
      resizeRows({ 'msg-2': 60, 'msg-3': 60, 'msg-4': 60 });
      return utils;
    };
    const bottomScrolls = () =>
      fakeHandle.scrollToIndex.mock.calls.filter(
        ([index, opts]) => index === 4 && (opts as { align?: string })?.align === 'end',
      );

    it('scrolls back to the bottom when the newest row grows while pinned (reaction added)', () => {
      renderPinned();
      act(() => capturedProps.onScroll?.(600)); // at the bottom → pinned
      fakeHandle.scrollToIndex.mockClear();

      resizeRows({ 'msg-4': 96 });

      expect(bottomScrolls()).toHaveLength(1);
    });

    it('also when an earlier row in view grows (an image finishing loading)', () => {
      renderPinned();
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      resizeRows({ 'msg-3': 300 });

      expect(bottomScrolls()).toHaveLength(1);
    });

    it("does not scroll for a row's first measurement (a row mounting is not growth)", () => {
      installFakeResizeObserver();
      render(<VirtualMessageList {...baseProps} orderedMessages={messages(5)} />);
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      resizeRows({ 'msg-3': 60, 'msg-4': 60 });

      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
    });

    it('does not jump when the reader has scrolled up', () => {
      renderPinned();
      act(() => capturedProps.onScroll?.(100)); // 500px from the bottom
      fakeHandle.scrollToIndex.mockClear();

      resizeRows({ 'msg-4': 96 });

      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
    });

    it('does not scroll when a row shrinks (the browser keeps a pinned list at the bottom)', () => {
      renderPinned();
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      resizeRows({ 'msg-4': 40 });

      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
    });

    it('does not scroll in anchored mode (stick-to-bottom is normal mode only)', () => {
      renderPinned({ mode: 'anchored' });
      act(() => capturedProps.onScroll?.(600));
      fakeHandle.scrollToIndex.mockClear();

      resizeRows({ 'msg-4': 96 });

      expect(fakeHandle.scrollToIndex).not.toHaveBeenCalled();
    });

    it('keeps following the newest row after a new message arrives', () => {
      const initial = messages(5);
      installFakeResizeObserver();
      const { rerender } = render(
        <VirtualMessageList {...baseProps} orderedMessages={initial} />,
      );
      resizeRows({ 'msg-4': 60 });
      act(() => capturedProps.onScroll?.(600));
      rerender(
        <VirtualMessageList
          {...baseProps}
          orderedMessages={[...initial, createMessage({ id: 'newer' })]}
        />,
      );
      resizeRows({ newer: 60 });
      fakeHandle.scrollToIndex.mockClear();

      resizeRows({ newer: 400 }); // its GIF loads

      expect(fakeHandle.scrollToIndex).toHaveBeenCalledWith(5, { align: 'end' });
    });
  });
});
