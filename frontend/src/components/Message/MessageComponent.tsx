/**
 * MessageComponent
 *
 * Main message display component.
 * Orchestrates message rendering, editing, deletion, and reactions.
 */

import React, { useState, useCallback } from "react";
import { Avatar, Typography, Tooltip, Box, Chip, Link } from "@mui/material";
import PushPinIcon from "@mui/icons-material/PushPin";
import ScheduleIcon from "@mui/icons-material/Schedule";
import type { Message as MessageType } from "../../types/message.type";
import { useQuery } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions } from "../../api-client/@tanstack/react-query.gen";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useMessagePermissions } from "../../hooks/useMessagePermissions";
import { MessageReactions } from "./MessageReactions";
import { MessageAttachments } from "./MessageAttachments";
import { MessageLinkPreviews } from "./MessageLinkPreviews";
import { MessageEditForm } from "./MessageEditForm";
import { MessageToolbar } from "./MessageToolbar";
import { renderMessageSpans } from "./MessageSpan";
import { Container } from "./MessageComponentStyles";
import { useMessageActions } from "./useMessageActions";
import { isUserMentioned, getMessageLoneGifUrl } from "./messageUtils";
import { GifEmbed } from "./GifEmbed";
import UserAvatar from "../Common/UserAvatar";
import ConfirmDialog from "../Common/ConfirmDialog";
import { ThreadReplyBadge } from "../Thread/ThreadReplyBadge";
import QuotePreview from "./QuotePreview";
import { useUserProfile } from "../../contexts/UserProfileContext";
import { SeenByTooltip } from "./SeenByTooltip";
import { VoiceSessionType } from "../../contexts/VoiceContext";
import MessageContextMenu from "./MessageContextMenu";
import MessageActionsSheet from "./MessageActionsSheet";
import { EmojiPickerPopover } from "./EmojiPicker";
import { useResponsive } from "../../hooks/useResponsive";
import { useLongPress } from "../../hooks/useSwipeGesture";
import { useCommunityCustomEmojis } from "../../hooks/useCommunityCustomEmojis";
import { useContextMenuFocusRestore } from "../../hooks/useContextMenuFocusRestore";
import { OptimisticMessageActions } from "./OptimisticMessageActions";
import { formatClockTime, formatFullTimestamp, formatMessageTime } from "../../utils/messageTime";

/** Avatar column width (32px avatar + 12px gap) — grouped rows keep it empty
 * (or show the hover time) so their text lines up with the header row. */
const AVATAR_GUTTER_PX = 44;

interface MessageStatusMarksProps {
  edited: boolean;
  isPending: boolean;
  showSeenBy: boolean;
  sentAt: string;
  contextId?: string;
  isPinned: boolean;
}

/** "(edited)", the sending clock, DM seen-by and the pin marker — shown after
 * the time on a header row, or inline after the text on a grouped row. */
function MessageStatusMarks({ edited, isPending, showSeenBy, sentAt, contextId, isPinned }: MessageStatusMarksProps) {
  if (!edited && !isPending && !showSeenBy && !isPinned) return null;
  return (
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      sx={{ display: "inline-flex", alignItems: "center", flexShrink: 0, whiteSpace: "nowrap", verticalAlign: "baseline" }}
    >
      {edited && <span>(edited)</span>}
      {isPending && (
        <Tooltip title="Sending...">
          <ScheduleIcon
            data-testid="message-pending-icon"
            sx={{ fontSize: 13, ml: 0.5, verticalAlign: "text-bottom" }}
          />
        </Tooltip>
      )}
      {/* Read status for own messages in DMs with "seen by" tooltip */}
      {showSeenBy && contextId && (
        <SeenByTooltip sentAt={sentAt} directMessageGroupId={contextId} />
      )}
      {isPinned && (
        <Tooltip title="Pinned message">
          <PushPinIcon sx={{ fontSize: 14, color: "primary.main", ml: 0.5 }} />
        </Tooltip>
      )}
    </Typography>
  );
}

