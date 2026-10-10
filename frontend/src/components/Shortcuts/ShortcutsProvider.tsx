import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import {
  ShortcutsContext,
  type ConversationTarget,
  type ShortcutsContextValue,
  type SidebarNav,
} from "../../contexts/ShortcutsContext";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { ShortcutSheet } from "./ShortcutSheet";


/**
 * Global keyboard shortcuts for the desktop layout: holds what the sidebar
 * list and the open conversation register, the shortcut sheet, and a polite
 * live region that announces where a shortcut took you.
 */
export const ShortcutsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const sidebarRef = useRef<SidebarNav | null>(null);
  const conversationRef = useRef<ConversationTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheetOpen;
  const [announcement, setAnnouncement] = useState("");

  const registerSidebar = useCallback((nav: SidebarNav) => {
    sidebarRef.current = nav;
    return () => {
      if (sidebarRef.current === nav) sidebarRef.current = null;
    };
  }, []);
  const registerConversation = useCallback((conversation: ConversationTarget) => {
    conversationRef.current = conversation;
    return () => {
      if (conversationRef.current === conversation) conversationRef.current = null;
    };
  }, []);
  const openShortcutSheet = useCallback(() => setSheetOpen(true), []);

  // Re-setting the same text doesn't re-announce, so clear it first.
  const announce = useCallback((message: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  useGlobalShortcuts({
    getSidebar: () => sidebarRef.current,
    getConversation: () => conversationRef.current,
    isSheetOpen: () => sheetOpenRef.current,
    toggleSheet: () => setSheetOpen((open) => !open),
    announce,
  });

  const value = useMemo<ShortcutsContextValue>(
    () => ({ registerSidebar, registerConversation, openShortcutSheet }),
    [registerSidebar, registerConversation, openShortcutSheet],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      <Box role="status" aria-live="polite" aria-atomic="true" data-testid="shortcut-announcer" sx={visuallyHidden}>
        {announcement}
      </Box>
    </ShortcutsContext.Provider>
  );
};

export default ShortcutsProvider;
