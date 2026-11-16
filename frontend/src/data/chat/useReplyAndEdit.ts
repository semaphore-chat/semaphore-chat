import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { EditRequest, EditRequestContextValue } from "../../contexts/EditRequestContext";
import { isOptimisticMessageId } from "../../utils/messageCacheUpdaters";
import type { Message, Span } from "../../types/message.type";
import type { VoiceSessionType } from "../../contexts/VoiceContext";

export interface UseReplyAndEditOptions {
  contextType: VoiceSessionType;
  contextId: string;
  /** The current user's id ("" while unknown). */
  authorId: string;
  /** The loaded messages, newest first (useMessages contract). */
  messages: Message[];
  onSendMessage: (messageContent: string, spans: Span[], files?: File[], replyToId?: string) => void;
}

export interface UseReplyAndEditResult {
  /** The message being quote-replied to, or null. */
  replyToMessage: Message | null;
  handleQuoteReply: (message: Message) => void;
  handleCancelReply: () => void;
  /** Sends with the reply's id (if any), then clears the reply. */
  wrappedOnSendMessage: (messageContent: string, spans: Span[], files?: File[]) => void;
  /** ↑ in an empty composer: request the edit form of your newest message. False if there is none. */
  handleEditLastMessage: () => boolean;
  /** The value for EditRequestContext (the row takes the request and clears it). */
  editRequestValue: EditRequestContextValue;
}

/**
 * A conversation's quote-reply state and ↑-to-edit request, shared by both
 * shells' composers and lists.
 */
export function useReplyAndEdit({
  contextType,
  contextId,
  authorId,
  messages,
  onSendMessage,
}: UseReplyAndEditOptions): UseReplyAndEditResult {
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

  // ↑ in an empty composer: open the edit form of your newest message
  // (messages arrive newest-first).
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const editSeqRef = useRef(0);
  const handleEditLastMessage = useCallback((): boolean => {
    if (!authorId) return false;
    const last = messages.find(
      (m) => m.authorId === authorId && !m.deletedAt && m.sendStatus === undefined && !isOptimisticMessageId(m.id),
    );
    if (!last) return false;
    editSeqRef.current += 1;
    setEditRequest({ messageId: last.id, seq: editSeqRef.current });
    return true;
  }, [messages, authorId]);
  const clearEditRequest = useCallback((seq: number) => {
    setEditRequest((current) => (current?.seq === seq ? null : current));
  }, []);
  const editRequestValue = useMemo<EditRequestContextValue>(
    () => ({ request: editRequest, clear: clearEditRequest }),
    [editRequest, clearEditRequest],
  );

  return {
    replyToMessage,
    handleQuoteReply,
    handleCancelReply,
    wrappedOnSendMessage,
    handleEditLastMessage,
    editRequestValue,
  };
}
