import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";

interface UseBidirectionalScrollOptions {
  messages: { id: string }[];
  mode: 'normal' | 'anchored';
  highlightMessageId?: string;
  /** Sequence counter — increments on every jump request so re-clicks to the same message trigger a new scroll. */
  highlightSeq?: number;

  // Older pagination
  onLoadMore?: () => Promise<void>;
  isLoadingMore: boolean;
  continuationToken?: string;

  // Newer pagination (anchored mode)
  onLoadNewer?: () => Promise<void>;
  isLoadingNewer?: boolean;
  hasNewer?: boolean;
}

/**
 * Manages bidirectional infinite scroll for a column-reverse message list.
 *
 * Handles:
 * - IntersectionObserver sentinels for older (top) and newer (bottom) pagination
 * - Scroll stabilization when newer messages are prepended in anchored mode
 * - Scroll-to-highlight for jump-to-message
 * - Newer-load suppression until initial highlight scroll completes
 */
export const useBidirectionalScroll = ({
  messages,
  mode,
  highlightMessageId,
  highlightSeq = 0,
  onLoadMore,
  isLoadingMore,
  continuationToken,
  onLoadNewer,
  isLoadingNewer,
  hasNewer,
}: UseBidirectionalScrollOptions) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [atBottom, setAtBottom] = useState(true);

  // Suppresses onLoadNewer until the initial scroll-to-highlight completes.
  // Without this, column-reverse starts at scrollTop=0 (visual bottom), making
  // the bottom sentinel visible on first render and triggering cascading loads.
  const newerLoadSuppressedRef = useRef(false);

  // Single ref for all pagination state — keeps IntersectionObservers stable.
  // Without this, observers would be recreated on every loading/token change,
  // and each recreation fires a fresh initial callback that re-triggers loading.
  const paginationRef = useRef({ onLoadMore, isLoadingMore, continuationToken, onLoadNewer, isLoadingNewer, hasNewer });
  paginationRef.current = { onLoadMore, isLoadingMore, continuationToken, onLoadNewer, isLoadingNewer, hasNewer };

  const hasMessages = messages.length > 0;

  // Bottom sentinel: first in DOM = visual bottom in column-reverse.
  // Tracks atBottom state; in anchored mode also triggers newer message loading.
  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setAtBottom(entry.isIntersecting);
        const p = paginationRef.current;
        if (
          entry.isIntersecting &&
          mode === 'anchored' &&
          p.onLoadNewer &&
          !p.isLoadingNewer &&
          p.hasNewer &&
          !newerLoadSuppressedRef.current
        ) {
          p.onLoadNewer();
        }
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMessages, mode]);

  // Top sentinel: last in DOM = visual top in column-reverse.
  // Triggers older message loading.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const p = paginationRef.current;
        if (entry.isIntersecting && !p.isLoadingMore && p.continuationToken && p.onLoadMore) {
          p.onLoadMore();
        }
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMessages]);

  // Stabilize scroll when newer messages are prepended in anchored mode.
  // In column-reverse, newer messages appear at the visual bottom (DOM start).
  // Without adjustment, the viewport jumps. Shifting scrollTop by the height
  // delta keeps the user's current view stable.
  const prevScrollHeightRef = useRef(0);
  const prevFirstMsgIdRef = useRef<string | undefined>();
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length === 0) return;

    const firstMsgId = messages[0]?.id;
    const currentScrollHeight = container.scrollHeight;
    const prevScrollHeight = prevScrollHeightRef.current;

    if (
      mode === 'anchored' &&
      prevFirstMsgIdRef.current &&
      firstMsgId !== prevFirstMsgIdRef.current &&
      prevScrollHeight > 0 &&
      currentScrollHeight > prevScrollHeight
    ) {
      const delta = currentScrollHeight - prevScrollHeight;
      container.scrollTop -= delta;
    }

    prevScrollHeightRef.current = currentScrollHeight;
    prevFirstMsgIdRef.current = firstMsgId;
  }, [messages, mode]);

  // Suppress onLoadNewer when entering anchored mode, until scroll-to-highlight completes
  useEffect(() => {
    newerLoadSuppressedRef.current = mode === 'anchored' && !!highlightMessageId;
  }, [mode, highlightMessageId]);

  // Scroll to highlighted message (once per highlightSeq).
  // Uses a seq counter instead of message ID so re-clicks to the same message
  // always trigger a new scroll. Avoids re-scrolling on pagination re-renders.
  const lastScrolledSeqRef = useRef(0);
  useEffect(() => {
    if (!highlightMessageId || highlightSeq <= lastScrolledSeqRef.current) {
      return;
    }
    if (messages.length > 0) {
      const el = messageRefs.current.get(highlightMessageId);
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "center" });
        lastScrolledSeqRef.current = highlightSeq;
        // Allow onLoadNewer after the browser processes the scroll
        requestAnimationFrame(() => {
          newerLoadSuppressedRef.current = false;
        });
      }
    }
  }, [highlightMessageId, highlightSeq, messages]);

  // scrollTop=0 is visual bottom in column-reverse
  const scrollToBottom = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return {
    scrollContainerRef,
    bottomSentinelRef,
    topSentinelRef,
    messageRefs,
    atBottom,
    scrollToBottom,
  };
};
