import { useState, useCallback, useEffect } from "react";
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
  const queryClient = useQueryClient();

  const mode = anchorMessageId ? "anchored" : "normal";

  // Always call both hooks (rules of hooks), anchored is disabled when no anchor
  const normalResult = useMessages(type, id);
  const anchoredResult = useAnchoredMessages(type, id, anchorMessageId);

  // When highlightMessageId changes, check if it's already loaded in normal data.
  // Wait for the normal query to finish loading before deciding, to avoid
  // a race where we switch to anchored mode before the first page arrives.
  // Reset to normal mode when highlight is cleared or context changes.
  useEffect(() => {
    if (!highlightMessageId || !id) {
      setAnchorMessageId(undefined);
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
    // Pass through anchored-specific fields
    onLoadNewer: anchoredResult.onLoadNewer,
    isLoadingNewer: anchoredResult.isLoadingNewer,
    hasNewer: anchoredResult.hasNewer,
  };
};
