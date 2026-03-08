/**
 * useMessageActions Hook
 *
 * Encapsulates message editing and deletion logic.
 * Provides handlers and state management for message actions.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  messagesControllerUpdateMutation,
  messagesControllerRemoveMutation,
  messagesControllerAddReactionMutation,
  messagesControllerRemoveReactionMutation,
} from "../../api-client/@tanstack/react-query.gen";
import type { Message as MessageType, FileMetadata, Span } from "../../types/message.type";
import { SpanType } from "../../types/message.type";
import { spansToText, parseMessageWithMentions } from "../../utils/mentionParser";
import {
  moderationControllerPinMessageMutation,
  moderationControllerUnpinMessageMutation,
} from "../../api-client/@tanstack/react-query.gen";

import { channelMessagesQueryKey, dmMessagesQueryKey } from "../../utils/messageQueryKeys";
import {
  updateMessageInInfinite,
  deleteMessageFromInfinite,
  findMessageInInfinite,
} from "../../utils/messageCacheUpdaters";
import { logger } from "../../utils/logger";

export interface UseMessageActionsReturn {
  isEditing: boolean;
  editText: string;
  editAttachments: FileMetadata[];
  stagedForDelete: boolean;
  isDeleting: boolean;
  showThreadDeleteConfirm: boolean;
  setEditText: (text: string) => void;
  handleEditClick: () => void;
  handleEditSave: () => Promise<void>;
  handleEditCancel: () => void;
  handleRemoveAttachment: (attachmentId: string) => void;
  handleDeleteClick: () => void;
  handleConfirmDelete: () => Promise<void>;
  handleCancelDelete: () => void;
  handleConfirmThreadDelete: () => Promise<void>;
  handleCancelThreadDelete: () => void;
  handleReactionClick: (emoji: string) => Promise<void>;
  handleEmojiSelect: (emoji: string) => Promise<void>;
  handlePin: () => Promise<void>;
  handleUnpin: () => Promise<void>;
}

/** Update the TQ cache for a message (handles both channel and DM contexts) */
function updateCache(
  queryClient: ReturnType<typeof useQueryClient>,
  msg: MessageType,
) {
  const queryKey = msg.channelId
    ? channelMessagesQueryKey(msg.channelId)
    : msg.directMessageGroupId
      ? dmMessagesQueryKey(msg.directMessageGroupId)
      : undefined;
  if (!queryKey) return;
  queryClient.setQueryData(queryKey, (old: unknown) =>
    updateMessageInInfinite(old as never, msg)
  );
}

/**
 * Update only the reactions field on a cached message.
 *
 * Reaction endpoints return a raw MessageDto (attachments as plain IDs),
 * not an EnrichedMessageDto. Replacing the whole cached message would
 * overwrite enriched attachment metadata and crash components that
 * depend on it (e.g. DownloadLink accessing metadata.mimeType).
 */
function updateReactionsInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  msg: { channelId?: string | null; directMessageGroupId?: string | null; id: string; reactions: MessageType["reactions"] },
) {
  const queryKey = msg.channelId
    ? channelMessagesQueryKey(msg.channelId)
    : msg.directMessageGroupId
      ? dmMessagesQueryKey(msg.directMessageGroupId)
      : undefined;
  if (!queryKey) return;
  queryClient.setQueryData(queryKey, (old: unknown) => {
    const existing = findMessageInInfinite(old as never, msg.id);
    if (!existing) return old;
    return updateMessageInInfinite(old as never, {
      ...existing,
      reactions: msg.reactions,
    });
  });
}

/** Delete a message from the TQ cache (handles both channel and DM contexts) */
function deleteFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  msg: MessageType,
) {
  const queryKey = msg.channelId
    ? channelMessagesQueryKey(msg.channelId)
    : msg.directMessageGroupId
      ? dmMessagesQueryKey(msg.directMessageGroupId)
      : undefined;
  if (!queryKey) return;
  queryClient.setQueryData(queryKey, (old: unknown) =>
    deleteMessageFromInfinite(old as never, msg.id)
  );
}

/**
 * Custom hook for managing message editing, deletion, and reactions
 */
