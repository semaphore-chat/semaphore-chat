import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMessages } from "./useMessages";
import { useAnchoredMessages } from "./useAnchoredMessages";
import { findMessageInInfinite } from "../utils/messageCacheUpdaters";
import {
  channelMessagesQueryKey,
  dmMessagesQueryKey,
  channelAnchoredMessagesQueryKey,
  dmAnchoredMessagesQueryKey,
} from "../utils/messageQueryKeys";
import type { PaginatedMessagesResponseDto } from "../api-client/types.gen";
import type { InfiniteData } from "@tanstack/react-query";

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

  // When highlightMessageId changes, check if it's in the normal cache
  useEffect(() => {
    if (!highlightMessageId || !id) {
      return;
    }

    const normalQueryKey =
      type === "channel"
        ? channelMessagesQueryKey(id)
        : dmMessagesQueryKey(id);

    const normalData = queryClient.getQueryData<
      InfiniteData<PaginatedMessagesResponseDto>
    >(normalQueryKey);

    const found = findMessageInInfinite(normalData, highlightMessageId);

    if (found) {
      // Message is in normal cache — stay in normal mode
      setAnchorMessageId(undefined);
    } else {
      // Message not loaded — switch to anchored mode
      setAnchorMessageId(highlightMessageId);
    }
  }, [highlightMessageId, id, type, queryClient]);

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

  const activeResult = mode === "anchored" ? anchoredResult : normalResult;

  return {
    ...activeResult,
    mode: mode as "normal" | "anchored",
    jumpToPresent,
    // Pass through anchored-specific fields
    onLoadNewer: anchoredResult.onLoadNewer,
    isLoadingNewer: anchoredResult.isLoadingNewer,
    hasNewer: anchoredResult.hasNewer,
  };
};
