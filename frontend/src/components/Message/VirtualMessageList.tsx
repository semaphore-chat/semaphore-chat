import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Box } from "@mui/material";
import { VList, type VListHandle } from "virtua";
import MessageComponent from "./MessageComponent";
import MessageSkeleton from "./MessageSkeleton";
import { UnreadMessageDivider } from "./UnreadMessageDivider";
import { DaySeparator } from "./DaySeparator";
import { dayMarkers, shouldGroupWithPrevious } from "../../utils/messageGrouping";
import type { Message } from "../../types/message.type";
import { VoiceSessionType } from "../../contexts/VoiceContext";
import { TYPING_INDICATOR_HEIGHT } from "../../constants/layout";

/** How close to the top (in item indices) triggers an older-page load. */
const LOAD_MORE_INDEX_PROXIMITY = 8;
/** How close to the end (in item indices) triggers a newer-page load (anchored mode). */
const LOAD_NEWER_INDEX_PROXIMITY = 8;
/** Distance from the bottom (px) within which the list is considered pinned. */
const BOTTOM_PIN_THRESHOLD_PX = 40;
/**
 * Previous-array prefix scanned by the cap-eviction disambiguation
 * (`isCapEvictionAppend`): one more than the 50-message anchored "around"
 * page (useAnchoredMessages), the largest page a maxPages eviction can drop —
 * so a full-page eviction's new head, at previous index 50, is still covered.
 * Keep in sync with the anchored page sizes if they ever change.
 */
const CAP_EVICTION_SCAN_PREFIX = 51;

export interface VirtualMessageListHandle {
  scrollToBottom: () => void;
}

export interface VirtualMessageListProps {
  /** Messages in chronological (oldest-first) render order. */
  orderedMessages: Message[];
  authorId: string;

  /** 'anchored' disables stick-to-bottom and centers on the jump target instead of homing to the bottom. */
  mode?: 'normal' | 'anchored';

  // Older pagination
  isLoadingMore: boolean;
  continuationToken?: string;
  onLoadMore?: () => Promise<void>;

  // Newer pagination (anchored mode)
  onLoadNewer?: () => Promise<void>;
  isLoadingNewer?: boolean;
  hasNewer?: boolean;

  // Unread divider
  unreadCount: number;
  lastReadIndex: number;

  // Search highlight / anchored jump target
  highlightMessageId?: string;
  highlightSeq?: number;

  // Thread / reply handling
  contextId?: string;
  communityId?: string;
  directMessageGroupId?: string;
  onOpenThread?: (message: Message) => void;
  onQuoteReply?: (message: Message) => void;

  /** Changing this (channel/DM switch) re-homes the list at the bottom (or centers, in anchored mode). */
  resetKey?: string;

  /** Reports whether the list is pinned to the visual bottom (drives FABs). */
  onAtBottomChange?: (atBottom: boolean) => void;

  /**
   * Reports the currently visible item index range [start, end] on scroll,
   * and — since a list that fits the viewport never scrolls — the whole
   * range whenever such a list is measured or changes.
   * Consumed by read-tracking (fed to markAsRead) in MessageContainer.
   */
  onVisibleRangeChange?: (startIndex: number, endIndex: number) => void;

  /** Escape (pressed while a row has roving focus, no menu open) returns
   * focus to the message composer — implemented by the caller since the
   * composer lives outside this component. */
  onEscapeToInput?: () => void;
}