interface MessageProps {
  message: MessageType;
  /** Continues the previous message's same-author run: hides the avatar and
   * author line, and shows the time in the gutter on hover / long-press. */
  grouped?: boolean;
  isAuthor?: boolean;
  isSearchHighlight?: boolean;
  contextId?: string;
  communityId?: string;
  isThreadParent?: boolean;
  isThreadReply?: boolean;
  onOpenThread?: (message: MessageType) => void;
  onQuoteReply?: (message: MessageType) => void;
  /** Context type to determine if read receipts should be shown */
  contextType?: VoiceSessionType;

  // ── Roving row focus (keyboard navigation across the message list) ──
  /** This row's position in the rendered (chronological) order. Required for
   * roving-focus key handling to report the right target to the parent. */
  rowIndex?: number;
  /** True when this row is the current roving-tabindex target (tabIndex=0). */
  isRovingFocused?: boolean;
  /** ArrowUp/Down/Home/End/Escape, delegated up — the parent owns index math,
   * scrolling the target into view, and imperatively focusing it once mounted. */
  onRovingKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>, index: number) => void;
  /** Fired when this row's Container actually receives DOM focus (Tab, a
   * mouse-driven restore, or the parent's own imperative focus after an
   * arrow-key move) — keeps the parent's roving-tabindex state in sync with
   * reality regardless of how focus got here. */
  onRovingFocus?: (index: number) => void;
  /** Stable ref to the list's scroll container — passed to the context-menu
   * focus-restore fallback so a row deleted while its menu is still closing
   * doesn't drop focus to <body> (mirrors MemberList's wiring from #428). */
  listContainerRef?: React.RefObject<HTMLElement | null>;
}

