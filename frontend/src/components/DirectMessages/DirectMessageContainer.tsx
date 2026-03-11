import React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import MessageContainerWrapper from "../Message/MessageContainerWrapper";
import MemberListContainer from "../Message/MemberListContainer";
import { useJumpToMessage } from "../../hooks/useJumpToMessage";
import { useMessageFileUpload } from "../../hooks/useMessageFileUpload";
import { useQuery } from "@tanstack/react-query";
import { directMessagesControllerFindDmGroupOptions } from "../../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useAutoMarkNotificationsRead } from "../../hooks/useAutoMarkNotificationsRead";
import type { UserMention } from "../../utils/mentionParser";
import { VoiceSessionType } from "../../contexts/VoiceContext";

interface DirectMessageContainerProps {
  dmGroupId: string;
}

const DirectMessageContainer: React.FC<DirectMessageContainerProps> = ({
  dmGroupId,
}) => {
  const { user } = useCurrentUser();
  const authorId = user?.id || "";

  const { handleSendMessage } = useMessageFileUpload({
    contextType: VoiceSessionType.Dm,
    contextId: dmGroupId,
    authorId,
  });

  // Get DM group info to get members for mentions
  const { data: dmGroup } = useQuery(directMessagesControllerFindDmGroupOptions({ path: { id: dmGroupId } }));

  // Auto-mark notifications as read when viewing this DM
  useAutoMarkNotificationsRead({
    contextType: VoiceSessionType.Dm,
    contextId: dmGroupId,
  });

  // Get highlight message ID from URL params (for notification deep linking)
  const [searchParams] = useSearchParams();
  const dmNavigate = useNavigate();
  const highlightMessageId = searchParams.get("highlight");

  // Clear highlight param from URL immediately after capturing it.
  // useJumpToMessage stores it locally for scroll/flash (3s auto-clear).
  React.useEffect(() => {
    if (highlightMessageId) {
      dmNavigate(`/direct-messages?group=${dmGroupId}`, { replace: true });
    }
  }, [highlightMessageId, dmGroupId, dmNavigate]);

  // Convert DM group members to mention format
  const userMentions: UserMention[] = React.useMemo(() => {
    return dmGroup?.members?.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      displayName: member.user.displayName || undefined,
    })) || [];
  }, [dmGroup?.members]);

  // Get messages using the jump-to-message hook (supports anchored mode for notification deep links)
  const messagesHookResult = useJumpToMessage('dm', dmGroupId, highlightMessageId || undefined);

  // Create member list component for the DM group
  const memberListComponent = (
    <MemberListContainer
      contextType={VoiceSessionType.Dm}
      contextId={dmGroupId}
    />
  );

  return (
    <MessageContainerWrapper
      contextType={VoiceSessionType.Dm}
      contextId={dmGroupId}
      useMessagesHook={() => messagesHookResult}
      userMentions={userMentions}
      onSendMessage={handleSendMessage}
      memberListComponent={memberListComponent}
      placeholder="Type a direct message..."
      emptyStateMessage="No messages yet. Start the conversation!"
      highlightMessageId={messagesHookResult.highlightMessageId}
    />
  );
};

export default DirectMessageContainer;