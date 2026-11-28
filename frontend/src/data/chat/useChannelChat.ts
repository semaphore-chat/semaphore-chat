import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  channelsControllerGetMentionableChannelsOptions,
  moderationControllerGetPinnedMessagesOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { useAllCommunityMembers } from "../../hooks/useAllCommunityMembers";
import { useJumpToMessage } from "../../hooks/useJumpToMessage";
import { pinnedJumpTarget } from "./usePinnedList";
import { searchWith } from "./threadParam";
import { navigateAfterLayers } from "../systemBack";
import type { UserMention, ChannelMention } from "../../utils/mentionParser";
import { chatTargetId, type ChatTarget } from "./chatTarget";

export interface UseChannelChatOptions {
  /** A pinned thread reply was chosen: its parent is being jumped to, then its thread should open. */
  onPinnedThreadReply?: (parentMessageId: string) => void;
  /**
   * The chat's own path, where clearing `?highlight=` and a pinned jump lead. Default: the app's channel route,
   * `/community/:communityId/channel/:channelId` (the old shell); for a DM the current path (as the old shell's
   * DM screen). The new shell's hidden fixture passes its own.
   */
  chatPath?: string;
}

/**
 * A conversation's chat data, shared by both shells: the mention lists
 * (members and mentionable channels), the pinned messages, the messages
 * (useJumpToMessage, driven by the `?highlight=` param), clearing that param
 * once the jump settles, and jumping to a pinned message.
 *
 * A DM (`{ kind: 'dm' }`) has its messages and `?highlight=` jump, as the old
 * shell's DM screen (`DirectMessageContainer`); no pins and empty mention
 * lists (no community: the DM composer, `useChannelComposer`, reads the
 * group's members itself).
 */
export function useChannelChat(target: ChatTarget, options?: UseChannelChatOptions): ChannelChat;
export function useChannelChat(channelId: string, communityId: string | undefined, options?: UseChannelChatOptions): ChannelChat;
export function useChannelChat(
  targetOrChannelId: ChatTarget | string,
  communityIdOrOptions?: string | UseChannelChatOptions,
  maybeOptions?: UseChannelChatOptions,
): ChannelChat {
  const legacy = typeof targetOrChannelId === "string";
  const target: ChatTarget = legacy
    ? { kind: "channel", channelId: targetOrChannelId, communityId: (communityIdOrOptions as string | undefined) ?? "" }
    : targetOrChannelId;
  return useChatData(target, legacy ? maybeOptions : (communityIdOrOptions as UseChannelChatOptions | undefined));
}

export type ChannelChat = ReturnType<typeof useChatData>;

function useChatData(target: ChatTarget, { onPinnedThreadReply, chatPath: chatPathOption }: UseChannelChatOptions = {}) {
  const isChannel = target.kind === "channel";
  const id = chatTargetId(target);
  // `|| undefined`: the old two-argument form allowed no community (no mention lists then).
  const communityId = target.kind === "channel" ? target.communityId || undefined : undefined;
  const location = useLocation();
  const chatPath = chatPathOption ?? (isChannel ? `/community/${communityId}/channel/${id}` : location.pathname);
  // Get highlight message ID from URL params
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const locationStateRef = useRef(location.state);
  locationStateRef.current = location.state;
  const highlightMessageId = searchParams.get("highlight");

  const { data: pinnedMessages = [] } = useQuery({
    ...moderationControllerGetPinnedMessagesOptions({ path: { channelId: isChannel ? id : "" } }),
    enabled: isChannel,
  });

  // Fetch community members and channels for mention resolution
  const { data: memberData = [] } = useAllCommunityMembers(communityId || "", {
    enabled: !!communityId,
  });
  const { data: channelData = [] } = useQuery({
    ...channelsControllerGetMentionableChannelsOptions({ path: { communityId: communityId || "" } }),
    enabled: !!communityId,
  });

  // Convert to mention format
  const userMentions: UserMention[] = useMemo(() =>
    memberData.map((member) => ({
      id: member.user!.id,
      username: member.user!.username,
      displayName: member.user!.displayName || undefined,
    })), [memberData]);

  const channelMentions: ChannelMention[] = useMemo(() =>
    channelData.map((channel) => ({
      id: channel.id,
      name: channel.name,
    })), [channelData]);

  // Get messages using the jump-to-message hook (supports anchored mode for pinned/search/notification links)
  const messagesHookResult = useJumpToMessage(isChannel ? 'channel' : 'dm', id, highlightMessageId || undefined);
  const { isJumpPending } = messagesHookResult;

  // Clear the highlight param from the URL once the jump has settled (target
  // loaded, in the normal or anchored window). useJumpToMessage keeps the id
  // locally for scroll/flash, and clearing lets the same pinned message be
  // re-clicked. Clearing earlier would drop a cold deep link on the floor.
  // Only `highlight` goes: the rest of the query (an open `?thread=`) and the entry's state stay.
  const searchWithoutHighlight = searchWith(searchParams, "highlight", null);
  useEffect(() => {
    if (highlightMessageId && !isJumpPending) {
      // In the Lounge, after any closing layer's history entry is gone (a replace on it would leave the old entry).
      navigateAfterLayers(() =>
        navigate(`${chatPath}${searchWithoutHighlight}`, {
          replace: true,
          state: locationStateRef.current,
        }),
      );
    }
  }, [highlightMessageId, isJumpPending, chatPath, navigate, searchWithoutHighlight]);

  /**
   * Jump to a pinned message (`?highlight=`). A pinned thread reply jumps to
   * its parent and reports it through `onPinnedThreadReply` first, so the
   * caller can open the thread once the parent is loaded.
   */
  const jumpToPinnedMessage = (messageId: string, navOptions: { replace: boolean }) => {
    const pinnedMsg = pinnedMessages.find(m => m.id === messageId);
    const target = pinnedJumpTarget(pinnedMsg ?? { id: messageId, parentMessageId: null });
    // Thread reply: jump to parent message and open the thread panel
    if (target.thread) onPinnedThreadReply?.(target.thread);
    navigate(`${chatPath}?highlight=${target.highlight}`, navOptions);
  };

  return { pinnedMessages, userMentions, channelMentions, messagesHookResult, jumpToPinnedMessage };
}
