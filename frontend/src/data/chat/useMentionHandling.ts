/**
 * useMentionHandling Hook
 *
 * Shared mention handling logic for MessageInput components.
 * Manages cursor position tracking and mention insertion.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { insertMention } from "../../utils/mentionParser";

export interface MentionSuggestion {
  id: string;
  type: 'user' | 'special';
  displayName: string;
  subtitle?: string;
  username?: string;
}

export interface UseMentionHandlingReturn {
  cursorPosition: number;
  updateCursorPosition: () => void;
  handleInsertMention: (mention: MentionSuggestion, text: string, setText: (text: string) => void, closeMentions: () => void) => void;
  setupCursorTracking: (inputRef: React.RefObject<HTMLInputElement | null>) => void;
}

/**
 * Custom hook for managing mention handling in message inputs
 */
export function useMentionHandling(): UseMentionHandlingReturn {
  const [cursorPosition, setCursorPosition] = useState(0);
  const inputRefForTracking = useRef<HTMLInputElement | null>(null);

  const updateCursorPosition = useCallback(() => {
    if (inputRefForTracking.current) {
      setCursorPosition(inputRefForTracking.current.selectionStart || 0);
    }
  }, []);

  const setupCursorTracking = useCallback((inputRef: React.RefObject<HTMLInputElement | null>) => {
    inputRefForTracking.current = inputRef.current;
  }, []);

  useEffect(() => {
    const input = inputRefForTracking.current;
    if (!input) return;

    input.addEventListener("selectionchange", updateCursorPosition);
    input.addEventListener("click", updateCursorPosition);
    input.addEventListener("keyup", updateCursorPosition);

    return () => {
      input.removeEventListener("selectionchange", updateCursorPosition);
      input.removeEventListener("click", updateCursorPosition);
      input.removeEventListener("keyup", updateCursorPosition);
    };
  }, [updateCursorPosition]);

  const handleInsertMention = useCallback(
    (
      mention: MentionSuggestion,
      text: string,
      setText: (text: string) => void,
      closeMentions: () => void
    ) => {
      if (!inputRefForTracking.current) return;

      const mentionData = {
        type: mention.type,
        username: mention.type === "user" ? mention.displayName : undefined,
        specialKind: mention.type === "special" ? mention.displayName : undefined,
      };

      const result = insertMention(text, cursorPosition, mentionData);
      setText(result.newText);

      // Focus and set cursor position after state updates
      requestAnimationFrame(() => {
        if (inputRefForTracking.current) {
          inputRefForTracking.current.focus();
          inputRefForTracking.current.setSelectionRange(result.newCursorPosition, result.newCursorPosition);
          setCursorPosition(result.newCursorPosition);
        }
      });

      closeMentions();
    },
    [cursorPosition]
  );

  return {
    cursorPosition,
    updateCursorPosition,
    handleInsertMention,
    setupCursorTracking,
  };
}
