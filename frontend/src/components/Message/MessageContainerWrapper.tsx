import React, { useState, useCallback, useEffect } from "react";
import MessageContainer from "../Message/MessageContainer";
import MessageInput from "./MessageInput";
import ReplyComposerBanner from "./ReplyComposerBanner";
import { useQuery } from "@tanstack/react-query";
import { userControllerGetProfileOptions } from "../../api-client/@tanstack/react-query.gen";
import type { Message, Span } from "../../types/message.type";
import type { UserMention, ChannelMention } from "../../utils/mentionParser";
import { VoiceSessionType } from "../../contexts/VoiceContext";
import { BOTTOM_CHROME_ORDER, useMeasuredChromeItem } from "../../contexts/BottomChromeContext";


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
  isDetachedFromPresent?: boolean;
  resetToPresent?: () => Promise<void>;
  highlightSeq?: number;
}

export interface MessageContainerWrapperProps {
  contextType: VoiceSessionType;
  contextId: string;
  communityId?: string;
  useMessagesHook: () => MessagesHookResult;
  userMentions: UserMention[];
  channelMentions?: ChannelMention[];
  onSendMessage: (messageContent: string, spans: Span[], files?: File[], replyToId?: string) => void;
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

  // Quote reply state — reset when navigating to a different channel/DM
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  useEffect(() => {
    setReplyToMessage(null);
  }, [contextId, contextType]);
  const handleQuoteReply = useCallback((message: Message) => {
    setReplyToMessage(message);
  }, []);
  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null);
  }, []);

  const wrappedOnSendMessage = useCallback(
    (messageContent: string, spans: Span[], files?: File[]) => {
      onSendMessage(messageContent, spans, files, replyToMessage?.id);
      setReplyToMessage(null);
    },
    [onSendMessage, replyToMessage],
  );

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
    isDetachedFromPresent,
    resetToPresent,
    highlightSeq,
  } = useMessagesHook();

  // Register the composer's measured height (BottomChromeContext) so toasts
  // and the reconnecting chip float above it instead of covering it. A
  // composer on a hidden screen measures 0 and drops out by itself.
  const composerMeasureRef = useMeasuredChromeItem({ order: BOTTOM_CHROME_ORDER.COMPOSER });

  // Create the message input component
  const messageInput = (
    <div ref={composerMeasureRef}>
      {replyToMessage && (
        <ReplyComposerBanner
          replyToMessage={replyToMessage}
          onCancel={handleCancelReply}
        />
      )}
      <MessageInput
        contextType={contextType}
        contextId={contextId}
        userMentions={userMentions}
        channelMentions={channelMentions}
        onSendMessage={wrappedOnSendMessage}
        placeholder={placeholder}
        communityId={communityId}
      />
    </div>
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
      isDetachedFromPresent={isDetachedFromPresent}
      resetToPresent={resetToPresent}
      messageInput={messageInput}
      memberListComponent={memberListComponent}
      emptyStateMessage={emptyStateMessage}
      highlightMessageId={highlightMessageId}
      highlightSeq={highlightSeq}
      contextId={contextId}
      communityId={communityId}
      onOpenThread={onOpenThread}
      onQuoteReply={handleQuoteReply}
      channelId={contextType === VoiceSessionType.Channel ? contextId : undefined}
      directMessageGroupId={contextType === VoiceSessionType.Dm ? contextId : undefined}
    />
  );
};

export default MessageContainerWrapper;