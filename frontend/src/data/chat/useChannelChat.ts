import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  channelsControllerGetMentionableChannelsOptions,
  moderationControllerGetPinnedMessagesOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { useAllCommunityMembers } from "../../hooks/useAllCommunityMembers";
import { useJumpToMessage } from "../../hooks/useJumpToMessage";
import type { UserMention, ChannelMention } from "../../utils/mentionParser";

export interface UseChannelChatOptions {
  /** A pinned thread reply was chosen: its parent is being jumped to, then its thread should open. */
  onPinnedThreadReply?: (parentMessageId: string) => void;
}

/**
 * A text channel's chat data, shared by both shells: the mention lists
 * (members and mentionable channels), the pinned messages, the messages
 * (useJumpToMessage, driven by the `?highlight=` param), clearing that param
 * once the jump settles, and jumping to a pinned message.
 */
export function useChannelChat(
  channelId: string,
  communityId: string | undefined,
  { onPinnedThreadReply }: UseChannelChatOptions = {},
) {
  // Get highlight message ID from URL params
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightMessageId = searchParams.get("highlight");

  const { data: pinnedMessages = [] } = useQuery(moderationControllerGetPinnedMessagesOptions({ path: { channelId } }));

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
  const messagesHookResult = useJumpToMessage('channel', channelId, highlightMessageId || undefined);
  const { isJumpPending } = messagesHookResult;

  // Clear the highlight param from the URL once the jump has settled (target
  // loaded, in the normal or anchored window). useJumpToMessage keeps the id
  // locally for scroll/flash, and clearing lets the same pinned message be
  // re-clicked. Clearing earlier would drop a cold deep link on the floor.
  useEffect(() => {
    if (highlightMessageId && !isJumpPending) {
      navigate(`/community/${communityId}/channel/${channelId}`, {
        replace: true,
      });
    }
  }, [highlightMessageId, isJumpPending, communityId, channelId, navigate]);

  /**
   * Jump to a pinned message (`?highlight=`). A pinned thread reply jumps to
   * its parent and reports it through `onPinnedThreadReply` first, so the
   * caller can open the thread once the parent is loaded.
   */
  const jumpToPinnedMessage = (messageId: string, navOptions: { replace: boolean }) => {
    const pinnedMsg = pinnedMessages.find(m => m.id === messageId);
    if (pinnedMsg?.parentMessageId) {
      // Thread reply: jump to parent message and open the thread panel
      onPinnedThreadReply?.(pinnedMsg.parentMessageId);
      navigate(`/community/${communityId}/channel/${channelId}?highlight=${pinnedMsg.parentMessageId}`, navOptions);
    } else {
      navigate(`/community/${communityId}/channel/${channelId}?highlight=${messageId}`, navOptions);
    }
  };

  return { pinnedMessages, userMentions, channelMentions, messagesHookResult, jumpToPinnedMessage };
}
