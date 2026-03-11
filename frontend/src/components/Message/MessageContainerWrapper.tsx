import React from "react";
import MessageContainer from "../Message/MessageContainer";
import MessageInput from "./MessageInput";
import { useQuery } from "@tanstack/react-query";
import { userControllerGetProfileOptions } from "../../api-client/@tanstack/react-query.gen";
import type { Message, Span } from "../../types/message.type";
import type { UserMention, ChannelMention } from "../../utils/mentionParser";
import { VoiceSessionType } from "../../contexts/VoiceContext";


export interface MessagesHookResult {
  messages: Message[];
  isLoading: boolean;
  error: unknown;
  continuationToken?: string;
  isLoadingMore: boolean;
  onLoadMore?: () => Promise<void>;
  onLoadNewer?: () => Promise<void>;
  isLoadingNewer?: boolean;
  hasNewer?: boolean;
  mode?: 'normal' | 'anchored';
  jumpToPresent?: () => void;
  highlightSeq?: number;
}

export interface MessageContainerWrapperProps {
  contextType: VoiceSessionType;
  contextId: string;
  communityId?: string;
  useMessagesHook: () => MessagesHookResult;
  userMentions: UserMention[];
  channelMentions?: ChannelMention[];
  onSendMessage: (messageContent: string, spans: Span[], files?: File[]) => void;
  memberListComponent?: React.ReactNode;
  placeholder?: string;
  emptyStateMessage?: string;
  highlightMessageId?: string;
  onOpenThread?: (message: Message) => void;
}

const MessageContainerWrapper: React.FC<MessageContainerWrapperProps> = ({
  contextType,
  contextId,
  communityId,
  useMessagesHook,
  userMentions,
  channelMentions,
  onSendMessage,
  memberListComponent,
  placeholder = "Type a message...",
  emptyStateMessage = "No messages yet. Start the conversation!",
  highlightMessageId,
  onOpenThread,
}) => {
  const { data: user } = useQuery(userControllerGetProfileOptions());
  const authorId = user?.id || "";
  
  // Use the injected hook for messages
  const {
    messages,
    isLoading,
    error,
    continuationToken,
    isLoadingMore,
    onLoadMore,
    onLoadNewer,
    isLoadingNewer,
    hasNewer,
    mode,
    jumpToPresent,
    highlightSeq,
  } = useMessagesHook();

  // Create the message input component
  const messageInput = (
    <MessageInput
      contextType={contextType}
      contextId={contextId}
      userMentions={userMentions}
      channelMentions={channelMentions}
      onSendMessage={onSendMessage}
      placeholder={placeholder}
      communityId={communityId}
    />
  );

  return (
    <MessageContainer
      messages={messages}
      isLoading={isLoading}
      error={error}
      authorId={authorId}
      continuationToken={continuationToken}
      isLoadingMore={isLoadingMore}
      onLoadMore={onLoadMore}
      onLoadNewer={onLoadNewer}
      isLoadingNewer={isLoadingNewer}
      hasNewer={hasNewer}
      mode={mode}
      jumpToPresent={jumpToPresent}
      messageInput={messageInput}
      memberListComponent={memberListComponent}
      emptyStateMessage={emptyStateMessage}
      highlightMessageId={highlightMessageId}
      highlightSeq={highlightSeq}
      contextId={contextId}
      communityId={communityId}
      onOpenThread={onOpenThread}
      channelId={contextType === VoiceSessionType.Channel ? contextId : undefined}
      directMessageGroupId={contextType === VoiceSessionType.Dm ? contextId : undefined}
    />
  );
};

export default MessageContainerWrapper;