/**
 * Virtualized message list built on virtua's {@link VList}.
 *
 * virtua owns the scroll container and scroll position — the single renderer
 * for both normal and anchored (jump-to-message) modes. Key wiring:
 *
 * - **Prepend without a jump**: `shift` is set true on the render where an older
 *   page prepends (oldest id changes + length grows), so virtua maintains the
 *   position from the end instead of the start. Newer-page appends (anchored
 *   mode) change the newest id but not the oldest in the common case, so they
 *   never set `shift` — appending below the viewport needs no index-shift
 *   compensation. At the MESSAGE_MAX_PAGES cap, a newer-page append DOES also
 *   change the oldest id (a whole oldest page — up to 50 messages — is
 *   evicted, page-granular, not just its first message), producing the same
 *   oldest-id-changed signature as an older-page prepend-at-cap —
 *   disambiguated via bounded-prefix content membership (`isCapEvictionAppend`,
 *   next to `isPrepend`'s definition) so `shift` still stays false for the
 *   append.
 * - **Older pagination**: near the top of the visible range, `onLoadMore` fires.
 * - **Newer pagination (anchored)**: near the end of the visible range,
 *   `onLoadNewer` fires (mirrors the older-load trigger; in-flight-guarded).
 * - **Stick-to-bottom**: normal mode only — a newer message appending while
 *   pinned scrolls to the last item. Disabled in anchored mode (a newer page
 *   landing below the viewport must not yank the reader off their spot — see
 *   the stick-to-bottom effect below for the full rationale) and, for normal
 *   mode, effectively never fires while detached from the live edge either:
 *   the query layer (messageCacheUpdaters) never appends to a detached
 *   window, so `newestId` cannot change until a reset — no separate gate
 *   needed here.
 * - **Anchored initial centering**: the highlightMessageId/highlightSeq jump
 *   effect (also used for in-window normal-mode jumps) is the mechanism that
 *   centers on the anchor target — anchored sessions always start from a
 *   URL-driven jump, so a target is present in the common case. It also
 *   naturally covers re-anchoring to a different message while already
 *   anchored (a fresh highlightSeq bump), since it isn't gated on
 *   "first positioning only" the way the initial-positioning effect is.
 *   Both positioning paths use the double-rAF re-assert pattern (a single
 *   rAF races virtua's measurement readiness on first mount).
 * - **atBottom**: derived from virtua's scroll offset, reported upward for FABs.
 * - **Visible range without scrolling**: read tracking is fed from the
 *   visible range, which virtua only reports through `onScroll`. A list short
 *   enough to fit the viewport never scrolls (scrolling to its last row is a
 *   no-op), so it would never be marked read. While the content fits, the
 *   whole range [0, len - 1] is reported instead whenever the rendered rows
 *   are measured or resized (a ResizeObserver on our own row elements: this
 *   covers opening the conversation, a new message arriving, a context
 *   switch) and whenever the consumer's callback changes (e.g. the socket
 *   connecting after mount). An overflowing list is left to `onScroll`.
 * - **Typing-indicator spacer**: the "X is typing..." line (TypingIndicator)
 *   floats over the bottom of this list, so the newest row carries a
 *   permanent `TYPING_INDICATOR_HEIGHT` spacer (always present, so no layout
 *   shift when typing starts or stops). It lives INSIDE the last row rather
 *   than as an extra VList item: virtua measures it as part of that row, so
 *   every `scrollToIndex(len - 1, { align: "end" })` (initial positioning,
 *   stick-to-bottom, scrollToBottom) lands at the true bottom, and item
 *   indices stay 1:1 with messages (visible-range read tracking, the
 *   load-newer proximity check, roving focus and day markers are unaffected).
 *
 * **Roving row focus**: exactly one row is in the natural Tab order at a
 * time (`focusedRowKey`, tracked by row identity — `clientId ?? id` — so it
 * survives prepends/appends/the optimistic id-swap without any manual index
 * shifting). ArrowUp/Down/Home/End move it; the target index is resolved to
 * a message, `scrollToIndex` brings it into virtua's real render window, and
 * a short rAF-retry loop focuses the row once it actually mounts. virtua's
 * `keepMounted` was investigated as an alternative and rejected: items kept
 * mounted outside the true visible window are rendered with
 * `visibility: hidden` (see virtua's Virtualizer item wrapper), and
 * hidden elements are not part of the focus order in any browser — so
 * `keepMounted` preserves component state across scroll but cannot itself
 * hold focus. Scrolling the target into the *real* window first is the only
 * way to land focus on it, which is what `moveFocus` below does. Concurrent
 * calls (a second arrow-key press before the first target has mounted) are
 * resolved by a supersession token so only the LATEST call's loop can ever
 * apply `.focus()` — see `moveFocus`'s own doc comment for the mechanism.
 *
 * Re-render note (pre-existing class, not introduced by this feature):
 * `MessageContainer`'s `useMessageListAnnouncer` batch-flush calls
 * `setAnnouncement`, which — like every other piece of state this
 * component's parent already owns (`atBottom`, loading flags, etc.) —
 * re-renders `MessageContainer` and cascades a re-render of this
 * (non-memoized) `VirtualMessageList`. That's harmless here: `orderedMessages`
 * keeps its memoized reference, virtua's own diffing is cheap, and every row
 * (`MessageComponent`) is wrapped in `React.memo` with an explicit
 * comparator, so the cascade stops there without re-rendering the list body.
 * Same category of re-render this component has always tolerated from its
 * parent; not a new performance concern from the announcer.
 */
