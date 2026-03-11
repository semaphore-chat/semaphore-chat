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
  const [activeHighlight, setActiveHighlight] = useState<string | undefined>();
  const [highlightSeq, setHighlightSeq] = useState(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const queryClient = useQueryClient();

  const mode = anchorMessageId ? "anchored" : "normal";

  // Always call both hooks (rules of hooks), anchored is disabled when no anchor
  const normalResult = useMessages(type, id);
  const anchoredResult = useAnchoredMessages(type, id, anchorMessageId);

  // When a new highlightMessageId arrives from the URL, capture it locally.
  // The container clears the URL immediately so re-clicks always trigger a fresh change.
  useEffect(() => {
    if (!highlightMessageId) return;

    setActiveHighlight(highlightMessageId);
    setHighlightSeq((s) => s + 1);

    // Auto-clear flash after 3 seconds (CSS animation duration)
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setActiveHighlight(undefined);
    }, 3000);

    return () => clearTimeout(flashTimerRef.current);
  }, [highlightMessageId]);

  // Reset anchored mode when switching channels/DMs.
  useEffect(() => {
    setAnchorMessageId(undefined);
    setActiveHighlight(undefined);
  }, [id]);

  // When highlightMessageId changes, check if it's already loaded in normal data.
  // Wait for the normal query to finish loading before deciding, to avoid
  // a race where we switch to anchored mode before the first page arrives.
  useEffect(() => {
    if (!highlightMessageId || !id) {
      return;
    }

    // Don't decide until the normal query has completed its initial load
    if (normalResult.isLoading) {
      return;
    }

    const found = normalResult.messages.some((m) => m.id === highlightMessageId);

    if (found) {
      // Message is in normal data — stay in normal mode
      setAnchorMessageId(undefined);
    } else {
      // Message not loaded — switch to anchored mode
      setAnchorMessageId(highlightMessageId);
    }
  }, [highlightMessageId, id, normalResult.isLoading, normalResult.messages]);

  const jumpToPresent = useCallback(() => {
    if (!id || !anchorMessageId) return;

    // Remove anchored query cache
    const anchoredKey =
      type === "channel"
        ? channelAnchoredMessagesQueryKey(id, anchorMessageId)
        : dmAnchoredMessagesQueryKey(id, anchorMessageId);
    queryClient.removeQueries({ queryKey: anchoredKey });

    setAnchorMessageId(undefined);
  }, [id, anchorMessageId, type, queryClient]);

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
    // Sequence counter — increments on every jump request so useBidirectionalScroll
    // can distinguish re-clicks to the same message from pagination re-renders.
    highlightSeq,
    // Pass through anchored-specific fields
    onLoadNewer: anchoredResult.onLoadNewer,
    isLoadingNewer: anchoredResult.isLoadingNewer,
    hasNewer: anchoredResult.hasNewer,
  };
};
