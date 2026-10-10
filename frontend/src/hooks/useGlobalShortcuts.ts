import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationTarget, SidebarNav } from "../contexts/ShortcutsContext";
import { useVoice } from "../contexts/VoiceContext";
import { useVoiceSettings } from "./useVoiceSettings";
import {
  findNavTarget,
  focusComposer,
  isComposerTarget,
  isEditableTarget,
  isModalOpen,
  matchGlobalShortcut,
} from "../utils/shortcuts";
import { markConversationRead } from "../utils/markConversationRead";
import { isMacPlatform } from "../utils/platform";
import { logger } from "../utils/logger";

export interface UseGlobalShortcutsOptions {
  getSidebar: () => SidebarNav | null;
  getConversation: () => ConversationTarget | null;
  isSheetOpen: () => boolean;
  toggleSheet: () => void;
  announce: (message: string) => void;
}

/**
 * The desktop layout's global keyboard shortcuts (see `utils/shortcuts.ts`):
 * Alt+↑/↓ and Alt+Shift+↑/↓ walk the sidebar list, Esc closes the docked
 * panel or marks the conversation read, Mod+/ toggles the shortcut sheet.
 *
 * One `window` keydown listener in the bubble phase, so every more specific
 * handler (dialogs, menus, mention lists, the edit form, the docked panel)
 * runs first; anything they handled (`defaultPrevented`) is left alone. The
 * navigation keys and Esc don't fire in text fields other than the main
 * composer, while a modal is open, or on the push-to-talk key.
 */
export function useGlobalShortcuts(options: UseGlobalShortcutsOptions): void {
  const queryClient = useQueryClient();
  const { isConnected: voiceConnected } = useVoice();
  const { isPushToTalk, pushToTalkKey } = useVoiceSettings();

  const optionsRef = useRef(options);
  const pttKeyRef = useRef<string | null>(null);
  useEffect(() => {
    optionsRef.current = options;
    pttKeyRef.current = voiceConnected && isPushToTalk ? pushToTalkKey : null;
  });

  useEffect(() => {
    const mac = isMacPlatform();

    const navigate = (direction: 1 | -1, unreadOnly: boolean, fromComposer: boolean) => {
      const nav = optionsRef.current.getSidebar();
      if (!nav) return false;
      const target = findNavTarget(nav.items, nav.currentId, direction, unreadOnly);
      if (!target) {
        if (unreadOnly) {
          optionsRef.current.announce(nav.kind === "dm" ? "No unread conversations" : "No unread channels");
        }
        return true;
      }
      nav.select(target.id);
      optionsRef.current.announce(target.unread ? `${target.label}, unread` : target.label);
      if (fromComposer) {
        // Keep typing where you were: if the switch dropped focus, put it
        // back in the (new) conversation's composer.
        requestAnimationFrame(() => {
          if (document.activeElement && document.activeElement !== document.body) return;
          focusComposer();
        });
      }
      return true;
    };

    const handleEscape = () => {
      const conversation = optionsRef.current.getConversation();
      if (!conversation) return false;
      // One thing per press: an open docked panel closes first.
      if (conversation.closeDockedPanel?.()) return true;
      markConversationRead(queryClient, conversation.kind, conversation.id)
        .then((marked) => {
          if (marked) optionsRef.current.announce("Marked as read");
        })
        .catch((error: unknown) => logger.error("[Shortcuts] Failed to mark as read:", error));
      return true;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const id = matchGlobalShortcut(event, mac);
      if (!id) return;

      if (id === "shortcutSheet") {
        // Toggles even from a text field; another dialog on top keeps it.
        if (!optionsRef.current.isSheetOpen() && isModalOpen()) return;
        event.preventDefault();
        optionsRef.current.toggleSheet();
        return;
      }

      // Push-to-talk owns its key, whatever modifiers are held.
      if (pttKeyRef.current && event.code === pttKeyRef.current) return;
      if (isModalOpen()) return;
      const fromComposer = isComposerTarget(event.target);
      if (isEditableTarget(event.target) && !fromComposer) return;

      let handled = false;
      switch (id) {
        case "prevChannel":
          handled = navigate(-1, false, fromComposer);
          break;
        case "nextChannel":
          handled = navigate(1, false, fromComposer);
          break;
        case "prevUnread":
          handled = navigate(-1, true, fromComposer);
          break;
        case "nextUnread":
          handled = navigate(1, true, fromComposer);
          break;
        case "escape":
          handled = handleEscape();
          break;
        default:
          break;
      }
      if (handled) event.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [queryClient]);
}
