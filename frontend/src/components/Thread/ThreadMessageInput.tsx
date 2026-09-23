/**
 * ThreadMessageInput Component
 *
 * Input for composing thread reply messages.
 * Uses WebSocket to send messages in real-time.
 */

import React, { useState, useContext, useRef, useCallback } from "react";
import {
  Box,
  TextField,
  IconButton,
  CircularProgress,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import EmojiEmotionsOutlinedIcon from "@mui/icons-material/EmojiEmotionsOutlined";
import { useTheme } from "@mui/material/styles";
import { SocketContext } from "../../utils/SocketContext";
import { ClientEvents } from '@semaphore-chat/shared';
import { SpanType } from "../../types/message.type";
import { logger } from "../../utils/logger";
import { EmojiPickerPopover } from "../Message/EmojiPicker";
import { useResponsive } from "../../hooks/useResponsive";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import { parseMessageWithMentions } from "../../utils/mentionParser";
import type { EmojiMention } from "../../utils/mentionParser";
import { wrapSelection, markerForShortcut } from "../../utils/richTextShortcuts";
import { useCommunityCustomEmojis } from "../../hooks/useCommunityCustomEmojis";

interface ThreadMessageInputProps {
  parentMessageId: string;
  /** Community for custom emojis (undefined in DM threads). */
  communityId?: string;
}

export const ThreadMessageInput: React.FC<ThreadMessageInputProps> = ({
  parentMessageId,
  communityId,
}) => {
  const theme = useTheme();
  const { socket } = useContext(SocketContext);
  const { isTouchDevice, shouldUseTouchUI } = useResponsive();
  // 44px touch targets on touch layouts (TOUCH_TARGETS.MINIMUM), 40px on desktop.
  const actionButtonSize = shouldUseTouchUI ? TOUCH_TARGETS.MINIMUM : 40;
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);

  const { emojis: customEmojis } = useCommunityCustomEmojis(communityId);
  const emojiMentions: EmojiMention[] = customEmojis.map(e => ({
    id: e.id,
    name: e.name,
  }));

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [emojiAnchorEl, setEmojiAnchorEl] = useState<HTMLElement | null>(null);
  const emojiPickerOpen = Boolean(emojiAnchorEl);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const lastSelectionRef = useRef<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  const captureSelection = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      const len = el.value.length;
      lastSelectionRef.current = {
        start: el.selectionStart ?? len,
        end: el.selectionEnd ?? len,
      };
    }
  }, []);

  const handleEmojiButtonClick = (event: React.MouseEvent<HTMLElement>) => {
    captureSelection();
    setEmojiAnchorEl(event.currentTarget);
  };

  // The Popover's `disableRestoreFocus` (see EmojiPickerPopover) intentionally
  // stops MUI from refocusing the emoji button on close, since selecting an
  // emoji instead refocuses the composer input (see handleEmojiSelect).
  // But that means closing WITHOUT selecting (Escape/backdrop click) leaves
  // focus nowhere — restore it to the invoking button in that case only, so
  // it doesn't race the post-select refocus of the input.
  const handleEmojiPickerClose = (
    _event?: unknown,
    reason?: "backdropClick" | "escapeKeyDown",
  ) => {
    setEmojiAnchorEl(null);
    if (reason === "escapeKeyDown" || reason === "backdropClick") {
      requestAnimationFrame(() => {
        emojiButtonRef.current?.focus();
      });
    }
  };

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      // Read the live controlled value instead of using a functional update:
      // StrictMode double-invokes updaters, so side effects inside one
      // (the ref mutation below) would misplace the caret in dev.
      const el = inputRef.current;
      const value = el?.value ?? "";
      const start = Math.min(lastSelectionRef.current.start, value.length);
      const end = Math.min(lastSelectionRef.current.end, value.length);
      const newPos = start + emoji.length;
      lastSelectionRef.current = { start: newPos, end: newPos };
      setContent(value.slice(0, start) + emoji + value.slice(end));

      if (!isTouchDevice) {
        requestAnimationFrame(() => {
          const input = inputRef.current;
          if (input) {
            input.focus();
            input.setSelectionRange(newPos, newPos);
          }
        });
      }
    },
    [isTouchDevice]
  );

  const handleSend = async () => {
    const trimmedContent = content.trim();
    if (!trimmedContent || isSending) return;

    setIsSending(true);

    if (!socket?.connected) {
      logger.error("Socket not connected");
      setIsSending(false);
      return;
    }

    // Parse markdown-style rich-text formatting (bold/italic/strike/code).
    // Thread replies have no mention autocomplete context, so mentions are
    // left unresolved (rendered as plaintext), matching prior behaviour.
    let spans = parseMessageWithMentions(trimmedContent, [], [], [], emojiMentions);
    if (spans.length === 0) {
      spans = [{ type: SpanType.PLAINTEXT, text: trimmedContent }];
    }

    const payload = {
      parentMessageId,
      spans,
      attachments: [],
      pendingAttachments: 0,
    };

    socket.emit(ClientEvents.SEND_THREAD_REPLY, payload, (response: string | { error: string }) => {
      setIsSending(false);
      if (typeof response === "string") {
        // Success - response is the message ID
        setContent("");
      } else if (response?.error) {
        logger.error("Failed to send thread reply:", response.error);
      }
    });
  };

  const applyFormattingShortcut = (e: React.KeyboardEvent): boolean => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
    const marker = markerForShortcut(e.key);
    if (!marker) return false;
    e.preventDefault();
    const el = inputRef.current;
    if (!el) return true;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const result = wrapSelection(el.value, start, end, marker);
    setContent(result.newText);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(result.selectionStart, result.selectionEnd);
      }
    });
    return true;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (applyFormattingShortcut(e)) return;
    // Touch: Enter inserts a newline (send via button only). Desktop: Enter sends.
    if (e.key === "Enter" && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasContent = content.trim().length > 0;
  const emojiButton = (
    <IconButton
      ref={emojiButtonRef}
      onClick={handleEmojiButtonClick}
      disabled={isSending}
      aria-label="add emoji"
      aria-haspopup="true"
      aria-expanded={emojiPickerOpen}
      sx={{
        width: actionButtonSize,
        height: actionButtonSize,
      }}
    >
      <EmojiEmotionsOutlinedIcon />
    </IconButton>
  );
  const sendButton = (
    <IconButton
      color="primary"
      onClick={handleSend}
      disabled={!content.trim() || isSending}
      aria-label="send"
      sx={{
        width: actionButtonSize,
        height: actionButtonSize,
      }}
    >
      {isSending ? (
        <CircularProgress size={20} />
      ) : (
        <SendIcon />
      )}
    </IconButton>
  );

  return (
    <Box
      sx={{
        p: 2,
        flexShrink: 0,
        borderTop: 1,
        borderColor: "divider",
        backgroundColor: theme.palette.background.paper,
      }}
    >
      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
        {/* Touch: same shape as the main composer — the extra action sits
            on the left and the send button only appears once there's text. */}
        {shouldUseTouchUI && emojiButton}
        <TextField
          fullWidth
          multiline
          maxRows={4}
          placeholder="Reply..."
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            captureSelection();
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={captureSelection}
          onClick={captureSelection}
          onSelect={captureSelection}
          disabled={isSending}
          size="small"
          inputRef={inputRef}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
            },
          }}
        />
        {!shouldUseTouchUI && emojiButton}
        {(!shouldUseTouchUI || hasContent || isSending) && sendButton}
      </Box>

      <EmojiPickerPopover
        open={emojiPickerOpen}
        anchorEl={emojiAnchorEl}
        onClose={handleEmojiPickerClose}
        onEmojiSelect={handleEmojiSelect}
        communityId={communityId}
        onCustomEmojiSelect={(emoji) => handleEmojiSelect(`:${emoji.name}:`)}
        title="Add Emoji"
      />
    </Box>
  );
};

export default ThreadMessageInput;
