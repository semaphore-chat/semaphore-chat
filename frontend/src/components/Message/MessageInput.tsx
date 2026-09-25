/**
 * MessageInput Component
 *
 * Unified message input for both channel and DM contexts.
 * Uses server-backed mention autocomplete for channels (with alias groups)
 * and simple local filtering for DMs.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Box,
  IconButton,
  CircularProgress,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import EmojiEmotionsOutlinedIcon from "@mui/icons-material/EmojiEmotionsOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import BlockIcon from "@mui/icons-material/Block";
import { StyledNoticePaper, StyledPaper, StyledTextField } from "./MessageInputStyles";
import { EmojiPickerPopover } from "./EmojiPicker";
import { GifPickerPopover } from "./GifPicker";
import type { GifResultDto } from "../../api-client/types.gen";
import { instanceControllerGetPublicSettingsOptions } from "../../api-client/@tanstack/react-query.gen";
import GifBoxOutlinedIcon from "@mui/icons-material/GifBoxOutlined";
import { useResponsive } from "../../hooks/useResponsive";
import { useKeyboardInset } from "../../contexts/BottomChromeContext";
import { MobileSheet } from "../Mobile/common/MobileSheet";
import { TOUCH_TARGETS } from "../../utils/breakpoints";
import { FilePreview } from "./FilePreview";
import { MentionDropdown } from "./MentionDropdown";
import { MENTION_LISTBOX_ID, mentionOptionId } from "./mentionDropdownIds";
import { useFileAttachments } from "./useFileAttachments";
import { useDropZone } from "./useDropZone";
import { DropZoneOverlay } from "./DropZoneOverlay";
import { useMentionHandling } from "./useMentionHandling";
import type { MentionSuggestion } from "./useMentionHandling";
import { useMentionAutocomplete } from "../../hooks/useMentionAutocomplete";
import {
  parseMessageWithMentions,
  getCurrentMention,
  insertMention,
} from "../../utils/mentionParser";
import type {
  UserMention,
  ChannelMention,
  AliasMention,
  EmojiMention,
} from "../../utils/mentionParser";
import { wrapSelection, markerForShortcut } from "../../utils/richTextShortcuts";
import { useQuery } from "@tanstack/react-query";
import { aliasGroupsControllerGetCommunityAliasGroupsOptions } from "../../api-client/@tanstack/react-query.gen";
import { useCommunityCustomEmojis } from "../../hooks/useCommunityCustomEmojis";
import { logger } from "../../utils/logger";
import { ACCEPTED_FILE_TYPES } from "../../constants/messages";
import { useNotification } from "../../contexts/NotificationContext";
import { useTypingEmitter } from "../../hooks/useTypingEmitter";
import type { Span } from "../../types/message.type";
import { SpanType } from "../../types/message.type";
import { VoiceSessionType } from "../../contexts/VoiceContext";
import { useComposerAvailability } from "../../hooks/useComposerAvailability";
import type { ComposerAvailability } from "../../hooks/useComposerAvailability";
import { useComposerDraft } from "../../hooks/useComposerDraft";

export interface MessageInputProps {
  contextType: VoiceSessionType;
  contextId: string;
  userMentions: UserMention[];
  channelMentions?: ChannelMention[];
  onSendMessage: (messageContent: string, spans: Span[], files?: File[]) => void;
  placeholder?: string;
  communityId?: string;
}

/** "12 min", "2 h 5 min", "42 s" — rounded up so it never reads "0". */
function formatTimeLeft(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function noticeCopy(availability: ComposerAvailability): string {
  switch (availability.state) {
    case "no-permission":
      return availability.channelName
        ? `You can't send messages in #${availability.channelName}`
        : "You can't send messages in this channel";
    case "timed-out":
      return availability.remainingMs !== undefined
        ? `Timed out, ${formatTimeLeft(availability.remainingMs)} left`
        : "You're timed out in this community";
    case "banned":
      return "You're banned from this community";
    default:
      return "";
  }
}

/** Non-editable stand-in for the composer when the user can't post here. */
export function ComposerUnavailableNotice({ availability }: { availability: ComposerAvailability }) {
  const Icon =
    availability.state === "timed-out"
      ? TimerOutlinedIcon
      : availability.state === "banned"
        ? BlockIcon
        : LockOutlinedIcon;
  return (
    <StyledNoticePaper elevation={2} role="status" data-testid="composer-unavailable">
      <Icon fontSize="small" aria-hidden />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
          {noticeCopy(availability)}
        </Typography>
        {availability.reason && (
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", overflowWrap: "anywhere" }}>
            Reason: {availability.reason}
          </Typography>
        )}
      </Box>
    </StyledNoticePaper>
  );
}

// --- Local mention state for DM context ---
interface SimpleMentionState {
  isOpen: boolean;
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  query: string;
  type: 'user' | 'special' | null;
  isLoading: boolean;
}

export default function MessageInput({
  contextType,
  contextId,
  userMentions,
  channelMentions = [],
  onSendMessage,
  placeholder = "Type a message...",
  communityId,
}: MessageInputProps) {
  // The unsent text is a per-conversation draft, so it survives this
  // composer unmounting (e.g. switching screens on mobile).
  const [text, setText, clearDraft] = useComposerDraft(
    `${contextType === VoiceSessionType.Channel ? "channel" : "dm"}:${contextId}`,
  );
  // LOAD-BEARING for optimistic-send correctness: `sending` serializes
  // composer submits until the current send's ack/timeout settles, which is
  // what makes two same-author PENDING rows with identical content
  // unreachable from the composer alone (echo correlation is content-based —
  // see messageCacheUpdaters.ts). If this ever becomes fire-and-forget, land
  // the server-echoed client nonce follow-up first.
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showNotification } = useNotification();
  const { isTouchDevice, shouldUseTouchUI } = useResponsive();
  const keyboardOpen = useKeyboardInset() > 0;
  // Touch layouts get the slim composer: one "+" (Attach / GIF / Emoji in a
  // sheet), the text field, and send only once there's something to send.
  const compactComposer = shouldUseTouchUI;
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const availability = useComposerAvailability({ contextType, contextId, communityId });
  const canCompose = availability.state === "ok";

  // Emoji picker state + last-known selection (captured before the picker steals focus)
  const [emojiAnchorEl, setEmojiAnchorEl] = useState<HTMLElement | null>(null);
  const emojiPickerOpen = Boolean(emojiAnchorEl);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const lastSelectionRef = useRef<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  // GIF picker state
  const [gifAnchorEl, setGifAnchorEl] = useState<HTMLElement | null>(null);
  const gifPickerOpen = Boolean(gifAnchorEl);
  const { data: publicSettings } = useQuery(
    instanceControllerGetPublicSettingsOptions(),
  );
  const gifSearchEnabled = Boolean(publicSettings?.gifSearchEnabled);

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

  // Typing indicator emitter
  const { handleKeyPress: emitTypingKeyPress, sendTypingStop } = useTypingEmitter(
    contextType === VoiceSessionType.Channel
      ? { channelId: contextId }
      : { directMessageGroupId: contextId },
  );

  const isChannel = contextType === VoiceSessionType.Channel && !!communityId;

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // --- File attachments ---
  const {
    selectedFiles,
    filePreviews,
    fileInputRef,
    handleFileSelect,
    handleFileDrop,
    handleRemoveFile,
    handleFileButtonClick,
    clearFiles,
    validationError,
    clearValidationError,
  } = useFileAttachments();

  const { isDragOver, dropZoneProps } = useDropZone({ onDrop: handleFileDrop });

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        handleFileDrop(files);
      }
    },
    [handleFileDrop]
  );

  useEffect(() => {
    if (validationError) {
      showNotification(validationError, "error");
      clearValidationError();
    }
  }, [validationError, showNotification, clearValidationError]);

  // --- Cursor tracking ---
  const {
    cursorPosition,
    updateCursorPosition,
    handleInsertMention: insertMentionUtil,
    setupCursorTracking,
  } = useMentionHandling();

  useEffect(() => {
    setupCursorTracking(inputRef);
  }, [setupCursorTracking, canCompose]);

  // Focus on mount, and again if posting becomes possible (e.g. a timeout
  // expires) since the input only mounts then. Without scrolling: on phone the
  // chat screen is still sliding in (off to the right) when this runs, and a
  // scrolling focus() would scroll the overflow-hidden screen container
  // sideways, leaving the whole chat shifted left once the slide ends.
  useEffect(() => {
    if (canCompose) inputRef.current?.focus({ preventScroll: true });
  }, [canCompose]);

  // --- Mention system: server-backed (channels) or local (DMs) ---
  const mentionHook = useMentionAutocomplete({
    communityId: communityId || '',
    text,
    cursorPosition,
  });

  // Alias groups (channel only)
  const { data: aliasGroups = [] } = useQuery({
    ...aliasGroupsControllerGetCommunityAliasGroupsOptions({ path: { communityId: communityId || '' } }),
    enabled: isChannel,
  });

  const aliasMentions: AliasMention[] = useMemo(
    () =>
      isChannel
        ? aliasGroups.map(group => ({ id: group.id, name: group.name }))
        : [],
    [isChannel, aliasGroups],
  );

  // Custom emojis (channel only) — used to resolve `:shortcode:` at send time
  // and to power the picker's Custom section.
  const { emojis: customEmojis } = useCommunityCustomEmojis(
    isChannel ? communityId : undefined,
  );
  const emojiMentions: EmojiMention[] = useMemo(
    () => customEmojis.map(e => ({ id: e.id, name: e.name })),
    [customEmojis],
  );

  // Local mention state for DMs
  const [dmMentionState, setDmMentionState] = useState<SimpleMentionState>({
    isOpen: false,
    suggestions: [],
    selectedIndex: 0,
    query: "",
    type: null,
    isLoading: false,
  });

  const closeDmMentions = useCallback(() => {
    setDmMentionState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const handleDmInsertMention = useCallback(
    (mention: MentionSuggestion) => {
      insertMentionUtil(mention, text, setText, closeDmMentions);
    },
    [insertMentionUtil, text, setText, closeDmMentions]
  );

  // DM mention detection
  useEffect(() => {
    if (isChannel) return;

    const currentMention = getCurrentMention(text, cursorPosition);
    if (currentMention && currentMention.query) {
      const filteredUsers = userMentions.filter(user =>
        (user.displayName || user.username).toLowerCase().includes(currentMention.query.toLowerCase())
      );

      setDmMentionState(prev => {
        const newSuggestions = filteredUsers.map(user => ({
          id: user.id,
          type: 'user' as const,
          displayName: user.displayName || user.username,
          subtitle: user.username !== user.displayName ? `@${user.username}` : undefined,
          username: user.username,
        }));

        const shouldOpen = filteredUsers.length > 0;
        if (prev.isOpen === shouldOpen &&
            prev.query === currentMention.query &&
            JSON.stringify(prev.suggestions) === JSON.stringify(newSuggestions)) {
          return prev;
        }

        return {
          isOpen: shouldOpen,
          suggestions: newSuggestions,
          selectedIndex: 0,
          query: currentMention.query,
          type: 'user' as const,
          isLoading: false,
        };
      });
    } else {
      setDmMentionState(prev => prev.isOpen ? { ...prev, isOpen: false } : prev);
    }
  }, [text, cursorPosition, userMentions, isChannel]);

  // --- Unified mention state ---
  const mentionIsOpen = isChannel ? mentionHook.state.isOpen : dmMentionState.isOpen;
  const mentionSuggestions = isChannel ? mentionHook.state.suggestions : dmMentionState.suggestions;
  const mentionSelectedIndex = isChannel ? mentionHook.state.selectedIndex : dmMentionState.selectedIndex;
  const mentionIsLoading = isChannel ? mentionHook.state.isLoading : dmMentionState.isLoading;

  // --- Mention selection handlers ---
  const handleMentionSelect = (index: number) => {
    if (isChannel) {
      const selectedSuggestion = mentionHook.state.suggestions[index];
      if (!selectedSuggestion) return;

      const mentionData = {
        type: selectedSuggestion.type,
        username: selectedSuggestion.type === "user" ? selectedSuggestion.displayName : undefined,
        specialKind: selectedSuggestion.type === "special" ? selectedSuggestion.displayName : undefined,
        aliasName: selectedSuggestion.type === "alias" ? selectedSuggestion.displayName : undefined,
      };

      const result = insertMention(text, cursorPosition, mentionData);
      setText(result.newText);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(result.newCursorPosition, result.newCursorPosition);
        }
        timeoutRef.current = null;
      }, 0);

      mentionHook.close();
    } else {
      const selectedSuggestion = dmMentionState.suggestions[index];
      if (selectedSuggestion) {
        handleDmInsertMention(selectedSuggestion);
      }
    }
  };

  // --- DM mention keyboard handling ---
  const handleDmMentionKeyDown = (event: KeyboardEvent): boolean => {
    if (!dmMentionState.isOpen) return false;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        setDmMentionState(prev => ({
          ...prev,
          selectedIndex: Math.max(0, prev.selectedIndex - 1)
        }));
        return true;
      case 'ArrowDown':
        event.preventDefault();
        setDmMentionState(prev => ({
          ...prev,
          selectedIndex: Math.min(prev.suggestions.length - 1, prev.selectedIndex + 1)
        }));
        return true;
      case 'Tab':
      case 'Enter': {
        event.preventDefault();
        const selected = dmMentionState.suggestions[dmMentionState.selectedIndex];
        if (selected) {
          handleDmInsertMention(selected);
        }
        return true;
      }
      case 'Escape':
        event.preventDefault();
        closeDmMentions();
        return true;
      default:
        return false;
    }
  };

  // --- Send (core) ---
  // Shared by the composer's send button/Enter key and the GIF picker, so
  // there is exactly one place that builds spans and calls onSendMessage.
  // Returns whether the message was actually sent (false = no-op or error).
  const sendMessageContent = useCallback(
    async (rawText: string, files: File[]): Promise<boolean> => {
      if ((!rawText || !rawText.trim()) && files.length === 0) return false;
      if (sending) return false;

      setSending(true);
      try {
        const messageText = rawText.trim() || "";
        let spans = parseMessageWithMentions(messageText, userMentions, channelMentions, aliasMentions, emojiMentions);

        if (spans.length === 0) {
          spans = [{ type: SpanType.PLAINTEXT, text: '' }];
        }

        await onSendMessage(messageText, spans, files);
        sendTypingStop();
        return true;
      } catch (error) {
        logger.error("Failed to send message:", error);
        showNotification("Failed to send message. Please try again.", "error");
        return false;
      } finally {
        setSending(false);
      }
    },
    [sending, userMentions, channelMentions, aliasMentions, emojiMentions, onSendMessage, sendTypingStop, showNotification],
  );

  // --- Send handler (composer) ---
  const handleSend = async () => {
    const sent = await sendMessageContent(text, selectedFiles);
    if (!sent) return;

    clearDraft();
    clearFiles();
    if (isChannel) {
      mentionHook.close();
    } else {
      closeDmMentions();
    }

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    });
  };

  // --- Emoji picker handlers ---
  const handleEmojiButtonClick = (event: React.MouseEvent<HTMLElement>) => {
    // Capture the caret position before the picker takes focus so we can
    // insert the emoji where the user left off.
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
        (emojiButtonRef.current ?? plusButtonRef.current)?.focus();
      });
    }
  };

  // --- Touch "+" sheet (Attach / GIF / Emoji) ---
  const handleOpenActionsSheet = () => {
    captureSelection();
    setActionsSheetOpen(true);
  };
  const handleCloseActionsSheet = () => setActionsSheetOpen(false);
  const handleSheetAttach = () => {
    setActionsSheetOpen(false);
    // Still inside the tap's user activation, so the file dialog may open.
    handleFileButtonClick();
  };
  const handleSheetEmoji = () => {
    setActionsSheetOpen(false);
    // Touch pickers render as their own sheet; the anchor only marks "open".
    setEmojiAnchorEl(plusButtonRef.current);
  };
  const handleSheetGif = () => {
    setActionsSheetOpen(false);
    setGifAnchorEl(plusButtonRef.current);
  };

  // --- GIF picker handlers ---
  const handleGifButtonClick = (event: React.MouseEvent<HTMLElement>) => {
    setGifAnchorEl(event.currentTarget);
  };

  const handleGifPickerClose = () => {
    setGifAnchorEl(null);
  };

  // Selecting a GIF sends it immediately as its own message (Discord
  // behavior) — the composer's text/files are left untouched.
  const handleGifSelect = useCallback(
    (gif: GifResultDto) => {
      setGifAnchorEl(null);
      void sendMessageContent(gif.url, []);
    },
    [sendMessageContent],
  );

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
      setText(value.slice(0, start) + emoji + value.slice(end));

      // On desktop, restore focus + caret to the input after inserting.
      // On touch, don't force focus — it would pop the keyboard over the sheet.
      if (!isTouchDevice) {
        requestAnimationFrame(() => {
          const input = inputRef.current;
          if (input) {
            input.focus();
            input.setSelectionRange(newPos, newPos);
          }
        });
      }
      emitTypingKeyPress();
    },
    [isTouchDevice, emitTypingKeyPress, setText]
  );

  // --- Rich-text formatting shortcut (Ctrl/Cmd+B, Ctrl/Cmd+I) ---
  const applyFormattingShortcut = (event: React.KeyboardEvent): boolean => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
      return false;
    }
    const marker = markerForShortcut(event.key);
    if (!marker) return false;
    event.preventDefault();
    const el = inputRef.current;
    if (!el) return true;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const result = wrapSelection(el.value, start, end, marker);
    setText(result.newText);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(result.selectionStart, result.selectionEnd);
      }
    });
    return true;
  };

  // --- Keyboard handler ---
  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (applyFormattingShortcut(event)) {
      return;
    }
    if (isChannel) {
      if (mentionHook.state.isOpen && mentionHook.handleKeyDown(event.nativeEvent)) {
        if (event.key === "Enter" || event.key === "Tab") {
          const selectedSuggestion = mentionHook.getSelectedSuggestion();
          if (selectedSuggestion) {
            handleMentionSelect(mentionHook.state.selectedIndex);
          }
        }
        return;
      }
    } else {
      if (dmMentionState.isOpen && handleDmMentionKeyDown(event.nativeEvent)) {
        if (event.key === "Enter" || event.key === "Tab") {
          const selected = dmMentionState.suggestions[dmMentionState.selectedIndex];
          if (selected) {
            handleMentionSelect(dmMentionState.selectedIndex);
          }
        }
        return;
      }
    }

    // On touch devices, Enter inserts a newline (send is via the button only).
    // On desktop, Enter sends and Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey && !isTouchDevice) {
      event.preventDefault();
      handleSend();
    }
  };

  const hasContent = Boolean(text && text.trim()) || selectedFiles.length > 0;
  // Desktop keeps a (disabled) send button at all times; touch shows it only
  // when there's something to send, so the text field gets the width.
  const showSendButton = !compactComposer || hasContent || sending;

  if (!canCompose) {
    return (
      <Box sx={{ position: "relative", width: "100%" }}>
        <ComposerUnavailableNotice availability={availability} />
      </Box>
    );
  }

  return (
    <Box sx={{ position: "relative", width: "100%" }} {...dropZoneProps}>
      <DropZoneOverlay visible={isDragOver} />
      {mentionIsOpen && (
        <MentionDropdown
          suggestions={mentionSuggestions}
          selectedIndex={mentionSelectedIndex}
          isLoading={mentionIsLoading}
          onSelectSuggestion={handleMentionSelect}
        />
      )}

      <FilePreview
        files={selectedFiles}
        previews={filePreviews}
        onRemoveFile={handleRemoveFile}
        compact={keyboardOpen}
      />

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept={ACCEPTED_FILE_TYPES}
        onChange={handleFileSelect}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        style={{ width: "100%" }}
      >
        <StyledPaper
          elevation={2}
          data-composer-layout={compactComposer ? "compact" : "full"}
          sx={compactComposer ? { p: 1, gap: 0.5, alignItems: "flex-end" } : undefined}
        >
          {compactComposer && (
            <IconButton
              ref={plusButtonRef}
              onClick={handleOpenActionsSheet}
              disabled={sending}
              aria-label="Add attachment, GIF or emoji"
              aria-haspopup="dialog"
              aria-expanded={actionsSheetOpen}
              sx={{ width: TOUCH_TARGETS.MINIMUM, height: TOUCH_TARGETS.MINIMUM, flexShrink: 0 }}
            >
              <AddIcon />
            </IconButton>
          )}
          <StyledTextField
            fullWidth
            size="small"
            variant="outlined"
            placeholder={placeholder}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              emitTypingKeyPress();
              captureSelection();
            }}
            onKeyDown={handleKeyPress}
            onKeyUp={captureSelection}
            onPaste={handlePaste}
            onClick={() => {
              updateCursorPosition();
              captureSelection();
            }}
            onSelect={() => {
              updateCursorPosition();
              captureSelection();
            }}
            sx={{ flex: 1, minWidth: 0 }}
            inputRef={inputRef}
            autoComplete="off"
            multiline
            // With the on-screen keyboard up, the viewport is roughly halved;
            // cap the field lower so reply + files + draft leave room for messages.
            maxRows={keyboardOpen ? 2 : 4}
            slotProps={{
              // Note: no `role="combobox"` and no `aria-expanded` here — this
              // field is `multiline` (renders a <textarea>), and ARIA 1.2's
              // `aria-allowed-role`/`aria-allowed-attr` restrict both to
              // <input> hosts (or contenteditable), not <textarea> — axe
              // flags either as a violation on this element. `aria-autocomplete`
              // on the textarea's native textbox role, plus
              // aria-controls/aria-activedescendant (present only while the
              // dropdown is actually open), still fully conveys the
              // combobox-listbox relationship to assistive tech.
              htmlInput: {
                "aria-autocomplete": "list",
                "aria-controls": mentionIsOpen ? MENTION_LISTBOX_ID : undefined,
                "aria-activedescendant":
                  mentionIsOpen && mentionSuggestions.length > 0
                    ? mentionOptionId(mentionSelectedIndex)
                    : undefined,
              },
            }}
          />
          {!compactComposer && (
            <>
              <IconButton
                ref={emojiButtonRef}
                onClick={handleEmojiButtonClick}
                disabled={sending}
                aria-label="add emoji"
                aria-haspopup="true"
                aria-expanded={emojiPickerOpen}
              >
                <EmojiEmotionsOutlinedIcon />
              </IconButton>
              {gifSearchEnabled && (
                <IconButton
                  onClick={handleGifButtonClick}
                  disabled={sending}
                  aria-label="add gif"
                  aria-haspopup="true"
                  aria-expanded={gifPickerOpen}
                >
                  <GifBoxOutlinedIcon />
                </IconButton>
              )}
              <IconButton
                onClick={handleFileButtonClick}
                disabled={sending}
                aria-label="attach file"
              >
                <AttachFileIcon />
              </IconButton>
            </>
          )}
          {showSendButton && (
            <IconButton
              color="primary"
              type="submit"
              disabled={sending || !hasContent}
              aria-label="send"
              sx={
                compactComposer
                  ? { width: TOUCH_TARGETS.MINIMUM, height: TOUCH_TARGETS.MINIMUM, flexShrink: 0 }
                  : undefined
              }
            >
              {sending ? <CircularProgress size={24} /> : <SendIcon />}
            </IconButton>
          )}
        </StyledPaper>
      </form>

      {compactComposer && (
        <MobileSheet
          open={actionsSheetOpen}
          onClose={handleCloseActionsSheet}
          title="Add to message"
          maxHeight="50vh"
        >
          <List data-testid="composer-actions-sheet" disablePadding sx={{ mx: -2, my: -2 }}>
            <ListItemButton onClick={handleSheetAttach} sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED }}>
              <ListItemIcon>
                <AttachFileIcon />
              </ListItemIcon>
              <ListItemText primary="Attach file" />
            </ListItemButton>
            {gifSearchEnabled && (
              <ListItemButton onClick={handleSheetGif} sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED }}>
                <ListItemIcon>
                  <GifBoxOutlinedIcon />
                </ListItemIcon>
                <ListItemText primary="GIF" />
              </ListItemButton>
            )}
            <ListItemButton onClick={handleSheetEmoji} sx={{ minHeight: TOUCH_TARGETS.RECOMMENDED }}>
              <ListItemIcon>
                <EmojiEmotionsOutlinedIcon />
              </ListItemIcon>
              <ListItemText primary="Emoji" />
            </ListItemButton>
          </List>
        </MobileSheet>
      )}

      <EmojiPickerPopover
        open={emojiPickerOpen}
        anchorEl={emojiAnchorEl}
        onClose={handleEmojiPickerClose}
        onEmojiSelect={handleEmojiSelect}
        communityId={isChannel ? communityId : undefined}
        onCustomEmojiSelect={(emoji) => handleEmojiSelect(`:${emoji.name}:`)}
        title="Add Emoji"
      />

      {gifSearchEnabled && (
        <GifPickerPopover
          open={gifPickerOpen}
          anchorEl={gifAnchorEl}
          onClose={handleGifPickerClose}
          onSelect={handleGifSelect}
          title="GIFs"
        />
      )}
    </Box>
  );
}