function MessageComponentInner({
  message,
  grouped = false,
  isAuthor,
  isSearchHighlight,
  contextId,
  communityId,
  isThreadParent,
  isThreadReply,
  onOpenThread,
  onQuoteReply,
  contextType,
  rowIndex,
  isRovingFocused,
  onRovingKeyDown,
  onRovingFocus,
  listContainerRef,
}: MessageProps) {
  // Community custom emojis (for rendering EMOJI spans + custom reactions).
  const { byId: emojiById } = useCommunityCustomEmojis(communityId);
  const isWebhookMessage = !!message.webhook;
  // Optimistic (not-yet-settled) send — see types/message.type.ts. Neither
  // state has a real, persisted message id, so every action that would hit
  // the API (edit/delete/pin/react/thread) is disabled below; retry/delete
  // for the optimistic row itself is handled by OptimisticMessageActions.
  const isPending = message.sendStatus === 'pending';
  const isFailed = message.sendStatus === 'failed';
  const isOptimistic = isPending || isFailed;
  const { data: author } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: message.authorId ?? '' } }),
    // Webhook messages have no authorId — skip the user lookup entirely.
    enabled: !!message.authorId && !isWebhookMessage,
  });
  const { user: currentUser } = useCurrentUser();
  const { openProfile } = useUserProfile();

  // Check if this message mentions the current user
  const isMentioned = isUserMentioned(message, currentUser?.id);

  // Discord-style GIF embed: a message whose entire content is a lone GIF
  // URL (sent by the GIF picker, or a legacy Tenor-era message) renders as
  // an inline <img> instead of raw link text + a link-preview card. If the
  // image fails to load, fall back to the original rendering rather than
  // showing nothing.
  const [gifEmbedFailed, setGifEmbedFailed] = useState(false);
  const gifUrl = gifEmbedFailed ? null : getMessageLoneGifUrl(message);

  // Use extracted hook for cleaner permission logic
  const messagePermissions = useMessagePermissions({
    message,
    currentUserId: currentUser?.id,
  });
  const canEdit = messagePermissions.canEdit && !isOptimistic;
  const canDelete = messagePermissions.canDelete && !isOptimistic;
  const canPin = messagePermissions.canPin && !isOptimistic;
  const canReact = messagePermissions.canReact && !isOptimistic;

  const isPinned = message.pinned === true;

  // Thread logic: Can start a thread if not already a thread reply and handler is provided
  const canThread = !isOptimistic && !isThreadReply && !isThreadParent && !!onOpenThread;
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

  const { shouldUseTouchUI } = useResponsive();

  // Context menu state
  const [contextMenuPosition, setContextMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [emojiPickerPosition, setEmojiPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);

  const { captureTrigger, restoreFocus } = useContextMenuFocusRestore();

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    captureTrigger(event.currentTarget as HTMLElement);
    setContextMenuPosition({ top: event.clientY, left: event.clientX });
    // Right-click also claims the roving-tabindex slot for this row, so
    // keyboard navigation resumes from here once the menu closes (instead of
    // wherever it happened to be before the click).
    if (rowIndex !== undefined) onRovingFocus?.(rowIndex);
  }, [captureTrigger, rowIndex, onRovingFocus]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuPosition(null);
    // Right-click (and long-press) open this menu with no keyboard-reachable
    // invoker button, so — unlike an anchorEl Menu — MUI can't auto-restore
    // focus. Return it to the message row itself. If the row was removed
    // from the list while the menu was still closing (e.g. deleted), fall
    // back to the list's scroll container instead of dropping to <body>.
    restoreFocus(listContainerRef?.current);
  }, [restoreFocus, listContainerRef]);

  /**
   * Enter / ContextMenu (menu key) / Shift+F10 open the row's action menu
   * from the keyboard, positioned near the focused row itself (there's no
   * MouseEvent to read a click position from). Guarded to only fire when the
   * Container itself is the focus target — bubbled keydowns from the edit
   * textarea, toolbar buttons, or menu items must not be hijacked.
   */
  const handleContainerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;

      if (
        event.key === 'Enter' ||
        event.key === 'ContextMenu' ||
        (event.shiftKey && event.key === 'F10')
      ) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        captureTrigger(event.currentTarget);
        setContextMenuPosition({ top: rect.bottom, left: rect.left });
        if (rowIndex !== undefined) onRovingFocus?.(rowIndex);
        return;
      }

      if (rowIndex !== undefined) {
        onRovingKeyDown?.(event, rowIndex);
      }
    },
    [captureTrigger, rowIndex, onRovingFocus, onRovingKeyDown],
  );

  const handleContainerFocus = useCallback(() => {
    if (rowIndex !== undefined) onRovingFocus?.(rowIndex);
  }, [rowIndex, onRovingFocus]);

  const handleAddReaction = useCallback(() => {
    // Save position for emoji picker, close context menu
    setEmojiPickerPosition(contextMenuPosition);
    setContextMenuPosition(null);
  }, [contextMenuPosition]);

  // Touch: long-press opens the mobile actions sheet
  const handleOpenActionsSheet = useCallback(() => {
    setActionsSheetOpen(true);
  }, []);

  const longPress = useLongPress(handleOpenActionsSheet, {
    enabled: shouldUseTouchUI && !isEditing,
  });

  // Touch: "Add Reaction" / "+" opens the emoji picker (as a bottom sheet)
  const handleSheetAddReaction = useCallback(() => {
    setEmojiPickerOpen(true);
  }, []);

  const handleCloseEmojiPicker = useCallback(() => {
    setEmojiPickerPosition(null);
    setEmojiPickerOpen(false);
    // Reuses the same trigger captured on right-click: "Add Reaction" is
    // reached via the context menu, so closing the emoji picker should
    // return focus to the message row too (a no-op if it was opened via
    // the touch sheet instead, since no trigger was captured for that path).
    // Same list-container fallback as handleCloseContextMenu.
    restoreFocus(listContainerRef?.current);
  }, [restoreFocus, listContainerRef]);

  // Under touch UI, wire long-press handlers and suppress native selection /
  // context menu; otherwise keep desktop right-click behavior untouched.
  // While editing on touch, attach nothing so native text selection and the
  // clipboard callout work inside the edit form.
  const containerInteractionProps = shouldUseTouchUI
    ? isEditing
      ? {}
      : {
          onTouchStart: longPress.onTouchStart,
          onTouchMove: longPress.onTouchMove,
          onTouchEnd: longPress.onTouchEnd,
          onTouchCancel: longPress.onTouchCancel,
          onContextMenu: longPress.onContextMenu,
          style: { WebkitTouchCallout: "none", userSelect: "none" } as React.CSSProperties,
        }
    : { onContextMenu: handleContextMenu };

  return (
    <Container
      stagedForDelete={stagedForDelete}
      isDeleting={isDeleting}
      isHighlighted={isMentioned}
      isSearchHighlight={isSearchHighlight}
      isPending={isPending}
      isFailed={isFailed}
      grouped={grouped}
      data-grouped={grouped ? "true" : undefined}
      // Roving tabindex: only the current roving-focus row is in the natural
      // Tab order (0); every other row is -1 — still focusable
      // programmatically (context-menu restore, arrow-key navigation).
      tabIndex={isRovingFocused ? 0 : -1}
      data-row-focus-target="true"
      onKeyDown={handleContainerKeyDown}
      onFocus={handleContainerFocus}
      {...containerInteractionProps}
    >
      {grouped ? (
        <Tooltip title={formatFullTimestamp(message.sentAt)} placement="left" enterDelay={500}>
          <Typography
            component="span"
            variant="caption"
            data-testid="message-hover-time"
            className="message-hover-time"
            noWrap
            sx={{
              width: AVATAR_GUTTER_PX,
              flexShrink: 0,
              pr: 1,
              // Vertically centred on the first line of body1 text.
              lineHeight: 1.5,
              pt: "3px",
              fontSize: "0.625rem",
              textAlign: "right",
              color: "text.secondary",
              opacity: actionsSheetOpen ? 1 : 0,
              transition: "opacity 0.15s",
            }}
          >
            {formatClockTime(message.sentAt)}
          </Typography>
        </Tooltip>
      ) : (
        <div style={{ width: 32, marginRight: 12, marginTop: 4, flexShrink: 0 }}>
          {isWebhookMessage ? (
            <Avatar
              src={message.webhook?.avatarUrl ?? undefined}
              sx={{ width: 32, height: 32 }}
            >
              {message.webhook!.name.charAt(0).toUpperCase()}
            </Avatar>
          ) : (
            <UserAvatar
              userId={message.authorId ?? undefined}
              size="small"
              clickable={!!message.authorId}
            />
          )}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!grouped && (
        <Box
          data-testid="message-author-line"
          sx={{ display: "flex", alignItems: "baseline", gap: 0.75, minWidth: 0, flexWrap: "nowrap" }}
        >
          {isWebhookMessage ? (
            <>
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: 700, color: "text.primary", minWidth: 0 }}
              >
                {message.webhook!.name}
              </Typography>
              <Chip label="APP" size="small" sx={{ height: 18, fontSize: 10, flexShrink: 0, alignSelf: "center" }} />
            </>
          ) : message.authorId ? (
            <Link
              component="button"
              variant="body2"
              noWrap
              onClick={() => openProfile(message.authorId!)}
              sx={{
                display: "block",
                minWidth: 0,
                maxWidth: "100%",
                textAlign: "start",
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
              noWrap
              sx={{
                fontWeight: 700,
                color: "text.secondary",
                fontStyle: "italic",
                minWidth: 0,
              }}
            >
              [Deleted User]
            </Typography>
          )}
          <Tooltip title={formatFullTimestamp(message.sentAt)} enterDelay={500}>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              data-testid="message-time"
              sx={{ flexShrink: 0 }}
            >
              {formatMessageTime(message.sentAt)}
            </Typography>
          </Tooltip>
          <MessageStatusMarks
            edited={!!message.editedAt}
            isPending={isPending}
            showSeenBy={contextType === VoiceSessionType.Dm && !!isAuthor && !!contextId}
            sentAt={message.sentAt}
            contextId={contextId}
            isPinned={isPinned}
          />
        </Box>
        )}
        {message.replyTo && (
          <QuotePreview
            replyTo={message.replyTo}
            channelId={message.channelId ?? undefined}
            directMessageGroupId={message.directMessageGroupId ?? undefined}
          />
        )}
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
            {gifUrl ? (
              <GifEmbed url={gifUrl} onError={() => setGifEmbedFailed(true)} />
            ) : (
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                {renderMessageSpans(message.spans, emojiById)}
                {grouped && (
                  <>
                    {" "}
                    <MessageStatusMarks
                      edited={!!message.editedAt}
                      isPending={isPending}
                      showSeenBy={contextType === VoiceSessionType.Dm && !!isAuthor && !!contextId}
                      sentAt={message.sentAt}
                      contextId={contextId}
                      isPinned={isPinned}
                    />
                  </>
                )}
              </Typography>
            )}
            <MessageAttachments attachments={message.attachments} />
            {!gifUrl && <MessageLinkPreviews linkPreviews={message.linkPreviews} />}
            <MessageReactions
              messageId={message.id}
              reactions={message.reactions}
              onReactionClick={handleReactionClick}
              emojiById={emojiById}
            />
            {/* Show thread reply badge if message has replies and not in thread context */}
            {hasReplies && !isThreadParent && !isThreadReply && (
              <ThreadReplyBadge
                replyCount={message.replyCount ?? 0}
                lastReplyAt={message.lastReplyAt}
                onClick={handleOpenThread}
              />
            )}
            {isFailed && <OptimisticMessageActions message={message} />}
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
          onQuoteReply={onQuoteReply && !message.deletedAt && !isOptimistic ? () => onQuoteReply(message) : undefined}
          communityId={communityId}
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
      <MessageContextMenu
        anchorPosition={contextMenuPosition}
        open={Boolean(contextMenuPosition)}
        onClose={handleCloseContextMenu}
        message={message}
        canEdit={canEdit}
        canDelete={canDelete}
        canPin={canPin}
        canReact={canReact}
        canThread={canThread}
        isPinned={isPinned}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
        onPin={handlePin}
        onUnpin={handleUnpin}
        onReplyInThread={handleOpenThread}
        onQuoteReply={onQuoteReply && !message.deletedAt && !isOptimistic ? () => onQuoteReply(message) : undefined}
        onAddReaction={handleAddReaction}
      />
      {shouldUseTouchUI && (
        <MessageActionsSheet
          open={actionsSheetOpen}
          onClose={() => setActionsSheetOpen(false)}
          anchorPosition={null}
          message={message}
          canEdit={canEdit}
          canDelete={canDelete}
          canPin={canPin}
          canReact={canReact}
          canThread={canThread}
          isPinned={isPinned}
          onEdit={handleEditClick}
          onDelete={handleDeleteClick}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onReplyInThread={handleOpenThread}
          onQuoteReply={onQuoteReply && !message.deletedAt && !isOptimistic ? () => onQuoteReply(message) : undefined}
          onAddReaction={handleSheetAddReaction}
          onEmojiSelect={handleEmojiSelect}
        />
      )}
      <EmojiPickerPopover
        open={Boolean(emojiPickerPosition) || emojiPickerOpen}
        anchorPosition={emojiPickerPosition}
        onClose={handleCloseEmojiPicker}
        onEmojiSelect={(emoji) => {
          handleEmojiSelect(emoji);
          handleCloseEmojiPicker();
        }}
        communityId={communityId}
        onCustomEmojiSelect={(emoji) => {
          handleEmojiSelect(`custom:${emoji.id}`);
          handleCloseEmojiPicker();
        }}
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
    prevMsg.replyToId === nextMsg.replyToId &&
    prevMsg.deletedAt === nextMsg.deletedAt &&
    prevMsg.sendStatus === nextMsg.sendStatus &&
    prevProps.grouped === nextProps.grouped &&
    prevProps.isSearchHighlight === nextProps.isSearchHighlight &&
    prevProps.isThreadParent === nextProps.isThreadParent &&
    prevProps.isThreadReply === nextProps.isThreadReply &&
    prevProps.isAuthor === nextProps.isAuthor &&
    prevProps.contextType === nextProps.contextType &&
    // Roving-focus wiring: these genuinely change per-row across renders
    // (a prepend shifts rowIndex; focus moving changes isRovingFocused for
    // exactly two rows) and must not be skipped by the memo, or a row can
    // end up with a stale index closure or a stuck tabIndex.
    prevProps.rowIndex === nextProps.rowIndex &&
    prevProps.isRovingFocused === nextProps.isRovingFocused &&
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
    prevMsg.attachments?.every((a, i) => a.id === nextMsg.attachments?.[i]?.id) &&
    // Compare link previews (length + URLs + titles cover content changes)
    (prevMsg.linkPreviews?.length ?? 0) === (nextMsg.linkPreviews?.length ?? 0) &&
    (prevMsg.linkPreviews?.every((lp, i) =>
      lp.url === nextMsg.linkPreviews?.[i]?.url &&
      lp.title === nextMsg.linkPreviews?.[i]?.title &&
      lp.imageUrl === nextMsg.linkPreviews?.[i]?.imageUrl
    ) ?? true)
  );
});

export default MessageComponent;