export function useMessageActions(
  message: MessageType,
  currentUserId: string | undefined
): UseMessageActionsReturn {
  const queryClient = useQueryClient();

  const { mutateAsync: updateMessageApi } = useMutation({
    ...messagesControllerUpdateMutation(),
    onSuccess: (updatedMessage) => {
      // If we have original attachments metadata, enrich the response
      let enrichedMessage = updatedMessage;
      if (message.attachments && Array.isArray(updatedMessage.attachments)) {
        const attachmentMap = new Map(message.attachments.map((att: FileMetadata) => [att.id, att]));
        enrichedMessage = {
          ...updatedMessage,
          attachments: updatedMessage.attachments
            .map((idOrObj: string | FileMetadata) => {
              if (typeof idOrObj === 'object' && idOrObj.id) return idOrObj;
              if (typeof idOrObj === 'string') return attachmentMap.get(idOrObj);
              return idOrObj;
            })
            .filter(Boolean) as MessageType['attachments'],
        };
      }
      updateCache(queryClient, enrichedMessage as MessageType);
    },
  });

  const { mutateAsync: deleteMessageApi } = useMutation({
    ...messagesControllerRemoveMutation(),
    onSuccess: () => {
      deleteFromCache(queryClient, message);
    },
  });

  const { mutateAsync: addReactionApi } = useMutation({
    ...messagesControllerAddReactionMutation(),
    onSuccess: (updatedMessage) => {
      updateReactionsInCache(queryClient, updatedMessage as MessageType);
    },
  });

  const { mutateAsync: removeReactionApi } = useMutation({
    ...messagesControllerRemoveReactionMutation(),
    onSuccess: (updatedMessage) => {
      updateReactionsInCache(queryClient, updatedMessage as MessageType);
    },
  });

  const { mutateAsync: pinMessage } = useMutation({
    ...moderationControllerPinMessageMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetPinnedMessages' }] });
    },
  });
  const { mutateAsync: unpinMessage } = useMutation({
    ...moderationControllerUnpinMessageMutation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [{ _id: 'moderationControllerGetPinnedMessages' }] });
    },
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editAttachments, setEditAttachments] = useState<FileMetadata[]>([]);
  const [stagedForDelete, setStagedForDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showThreadDeleteConfirm, setShowThreadDeleteConfirm] = useState(false);
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
      }
    };
  }, []);

  const handleEditClick = useCallback(() => {
    // Convert all spans (including mentions) to editable text
    const fullText = spansToText(message.spans);
    setEditText(fullText);
    // Initialize edit attachments with current attachments
    setEditAttachments([...message.attachments]);
    setIsEditing(true);
  }, [message.spans, message.attachments]);

  const handleEditSave = useCallback(async () => {
    if (!message.channelId && !message.directMessageGroupId) return;

    try {
      // Extract mentioned users from original message to preserve mentions
      const mentionedUsers = message.spans
        .filter(span => span.type === SpanType.USER_MENTION && span.userId)
        .map(span => ({
          id: span.userId!,
          username: span.text?.replace('@', '') || 'user',
          displayName: span.text?.replace('@', '') || 'user',
        }));

      // Parse edited text back to spans, preserving existing mentions
      let parsedSpans: Span[] = parseMessageWithMentions(editText, mentionedUsers);

      // Ensure at least one span exists
      if (parsedSpans.length === 0) {
        parsedSpans = [{ type: SpanType.PLAINTEXT, text: editText || '' }];
      }

      await updateMessageApi({
        path: { id: message.id },
        body: {
          spans: parsedSpans,
          attachments: editAttachments.map(att => att.id),
        },
      });
      setIsEditing(false);
      setEditText("");
      setEditAttachments([]);
    } catch (error) {
      logger.error("Failed to update message:", error);
    }
  }, [message, editText, editAttachments, updateMessageApi]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditText("");
    setEditAttachments([]);
  }, []);

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setEditAttachments(prev => prev.filter(att => att.id !== attachmentId));
  }, []);

  const handleDeleteClick = useCallback(() => {
    if ((message.replyCount ?? 0) > 0) {
      setShowThreadDeleteConfirm(true);
    } else {
      setStagedForDelete(true);
    }
  }, [message.replyCount]);

  const handleConfirmDelete = useCallback(async () => {
    if (!message.channelId && !message.directMessageGroupId) return;

    setIsDeleting(true);

    // Wait for animation to complete before actually deleting
    deleteTimeoutRef.current = setTimeout(async () => {
      try {
        await deleteMessageApi({
          path: { id: message.id },
        });
      } catch (error) {
        logger.error("Failed to delete message:", error);
        setIsDeleting(false);
        setStagedForDelete(false);
      }
      deleteTimeoutRef.current = null;
    }, 300); // Match the animation duration
  }, [message.id, message.channelId, message.directMessageGroupId, deleteMessageApi]);

  const handleCancelDelete = useCallback(() => {
    setStagedForDelete(false);
  }, []);

  const handleConfirmThreadDelete = useCallback(async () => {
    setShowThreadDeleteConfirm(false);
    await handleConfirmDelete();
  }, [handleConfirmDelete]);

  const handleCancelThreadDelete = useCallback(() => {
    setShowThreadDeleteConfirm(false);
  }, []);

  const handleReactionClick = useCallback(async (emoji: string) => {
    if (!currentUserId) return;

    const reaction = message.reactions.find(r => r.emoji === emoji);
    const userHasReacted = reaction?.userIds?.includes(currentUserId) ?? false;

    try {
      if (userHasReacted) {
        await removeReactionApi({ body: { messageId: message.id, emoji } });
      } else {
        await addReactionApi({ body: { messageId: message.id, emoji } });
      }
    } catch (error) {
      logger.error("Failed to update reaction:", error);
    }
  }, [currentUserId, message.reactions, message.id, addReactionApi, removeReactionApi]);

  const handleEmojiSelect = useCallback(async (emoji: string) => {
    try {
      await addReactionApi({ body: { messageId: message.id, emoji } });
    } catch (error) {
      logger.error("Failed to add reaction:", error);
    }
  }, [message.id, addReactionApi]);

  const handlePin = useCallback(async () => {
    try {
      await pinMessage({ path: { messageId: message.id } });
    } catch (error) {
      logger.error("Failed to pin message:", error);
    }
  }, [message.id, pinMessage]);

  const handleUnpin = useCallback(async () => {
    try {
      await unpinMessage({ path: { messageId: message.id } });
    } catch (error) {
      logger.error("Failed to unpin message:", error);
    }
  }, [message.id, unpinMessage]);

  return {
    isEditing,
    editText,
    editAttachments,
    stagedForDelete,
    isDeleting,
    showThreadDeleteConfirm,
    setEditText,
    handleEditClick,
    handleEditSave,
    handleEditCancel,
    handleRemoveAttachment,
    handleDeleteClick,
    handleConfirmDelete,
    handleCancelDelete,
    handleConfirmThreadDelete,
    handleCancelThreadDelete,
    handleReactionClick,
    handleEmojiSelect,
    handlePin,
    handleUnpin,
  };
}
