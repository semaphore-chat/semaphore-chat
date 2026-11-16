/**
 * useComposerKeys
 *
 * The composer's key handling, lifted unchanged from MessageInput: rich-text
 * shortcuts (Ctrl/Cmd+B, Ctrl/Cmd+I), the mention list's keys (server-backed
 * list in channels, local list in DMs), Esc cancelling a quote reply, ↑ in
 * the empty composer handing off to "edit my last message", and Enter
 * (send on desktop; Shift+Enter, and any Enter on touch, inserts a newline).
 *
 * Order matters and is the classic one: formatting shortcut, then the open
 * mention list, then Esc, then ↑, then Enter.
 */

import type React from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { wrapSelection, markerForShortcut } from "../../utils/richTextShortcuts";
import type { useMentionAutocomplete } from "../../hooks/useMentionAutocomplete";
import type { MentionSuggestion } from "./useMentionHandling";

// --- Local mention state for DM context ---
export interface SimpleMentionState {
  isOpen: boolean;
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  query: string;
  type: 'user' | 'special' | null;
  isLoading: boolean;
}

export interface UseComposerKeysOptions {
  inputRef: RefObject<HTMLInputElement | null>;
  text: string;
  setText: (text: string) => void;
  selectedFiles: File[];
  isTouchDevice: boolean;
  isChannel: boolean;
  /** The server-backed mention list (channels). */
  mentionHook: Pick<ReturnType<typeof useMentionAutocomplete>, "state" | "handleKeyDown" | "getSelectedSuggestion">;
  /** The local mention list (DMs). */
  dmMentionState: SimpleMentionState;
  setDmMentionState: Dispatch<SetStateAction<SimpleMentionState>>;
  handleDmInsertMention: (mention: MentionSuggestion) => void;
  closeDmMentions: () => void;
  handleMentionSelect: (index: number) => void;
  handleSend: () => Promise<void>;
  /**
   * ↑ in the empty composer (desktop): open your last message's edit form.
   * Returns false when there's no message to edit.
   */
  onEditLastMessage?: () => boolean;
  /** Set while a quote reply is active: Esc in the composer cancels it. */
  onCancelReply?: () => void;
}

export function useComposerKeys({
  inputRef,
  text,
  setText,
  selectedFiles,
  isTouchDevice,
  isChannel,
  mentionHook,
  dmMentionState,
  setDmMentionState,
  handleDmInsertMention,
  closeDmMentions,
  handleMentionSelect,
  handleSend,
  onEditLastMessage,
  onCancelReply,
}: UseComposerKeysOptions) {
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

    // Esc cancels an active quote reply (handled, so the global Esc
    // shortcut doesn't also mark the conversation read).
    if (event.key === "Escape" && onCancelReply) {
      event.preventDefault();
      onCancelReply();
      return;
    }

    // ↑ in an empty composer edits your last message (desktop keyboards).
    if (
      event.key === "ArrowUp" &&
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      !isTouchDevice &&
      onEditLastMessage &&
      !text &&
      selectedFiles.length === 0
    ) {
      if (onEditLastMessage()) event.preventDefault();
      return;
    }

    // On touch devices, Enter inserts a newline (send is via the button only).
    // On desktop, Enter sends and Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey && !isTouchDevice) {
      event.preventDefault();
      handleSend();
    }
  };

  return { handleKeyPress };
}