const VirtualMessageList = forwardRef<VirtualMessageListHandle, VirtualMessageListProps>(
  (
    {
      orderedMessages,
      authorId,
      mode = 'normal',
      isLoadingMore,
      continuationToken,
      onLoadMore,
      onLoadNewer,
      isLoadingNewer,
      hasNewer,
      unreadCount,
      lastReadIndex,
      highlightMessageId,
      highlightSeq,
      contextId,
      communityId,
      directMessageGroupId,
      onOpenThread,
      onQuoteReply,
      resetKey,
      onAtBottomChange,
      onVisibleRangeChange,
      onEscapeToInput,
    },
    ref,
  ) => {
    const vlistRef = useRef<VListHandle>(null);
    const listContainerRef = useRef<HTMLDivElement>(null);
    const pinnedRef = useRef(true);
    const initialPositionedRef = useRef(false);

    // Prepend detection: compare against the previous render's first/length.
    const prevOldestIdRef = useRef<string | undefined>(undefined);
    const prevLenRef = useRef(0);
    const prevNewestIdRef = useRef<string | undefined>(undefined);
    // Previous render's full array — a bounded prefix (up to 51 elements) is
    // read, to disambiguate the at-cap case below (see isCapEvictionAppend).
    const prevMessagesRef = useRef<typeof orderedMessages>([]);

    const len = orderedMessages.length;
    const oldestId = orderedMessages[0]?.id;
    const newestId = orderedMessages[len - 1]?.id;

    // ── Roving row focus ──────────────────────────────────────────────
    // Tracked by row identity (matches the `rowKey` used below) rather than
    // a raw array index, so it survives prepends/appends/the optimistic
    // id-swap without any manual index-shifting.
    const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
    const focusedIndex = useMemo(() => {
      if (focusedRowKey === null) return -1;
      return orderedMessages.findIndex(
        (m) => (m.clientId ?? m.id) === focusedRowKey,
      );
    }, [orderedMessages, focusedRowKey]);

    // Latest-value refs so the stable callbacks below (moveFocus, row
    // key/focus delegates) never need `orderedMessages`/`len` in their own
    // dependency arrays — keeps their identities stable across renders,
    // which matters since they're passed straight through to a
    // React.memo'd child (MessageComponent).
    const orderedMessagesRef = useRef(orderedMessages);
    orderedMessagesRef.current = orderedMessages;
    const onEscapeToInputRef = useRef(onEscapeToInput);
    onEscapeToInputRef.current = onEscapeToInput;

    // moveFocus's rAF-retry supersession (see moveFocus's doc comment):
    // `focusRequestSeqRef` is bumped once per moveFocus call and captured by
    // that call's retry closure; `pendingFocusRafRef` tracks the currently
    // in-flight frame id so it can be cancelled outright (superseded by a
    // newer moveFocus call, or the component unmounting) rather than left to
    // self-abort on its own next tick.
    const focusRequestSeqRef = useRef(0);
    const pendingFocusRafRef = useRef(0);
    const cancelPendingFocusRaf = () => {
      if (pendingFocusRafRef.current) {
        cancelAnimationFrame(pendingFocusRafRef.current);
        pendingFocusRafRef.current = 0;
      }
    };

    // Default/fallback roving target: whenever `focusedRowKey` is unset
    // (initial mount), or no longer resolves to a loaded row (context/mode
    // switch swapped the data window entirely, the row was deleted, or it
    // was evicted at the pagination cap), fall back to a sensible default —
    // the newest row in normal mode, the centered row in anchored mode
    // (mirroring the initial-positioning effect above). This is a *pure*
    // derived value (useMemo, not an effect + setState): it only decides
    // what's DISPLAYED as the tabIndex=0 row this render. It deliberately
    // does not write the fallback back into `focusedRowKey` state — the
    // first genuine navigation (moveFocus/handleRowFocus) does that. An
    // earlier version computed this via an effect that called setState,
    // which scheduled an extra render on every eviction/context-switch;
    // since `isPrepend`'s baseline ref updates unconditionally after every
    // commit (not just "real" ones), that extra render re-derived
    // `isPrepend` against an already-advanced baseline and silently
    // flipped `shift` back to false one render after virtua needed to see
    // it true — corrupting the prepend/cap-eviction scroll-compensation
    // tests. A pure fallback avoids the extra render entirely.
    const effectiveFocusedIndex = useMemo(() => {
      if (focusedIndex !== -1) return focusedIndex;
      if (len === 0) return -1;
      return mode === 'anchored' ? Math.max(0, Math.floor((len - 1) / 2)) : len - 1;
    }, [focusedIndex, len, mode]);

    /** Moves the roving target to `rawIndex` (clamped), scrolls it into
     * virtua's real render window, and imperatively focuses it once it
     * mounts (retried across a few animation frames — see the module doc
     * comment for why `keepMounted` alone can't do this).
     *
     * Each call spawns its own rAF-retry loop, and a fast second call
     * (another arrow-key press before the first loop's target has mounted)
     * would otherwise leave two independent loops running concurrently —
     * whichever's frame happens to fire LAST wins `.focus()`, which can
     * silently apply a stale, superseded target over the real current one.
     * Guarded with a supersession token (`focusRequestSeqRef`): each call
     * claims the next seq, and the retry closure aborts (no focus, no
     * further reschedule) the moment it observes a newer claim — that seq
     * guard alone is what guarantees only the latest call's loop can act.
     * The in-flight frame id is additionally tracked (`pendingFocusRafRef`)
     * so a superseded or unmounting loop is also cancelled outright rather
     * than left to self-abort on its next tick. */
    const moveFocus = useCallback((rawIndex: number) => {
      const messages = orderedMessagesRef.current;
      const targetLen = messages.length;
      if (targetLen === 0) return;
      const targetIndex = Math.max(0, Math.min(rawIndex, targetLen - 1));
      const targetMessage = messages[targetIndex];
      if (!targetMessage) return;

      setFocusedRowKey(targetMessage.clientId ?? targetMessage.id);
      vlistRef.current?.scrollToIndex(targetIndex, { align: 'nearest' });

      // Cancel any still-pending retry loop from a prior moveFocus call
      // before starting this one, and claim a fresh seq so that loop's
      // closure (if its frame is already mid-flight) recognizes it's stale.
      cancelPendingFocusRaf();
      const seq = ++focusRequestSeqRef.current;

      let attempts = 0;
      const tryFocus = () => {
        // Superseded by a newer moveFocus call (or a context/mode switch or
        // unmount — both also bump the seq)? Abort silently: no focus, no
        // reschedule. Checked BEFORE touching `pendingFocusRafRef`, so a
        // stale frame that slipped past cancellation can never zero the ref
        // while it holds the LIVE loop's pending frame id (which would
        // orphan that frame from the unmount cleanup). Correctness rests on
        // this seq guard alone; the cancelAnimationFrame calls are an
        // optimization that stops stale frames from firing at all.
        if (seq !== focusRequestSeqRef.current) return;
        pendingFocusRafRef.current = 0;
        const root = listContainerRef.current;
        if (root) {
          const rows = root.querySelectorAll<HTMLElement>('[data-message-id]');
          for (const row of rows) {
            if (row.dataset.messageId === targetMessage.id) {
              const focusTarget = row.querySelector<HTMLElement>(
                '[data-row-focus-target]',
              );
              if (focusTarget) {
                focusTarget.focus();
                return;
              }
              break;
            }
          }
        }
        attempts += 1;
        if (attempts < 12) {
          pendingFocusRafRef.current = requestAnimationFrame(tryFocus);
        }
      };
      pendingFocusRafRef.current = requestAnimationFrame(tryFocus);
    }, []);

    const handleRowKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>, index: number) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            moveFocus(index + 1);
            break;
          case 'ArrowUp':
            event.preventDefault();
            moveFocus(index - 1);
            break;
          case 'Home':
            event.preventDefault();
            moveFocus(0);
            break;
          case 'End':
            event.preventDefault();
            moveFocus(orderedMessagesRef.current.length - 1);
            break;
          case 'Escape':
            event.preventDefault();
            onEscapeToInputRef.current?.();
            break;
          default:
            break;
        }
      },
      [moveFocus],
    );

    const handleRowFocus = useCallback((index: number) => {
      const message = orderedMessagesRef.current[index];
      if (!message) return;
      setFocusedRowKey(message.clientId ?? message.id);
    }, []);

    // At MESSAGE_MAX_PAGES, TanStack evicts pages from the end OPPOSITE the
    // fetch direction, and eviction is PAGE-granular (an entire page — up to
    // the around-page's 50-message size — is dropped at once, not a single
    // message). In normal mode there is only one fetch direction (older), so
    // an older-page load that crosses the cap always evicts the newest page
    // — "oldestId changed" unambiguously means a prepend there.
    //
    // Anchored mode fetches BOTH directions, so that same id-change
    // signature is ambiguous: a newer-page load crossing the cap evicts the
    // OLDEST page (newer pages are prepended to the query's page array via
    // fetchPreviousPage, and TanStack drops from the opposite/tail end) —
    // this is an append, not a prepend, even though oldestId changes exactly
    // like the genuine prepend-at-cap case. Pure id/length comparison can't
    // tell them apart; only content overlap can — and since eviction is
    // page-granular, the new head can land anywhere in the previous array's
    // first ~50 elements, not just its second element.
    //
    // Distinguish via bounded membership: a genuine append-at-cap's new head
    // id always already existed somewhere in the previous array (it's just
    // the previous array with its evicted prefix removed and a new page
    // appended), so it's found within `prevMessages.slice(0, 51)` (51 =
    // one more than the 50-message max page size, so a full-page eviction's
    // new head — at previous index 50 — is still covered). A genuine
    // prepend-at-cap's new head is always a brand-new id from a
    // never-before-loaded page, so it can never satisfy this membership
    // check. This holds regardless of length — a partial-page eviction
    // (fewer messages evicted than appended) grows `len`, but the new head's
    // previous-array membership is unaffected by that.
    const prevMessages = prevMessagesRef.current;
    const isCapEvictionAppend =
      oldestId !== undefined &&
      prevMessages
        .slice(0, CAP_EVICTION_SCAN_PREFIX)
        .some((message) => message.id === oldestId);

    // True on the render immediately after an older page prepended at the start.
    // At the MESSAGE_MAX_PAGES cap, a prepend adds an older page but evicts the
    // newest page, so `len` stays unchanged — we can't require `len > prevLen`.
    // Instead require `len >= prevLen` (deleting only the oldest message shrinks
    // `len` and is correctly excluded) alongside a defined previous oldest id
    // (guards the context-switch reset, where it's `undefined`) that changed.
    // Anchored-mode newer-page appends leave `oldestId` untouched in the
    // common case, so they are correctly excluded from this too. At the cap
    // they DO change `oldestId` (see isCapEvictionAppend above) — excluded
    // explicitly, since that's an append wearing the prepend's id signature.
    const isPrepend =
      prevOldestIdRef.current !== undefined &&
      oldestId !== prevOldestIdRef.current &&
      len >= prevLenRef.current &&
      !isCapEvictionAppend;

    const scrollToBottom = useCallback(() => {
      const handle = vlistRef.current;
      if (!handle || len === 0) return;
      handle.scrollToIndex(len - 1, { align: "end" });
    }, [len]);

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

    // ── Visible range while the whole list fits (see the module doc) ──
    const onVisibleRangeChangeRef = useRef(onVisibleRangeChange);
    onVisibleRangeChangeRef.current = onVisibleRangeChange;

    /** Reports [0, len - 1] when every row fits the viewport, where no
     * scroll event will ever report it. Waits for virtua to measure the
     * viewport; virtua's scrollSize is max(content, viewport), so the content
     * fits exactly when the two are equal. */
    const reportRangeIfFits = useCallback(() => {
      const handle = vlistRef.current;
      const report = onVisibleRangeChangeRef.current;
      const count = orderedMessagesRef.current.length;
      if (!handle || !report || count === 0) return;
      const { scrollSize, viewportSize } = handle;
      if (viewportSize <= 0 || scrollSize - viewportSize >= 1) return;
      report(0, count - 1);
    }, []);

    // One ResizeObserver for the rendered rows: our own row elements,
    // attached through `observeRow` as virtua mounts them (their first
    // notification is the initial measurement). Created in a layout effect,
    // after virtua created its own observer during its child layout effects,
    // so within a delivery virtua has already recorded the new sizes by the
    // time this one runs (observers are notified in creation order).
    const rowObserverRef = useRef<ResizeObserver | null>(null);
    useLayoutEffect(() => {
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => {
        reportRangeIfFits();
      });
      rowObserverRef.current = observer;
      // Rows that mounted before the observer existed.
      listContainerRef.current
        ?.querySelectorAll("[data-message-id]")
        .forEach((row) => observer.observe(row));
      return () => {
        observer.disconnect();
        rowObserverRef.current = null;
      };
    }, [reportRangeIfFits]);

    const observeRow = useCallback((row: HTMLDivElement | null) => {
      const observer = rowObserverRef.current;
      if (!row || !observer) return;
      observer.observe(row);
      return () => observer.unobserve(row);
    }, []);

    // A new consumer callback (markAsRead is re-created when the socket
    // connects or read tracking is enabled) gets the current range too.
    useEffect(() => {
      reportRangeIfFits();
    }, [onVisibleRangeChange, reportRangeIfFits]);

    // Pending positioning frames (initial positioning AND the highlight/anchor
    // jump below share this — they're mutually exclusive in any given commit).
    // Kept in a ref and cancelled only on unmount, context switch, or mode
    // change — NOT when `len` changes: a prepend can land between scheduling
    // and the frame firing (the anchor-restore case is exactly when the user
    // is near the top), and cancelling then would drop the positioning entirely.
    const positioningRafsRef = useRef<[number, number]>([0, 0]);
    const cancelPositioningRafs = () => {
      cancelAnimationFrame(positioningRafsRef.current[0]);
      cancelAnimationFrame(positioningRafsRef.current[1]);
      positioningRafsRef.current = [0, 0];
    };

    // Guards older-page loads between the call and the next render with
    // isLoadingMore=true (scroll events can arrive faster than React commits).
    const loadOlderInFlightRef = useRef(false);
    // Same, for newer-page loads (anchored mode).
    const loadNewerInFlightRef = useRef(false);

    // Re-home when switching contexts (channel/DM) OR flipping between normal
    // and anchored mode. A mode flip swaps the underlying data source entirely
    // (normal-window cache vs. anchored-window cache) — oldest/newest ids can
    // both change without it being a real prepend/append, so the prepend and
    // stick-to-bottom baselines must reset alongside positioning. The parent
    // is notified immediately so FAB state doesn't stay stale until the first
    // scroll event.
    useEffect(() => {
      cancelPositioningRafs();
      initialPositionedRef.current = false;
      pinnedRef.current = true;
      loadOlderInFlightRef.current = false;
      loadNewerInFlightRef.current = false;
      prevOldestIdRef.current = undefined;
      prevLenRef.current = 0;
      prevNewestIdRef.current = undefined;
      prevMessagesRef.current = [];
      // Roving focus: a context switch (new channel/DM) obviously must not
      // carry over the old context's focused row. A bare mode switch
      // (normal <-> anchored) within the SAME context needs the same reset
      // even though the previously-focused message id can still resolve in
      // the new data window (normal-window cache vs. anchored-window cache
      // overlap) — carrying it over would silently land tabIndex=0 on
      // whatever row happened to occupy that id, rather than the mode's own
      // sensible default (newest in normal, centered in anchored). Cleared
      // here (not left to the pure `effectiveFocusedIndex` fallback alone)
      // so the fallback's "nothing explicitly focused" case is actually
      // true again after a mode flip, not just papered over by the fallback
      // still resolving the stale key to a live row.
      setFocusedRowKey(null);
      // Kill any in-flight moveFocus retry loop from the previous
      // context/mode: cancel its pending frame, and bump the supersession
      // seq so a frame already dequeued past cancellation self-aborts.
      cancelPendingFocusRaf();
      focusRequestSeqRef.current += 1;
      onAtBottomChange?.(true);
    }, [resetKey, mode, onAtBottomChange]);

    // Cancel any pending positioning AND roving-focus retry frames on
    // unmount — an in-flight moveFocus rAF loop must not keep querying
    // (or scheduling further frames against) a torn-down listContainerRef.
    // The seq bump invalidates any frame that has already been dequeued and
    // can no longer be cancelled (see tryFocus's seq guard).
    useEffect(() => {
      return () => {
        cancelPositioningRafs();
        cancelPendingFocusRaf();
        focusRequestSeqRef.current += 1;
      };
    }, []);

    // highlightMessageId as of the latest render, read (not depended on) by
    // the initial-positioning effect below so it can detect "no jump target"
    // without re-running positioning on every highlight change.
    const highlightMessageIdRef = useRef(highlightMessageId);
    highlightMessageIdRef.current = highlightMessageId;

    // Initial positioning once data is present.
    // - Normal mode: jump to the newest message (bottom).
    // - Anchored mode: the highlightMessageId/highlightSeq effect below owns
    //   centering on the jump target — anchored sessions always start from a
    //   URL-driven jump, so a target is present in the common case. This
    //   effect only handles the rare fallback where the 3s highlight flash
    //   already expired before the anchored ("around") fetch resolved: land
    //   mid-list and release the pagination suppression, mirroring the legacy
    //   behavior for that race.
    useEffect(() => {
      if (initialPositionedRef.current || len === 0) return;
      const handle = vlistRef.current;
      if (!handle) return;

      if (mode === 'anchored') {
        if (highlightMessageIdRef.current) return;
        const idx = Math.max(0, Math.floor((len - 1) / 2));
        const raf1 = requestAnimationFrame(() => {
          handle.scrollToIndex(idx, { align: "center" });
          positioningRafsRef.current[1] = requestAnimationFrame(() => {
            handle.scrollToIndex(idx, { align: "center" });
          });
        });
        positioningRafsRef.current = [raf1, 0];
        pinnedRef.current = false;
        initialPositionedRef.current = true;
        onAtBottomChange?.(false);
        return;
      }

      // Positioning is deferred a frame (VList hasn't initialized/measured at
      // mount — an immediate scrollToIndex can be a no-op) and re-asserted a
      // second frame later, after the first measurement pass corrects the
      // estimated offsets.
      const raf1 = requestAnimationFrame(() => {
        handle.scrollToIndex(len - 1, { align: "end" });
        positioningRafsRef.current[1] = requestAnimationFrame(() => {
          handle.scrollToIndex(len - 1, { align: "end" });
        });
      });
      positioningRafsRef.current = [raf1, 0];
      pinnedRef.current = true;
      initialPositionedRef.current = true;
      onAtBottomChange?.(true);
      // highlightMessageId is read via a ref (not a dep) so this effect
      // doesn't re-run on every highlight change — only at the start of a
      // positioning epoch. resetKey/mode are deps so a context/mode switch
      // re-positions even when the new context has the same message count.
    }, [len, resetKey, mode, onAtBottomChange]);

    // Stick-to-bottom: a newer message appended while pinned (not a prepend).
    // Normal mode ONLY: in anchored mode a newest-id change means a newer page
    // was appended below the viewport (loaded via onLoadNewer) — it needs no
    // correction, and forcing the scroll to the bottom would teleport the
    // reader past the loaded page, immediately re-trigger the newer-load
    // proximity check, and cascade newer loads all the way to the present.
    // (Detached-from-live-edge in normal mode needs no separate gate: the
    // query layer never appends to a detached window, so newestId cannot
    // change there until a reset.)
    useEffect(() => {
      if (
        mode === 'normal' &&
        prevNewestIdRef.current !== undefined &&
        newestId !== prevNewestIdRef.current &&
        pinnedRef.current &&
        !isPrepend
      ) {
        // Defer to let virtua measure the new row before scrolling to it.
        requestAnimationFrame(() => scrollToBottom());
      }
      prevNewestIdRef.current = newestId;
      // isPrepend is derived from the same inputs; intentionally not a dep.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newestId, scrollToBottom, mode]);

    // Record prepend baselines AFTER the render that consumed them.
    useEffect(() => {
      prevOldestIdRef.current = oldestId;
      prevLenRef.current = len;
      prevMessagesRef.current = orderedMessages;
    });

    // Jump-to-message / anchored initial centering (once per highlightSeq,
    // mirroring the legacy hook's seq-gating so re-clicks re-scroll but
    // pagination re-renders don't). Centers the target; the row mounts as it
    // enters virtua's window and its `${id}-hl-${seq}` key remounts it,
    // (re)starting the CSS flash. Double-rAF re-assert: a single rAF can race
    // virtua's measurement readiness, especially for a freshly-mounted
    // anchored window.
    const lastScrolledSeqRef = useRef(0);
    useEffect(() => {
      if (
        !highlightMessageId ||
        highlightSeq === undefined ||
        highlightSeq <= lastScrolledSeqRef.current
      ) {
        return;
      }
      const handle = vlistRef.current;
      if (!handle) return;
      const idx = orderedMessages.findIndex((m) => m.id === highlightMessageId);
      if (idx < 0) return;

      cancelPositioningRafs();
      const raf1 = requestAnimationFrame(() => {
        handle.scrollToIndex(idx, { align: "center" });
        positioningRafsRef.current[1] = requestAnimationFrame(() => {
          handle.scrollToIndex(idx, { align: "center" });
        });
      });
      positioningRafsRef.current = [raf1, 0];
      lastScrolledSeqRef.current = highlightSeq;

      if (mode === 'anchored') {
        pinnedRef.current = false;
        initialPositionedRef.current = true;
        onAtBottomChange?.(false);
      }
    }, [highlightMessageId, highlightSeq, orderedMessages, mode, onAtBottomChange]);

    const handleScroll = useCallback(
      (offset: number) => {
        const handle = vlistRef.current;
        if (!handle) return;

        const { scrollSize, viewportSize } = handle;
        const distanceFromBottom = scrollSize - offset - viewportSize;
        const atBottom = distanceFromBottom < BOTTOM_PIN_THRESHOLD_PX;
        pinnedRef.current = atBottom;
        onAtBottomChange?.(atBottom);

        const startIndex = handle.findItemIndex(offset);
        const endIndex = handle.findItemIndex(offset + viewportSize);
        onVisibleRangeChange?.(startIndex, endIndex);

        // Older-page load: near the top, not already loading, more to fetch.
        // The in-flight ref covers the window between this call and the next
        // render with isLoadingMore=true.
        if (
          initialPositionedRef.current &&
          startIndex <= LOAD_MORE_INDEX_PROXIMITY &&
          !isLoadingMore &&
          !loadOlderInFlightRef.current &&
          continuationToken &&
          onLoadMore
        ) {
          loadOlderInFlightRef.current = true;
          void onLoadMore().finally(() => {
            loadOlderInFlightRef.current = false;
          });
        }

        // Newer-page load (anchored mode): near the end, not already loading,
        // more to fetch. Mirrors the older-load trigger above.
        if (
          initialPositionedRef.current &&
          mode === 'anchored' &&
          endIndex >= len - 1 - LOAD_NEWER_INDEX_PROXIMITY &&
          !isLoadingNewer &&
          !loadNewerInFlightRef.current &&
          hasNewer &&
          onLoadNewer
        ) {
          loadNewerInFlightRef.current = true;
          void onLoadNewer().finally(() => {
            loadNewerInFlightRef.current = false;
          });
        }
      },
      [
        isLoadingMore,
        continuationToken,
        onLoadMore,
        onAtBottomChange,
        onVisibleRangeChange,
        mode,
        isLoadingNewer,
        hasNewer,
        onLoadNewer,
        len,
      ],
    );

    // Where DaySeparators go, and whether each row's day is already named by
    // one above it (header then shows "4:12 PM", not "Yesterday 4:12 PM").
    const dayRows = dayMarkers(orderedMessages);

    return (
      <Box
        ref={listContainerRef}
        data-testid="virtual-scroll-container"
        // Not in the natural Tab order — only a fallback focus target for
        // the context-menu restore when a row is removed while its menu is
        // still closing (see MessageComponent's listContainerRef usage).
        tabIndex={-1}
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        {isLoadingMore && (
          <Box sx={{ p: 2, textAlign: "center", flexShrink: 0 }}>
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </Box>
        )}
        {/* role="list"/"listitem" rather than the ARIA "feed" pattern:
            feed's aria-posinset/aria-setsize imply an honest, stable total
            item count, which this virtualized + paginated + cap-evicted
            window can't provide (the loaded window's size isn't the
            channel's total message count, and it shrinks/grows via
            eviction independent of user action). Feed's Ctrl+Arrow
            per-article navigation model also doesn't fit — rows aren't
            independently-landmarked articles, they're moved between via the
            plain roving-tabindex Arrow keys implemented here. A plain list
            with an aria-label, one listitem per row, correctly conveys
            "a list of messages" without those false guarantees. */}
        <VList
          ref={vlistRef}
          role="list"
          aria-label="Messages"
          shift={isPrepend}
          onScroll={handleScroll}
          style={{ flex: 1, minHeight: 0 }}
        >
          {orderedMessages.map((message, index) => {
            const isHighlighted = highlightMessageId === message.id;
            const showDividerBefore =
              unreadCount > 0 && lastReadIndex !== -1 && index === lastReadIndex + 1;
            const prevMessage = index > 0 ? orderedMessages[index - 1] : undefined;
            const { separator: showDaySeparator, dayShownAbove } = dayRows[index];
            // Same-author run within 5 min (see utils/messageGrouping); the
            // unread divider always starts a fresh header below it.
            const grouped =
              !showDividerBefore && shouldGroupWithPrevious(prevMessage, message);
            // Key by clientId when present so an optimistic message's row
            // survives the id swap (pending-<uuid> -> real id) on
            // reconciliation without remounting (PR-13 fix round 1, Minor
            // 6) — clientId is preserved through both the ack-first and
            // echo-first reconcile paths (see messageCacheUpdaters.ts) for
            // exactly this reason. Falls back to message.id for every
            // ordinary (non-optimistic) row, unchanged from before.
            // Known one-off: a full refetch rebuilds rows from server data,
            // which never carries clientId, so a previously-optimistic row's
            // key flips clientId → id once (remount) — invisible in practice
            // since the refetch rebuilds the whole list anyway.
            const rowKey = message.clientId ?? message.id;
            // Composite key restarts the CSS flash on re-clicks (highlightSeq).
            const key = isHighlighted
              ? `${rowKey}-hl-${highlightSeq}`
              : rowKey;

            return (
              <div key={key} ref={observeRow} data-message-id={message.id} role="listitem">
                {showDaySeparator && <DaySeparator date={message.sentAt} />}
                {showDividerBefore && (
                  <UnreadMessageDivider unreadCount={unreadCount} />
                )}
                <MessageComponent
                  message={message}
                  grouped={grouped}
                  dayShownAbove={dayShownAbove}
                  isAuthor={message.authorId === authorId}
                  isSearchHighlight={isHighlighted}
                  contextId={contextId}
                  communityId={communityId}
                  onOpenThread={onOpenThread}
                  onQuoteReply={onQuoteReply}
                  contextType={
                    directMessageGroupId
                      ? VoiceSessionType.Dm
                      : VoiceSessionType.Channel
                  }
                  rowIndex={index}
                  isRovingFocused={index === effectiveFocusedIndex}
                  onRovingKeyDown={handleRowKeyDown}
                  onRovingFocus={handleRowFocus}
                  listContainerRef={listContainerRef}
                />
                {index === len - 1 && (
                  <div
                    aria-hidden="true"
                    data-testid="typing-indicator-spacer"
                    style={{ height: TYPING_INDICATOR_HEIGHT }}
                  />
                )}
              </div>
            );
          })}
        </VList>
        {isLoadingNewer && (
          <Box sx={{ p: 2, textAlign: "center", flexShrink: 0 }}>
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </Box>
        )}
      </Box>
    );
  },
);

VirtualMessageList.displayName = "VirtualMessageList";

export default VirtualMessageList;
