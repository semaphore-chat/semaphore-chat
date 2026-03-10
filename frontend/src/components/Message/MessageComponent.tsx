/**
 * MessageComponent
 *
 * Main message display component.
 * Orchestrates message rendering, editing, deletion, and reactions.
 */

import React from "react";
import { Typography, Tooltip, Box, Link } from "@mui/material";
import PushPinIcon from "@mui/icons-material/PushPin";
import type { Message as MessageType } from "../../types/message.type";
import { useQuery } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions } from "../../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useMessagePermissions } from "../../hooks/useMessagePermissions";
import { MessageReactions } from "./MessageReactions";
import { MessageAttachments } from "./MessageAttachments";
import { MessageEditForm } from "./MessageEditForm";
import { MessageToolbar } from "./MessageToolbar";
import { renderMessageSpans } from "./MessageSpan";
import { Container } from "./MessageComponentStyles";
import { useMessageActions } from "./useMessageActions";
import { isUserMentioned } from "./messageUtils";
import UserAvatar from "../Common/UserAvatar";
import ConfirmDialog from "../Common/ConfirmDialog";
import { ThreadReplyBadge } from "../Thread/ThreadReplyBadge";
import { useUserProfile } from "../../contexts/UserProfileContext";
import { SeenByTooltip } from "./SeenByTooltip";
import { VoiceSessionType } from "../../contexts/VoiceContext";

interface MessageProps {
  message: MessageType;
  isAuthor?: boolean;
  isSearchHighlight?: boolean;
  contextId?: string;
  communityId?: string;
  isThreadParent?: boolean;
  isThreadReply?: boolean;
  onOpenThread?: (message: MessageType) => void;
  /** Context type to determine if read receipts should be shown */
  contextType?: VoiceSessionType;
}

function MessageComponentInner({
  message,
  isAuthor,
  isSearchHighlight,
  contextId,
  isThreadParent,
  isThreadReply,
  onOpenThread,
  contextType,
}: MessageProps) {
  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: message.authorId! } }),
    enabled: !!message.authorId,
  });
  const { user: currentUser } = useCurrentUser();
  const { openProfile } = useUserProfile();

  // Check if this message mentions the current user
  const isMentioned = isUserMentioned(message, currentUser?.id);

  // Use extracted hook for cleaner permission logic
  const { canEdit, canDelete, canPin, canReact } = useMessagePermissions({
    message,
    currentUserId: currentUser?.id,
  });

  const isPinned = message.pinned === true;

  // Thread logic: Can start a thread if not already a thread reply and handler is provided
  const canThread = !isThreadReply && !isThreadParent && !!onOpenThread;
  const hasReplies = (message.replyCount ?? 0) > 0;

  const handleOpenThread = () => {
    if (onOpenThread) {
      onOpenThread(message);
    }
  };

  const {
    isEditing,
    editText,
    editAttachments,
    stagedForDelete,
    isDeleting,
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
    showThreadDeleteConfirm,
    handleReactionClick,
    handleEmojiSelect,
    handlePin,
    handleUnpin,
  } = useMessageActions(message, currentUser?.id);

  return (
    <Container
      stagedForDelete={stagedForDelete}
      isDeleting={isDeleting}
      isHighlighted={isMentioned}
      isSearchHighlight={isSearchHighlight}
    >
      <div style={{ marginRight: 12, marginTop: 4 }}>
        <UserAvatar
          userId={message.authorId ?? undefined}
          size="small"
          clickable={!!message.authorId}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {message.authorId ? (
            <Link
              component="button"
              variant="body2"
              onClick={() => openProfile(message.authorId!)}
              sx={{
                fontWeight: 700,
                color: "text.primary",
                textDecoration: "none",
                cursor: "pointer",
                "&:hover": {
                  textDecoration: "underline",
                },
              }}
            >
              {author?.displayName || author?.username || message.authorId}
            </Link>
          ) : (
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                color: "text.secondary",
                fontStyle: "italic",
              }}
            >
              [Deleted User]
            </Typography>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "inline-flex", alignItems: "center" }}
          >
            {new Date(message.sentAt).toLocaleString()}
            {message.editedAt && (
              <span style={{ marginLeft: 4 }}>(edited)</span>
            )}
            {/* Show read status for own messages in DMs with "seen by" tooltip */}
            {contextType === VoiceSessionType.Dm && isAuthor && contextId && (
              <SeenByTooltip
                messageId={message.id}
                directMessageGroupId={contextId}
              />
            )}
          </Typography>
          {isPinned && (
            <Tooltip title="Pinned message">
              <PushPinIcon
                sx={{
                  fontSize: 14,
                  color: "primary.main",
                  ml: 0.5,
                }}
              />
            </Tooltip>
          )}
        </Box>
        {isEditing ? (
          <MessageEditForm
            editText={editText}
            editAttachments={editAttachments}
            onTextChange={setEditText}
            onSave={handleEditSave}
            onCancel={handleEditCancel}
            onRemoveAttachment={handleRemoveAttachment}
          />
        ) : (
          <>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              {renderMessageSpans(message.spans)}
            </Typography>
            <MessageAttachments attachments={message.attachments} />
            <MessageReactions
              messageId={message.id}
              reactions={message.reactions}
              onReactionClick={handleReactionClick}
            />
            {/* Show thread reply badge if message has replies and not in thread context */}
            {hasReplies && !isThreadParent && !isThreadReply && (
              <ThreadReplyBadge
                replyCount={message.replyCount ?? 0}
                lastReplyAt={message.lastReplyAt}
                onClick={handleOpenThread}
              />
            )}
          </>
        )}
      </div>
      {(canEdit || canDelete || canPin || canReact || canThread) && !isEditing && (
        <MessageToolbar
          canEdit={canEdit}
          canDelete={canDelete}
          canPin={canPin}
          canThread={canThread}
          isPinned={isPinned}
          stagedForDelete={stagedForDelete}
          onEdit={handleEditClick}
          onDelete={handleDeleteClick}
          onConfirmDelete={handleConfirmDelete}
          onCancelDelete={handleCancelDelete}
          onEmojiSelect={handleEmojiSelect}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onReplyInThread={handleOpenThread}
        />
      )}
      <ConfirmDialog
        open={showThreadDeleteConfirm}
        title="Delete Message"
        description={`This message has ${message.replyCount ?? 0} thread ${(message.replyCount ?? 0) === 1 ? 'reply' : 'replies'}. Deleting it will also delete all replies.`}
        confirmLabel="Delete All"
        confirmColor="error"
        onConfirm={handleConfirmThreadDelete}
        onCancel={handleCancelThreadDelete}
      />
    </Container>
  );
}

