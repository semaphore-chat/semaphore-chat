import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMessages } from "./useMessages";
import { useAnchoredMessages } from "./useAnchoredMessages";
import {
  channelAnchoredMessagesQueryKey,
  dmAnchoredMessagesQueryKey,
} from "../utils/messageQueryKeys";

export const useJumpToMessage = (
  type: "channel" | "dm",
  id: string | undefined,
  highlightMessageId: string | undefined,
) => {
  const [anchorMessageId, setAnchorMessageId] = useState<string | undefined>();
  // Local highlight state — persists after URL clears so scroll/flash still work.
  // The URL param is just a trigger; this is the source of truth for the UI.
  // Uses a seq counter so re-clicking the same message always triggers a new scroll.
  const [activeHighlight, setActiveHighlight] = useState<string | undefined>(highlightMessageId);
  const [highlightSeq, setHighlightSeq] = useState(highlightMessageId ? 1 : 0);
  // The jump target whose data hasn't arrived yet. While set, the container
  // must keep the `?highlight=` param in the URL, and the 3s flash timer
  // doesn't start. Cleared once the target is in the normal window, or the
  // anchored ("around") query has settled (success or error).
  const [pendingJumpId, setPendingJumpId] = useState<string | undefined>(highlightMessageId);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queryClient = useQueryClient();

  // Capture new highlight ids and channel/DM switches during render (not in
  // effects), so the very first render of a cold deep link already reports
  // the jump as pending, and a switch that carries its own `?highlight=`
  // (same navigation) keeps it instead of an id-reset effect wiping it.
  const [tracked, setTracked] = useState({ id, highlightMessageId });
  if (tracked.id !== id || tracked.highlightMessageId !== highlightMessageId) {
    const idChanged = tracked.id !== id;
    const highlightChanged = tracked.highlightMessageId !== highlightMessageId;
    setTracked({ id, highlightMessageId });
    if (idChanged) {
      // Reset anchored mode when switching channels/DMs, keeping only a
      // highlight that arrived with this navigation.
      setAnchorMessageId(undefined);
      setActiveHighlight(highlightMessageId);
      setPendingJumpId(highlightMessageId);
      if (highlightMessageId) setHighlightSeq((s) => s + 1);
    } else if (highlightChanged && highlightMessageId) {
      setActiveHighlight(highlightMessageId);
      setPendingJumpId(highlightMessageId);
      setHighlightSeq((s) => s + 1);
    }
  }

  const mode = anchorMessageId ? "anchored" : "normal";

  // Always call both hooks (rules of hooks), anchored is disabled when no anchor
  const normalResult = useMessages(type, id);
  const anchoredResult = useAnchoredMessages(type, id, anchorMessageId);

  // Resolve a pending jump: once the normal query has finished its initial
  // load, stay in normal mode if the target is there, otherwise anchor on it
  // and wait for the anchored query to settle.
  useEffect(() => {
    if (!pendingJumpId || !id) return;

    if (anchorMessageId === pendingJumpId) {
      if (!anchoredResult.isLoading) setPendingJumpId(undefined);
      return;
    }

    // Don't decide until the normal query has completed its initial load
    if (normalResult.isLoading) return;

    const found = normalResult.messages.some((m) => m.id === pendingJumpId);
    if (found) {
      // Message is in normal data — stay in normal mode
      setAnchorMessageId(undefined);
      setPendingJumpId(undefined);
    } else {
      // Message not loaded — switch to anchored mode
      setAnchorMessageId(pendingJumpId);
    }
  }, [
    pendingJumpId,
    id,
    anchorMessageId,
    anchoredResult.isLoading,
    normalResult.isLoading,
    normalResult.messages,
  ]);

  // Auto-clear the flash 3 seconds (CSS animation duration) after the jump
  // settles — not from when the link arrived, or a cold load would expire
  // the highlight before the target was ever rendered. Restarts per seq.
  useEffect(() => {
    if (!activeHighlight || pendingJumpId) return;
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setActiveHighlight(undefined);
    }, 3000);
    return () => clearTimeout(flashTimerRef.current);
  }, [activeHighlight, pendingJumpId, highlightSeq]);

  // Destructured so jumpToPresent can depend on these two stable values
  // instead of the whole normalResult object (a fresh literal every render,
  // which would defeat the memoization).
  const {
    isDetachedFromPresent: normalIsDetached,
    resetToPresent: resetNormalToPresent,
  } = normalResult;

  const jumpToPresent = useCallback(() => {
    if (!id || !anchorMessageId) return;

    // Remove anchored query cache
    const anchoredKey =
      type === "channel"
        ? channelAnchoredMessagesQueryKey(id, anchorMessageId)
        : dmAnchoredMessagesQueryKey(id, anchorMessageId);
    queryClient.removeQueries({ queryKey: anchoredKey });

    setAnchorMessageId(undefined);

    // Dropping the anchor falls back to the normal-mode window, which may
    // itself be detached from the live edge (e.g. the user jumped here from
    // a pinned/search link while their normal window had already scrolled
    // back past MESSAGE_MAX_PAGES). Chain straight into that reset too, so
    // one click reaches the present instead of landing on the normal
    // window's false bottom and immediately re-showing the FAB.
    if (normalIsDetached) {
      void resetNormalToPresent();
    }
  }, [id, anchorMessageId, type, queryClient, normalIsDetached, resetNormalToPresent]);

  // If anchored query errors (e.g. message not found), fall back to normal mode
  useEffect(() => {
    if (mode === "anchored" && anchoredResult.error) {
      setAnchorMessageId(undefined);
    }
  }, [mode, anchoredResult.error]);

  const activeResult = mode === "anchored" && !anchoredResult.error ? anchoredResult : normalResult;
  const effectiveMode = mode === "anchored" && !anchoredResult.error ? "anchored" : "normal";

  return {
    ...activeResult,
    mode: effectiveMode as "normal" | "anchored",
    jumpToPresent,
    // The highlight ID for scroll-to and CSS flash (persists after URL clears)
    highlightMessageId: activeHighlight,
    // Sequence counter — increments on every jump request so VirtualMessageList
    // can distinguish re-clicks to the same message from pagination re-renders.
    highlightSeq,
    // True while a `?highlight=` jump is still loading its target. Containers
    // keep the URL param until this turns false, then clear it.
    isJumpPending: !!pendingJumpId,
    // Pass through anchored-specific fields
    onLoadNewer: anchoredResult.onLoadNewer,
    isLoadingNewer: anchoredResult.isLoadingNewer,
    hasNewer: anchoredResult.hasNewer,
  };
};