/**
 * Memoized message component to prevent unnecessary re-renders in lists.
 * Only re-renders when the message data actually changes.
 */
const MessageComponent = React.memo(MessageComponentInner, (prevProps, nextProps) => {
  const prevMsg = prevProps.message;
  const nextMsg = nextProps.message;

  // Compare message properties that would require a re-render
  return (
    prevMsg.id === nextMsg.id &&
    prevMsg.editedAt === nextMsg.editedAt &&
    prevMsg.authorId === nextMsg.authorId &&
    prevMsg.sentAt === nextMsg.sentAt &&
    prevMsg.pinned === nextMsg.pinned &&
    prevMsg.replyCount === nextMsg.replyCount &&
    prevMsg.lastReplyAt === nextMsg.lastReplyAt &&
    prevProps.isSearchHighlight === nextProps.isSearchHighlight &&
    prevProps.isThreadParent === nextProps.isThreadParent &&
    prevProps.isThreadReply === nextProps.isThreadReply &&
    prevProps.isAuthor === nextProps.isAuthor &&
    prevProps.contextType === nextProps.contextType &&
    // Deep compare spans array (content equality, not reference)
    prevMsg.spans.length === nextMsg.spans.length &&
    prevMsg.spans.every((s, i) =>
      s.type === nextMsg.spans[i]?.type &&
      s.text === nextMsg.spans[i]?.text
    ) &&
    // Deep compare reactions array (including userIds content)
    prevMsg.reactions.length === nextMsg.reactions.length &&
    prevMsg.reactions.every((r, i) => {
      const prevIds = r.userIds ?? [];
      const nextIds = nextMsg.reactions[i]?.userIds ?? [];
      return (
        r.emoji === nextMsg.reactions[i]?.emoji &&
        prevIds.length === nextIds.length &&
        prevIds.every((uid, j) => uid === nextIds[j])
      );
    }) &&
    // Deep compare attachments array
    prevMsg.attachments?.length === nextMsg.attachments?.length &&
    prevMsg.attachments?.every((a, i) => a.id === nextMsg.attachments?.[i]?.id)
  );
});

export default MessageComponent;
