import { createContext, useContext, useEffect } from "react";
import type { NavItem } from "../utils/shortcuts";
import type { ConversationKind } from "../utils/markConversationRead";

/** The sidebar list Alt+↑/↓ walks: what's shown, in the order it's shown. */
export interface SidebarNav {
  /** "channel" or "dm": picks the "No unread …" wording. */
  kind: ConversationKind;
  items: NavItem[];
  currentId: string | undefined;
  select: (id: string) => void;
}

/** The open conversation Esc acts on. */
export interface ConversationTarget {
  kind: ConversationKind;
  id: string;
  /** Close an open docked side panel (thread, pins, search); false when none is open. */
  closeDockedPanel?: () => boolean;
}

export interface ShortcutsContextValue {
  registerSidebar: (nav: SidebarNav) => () => void;
  registerConversation: (conversation: ConversationTarget) => () => void;
  openShortcutSheet: () => void;
}

const noop = () => {};

/** Outside the desktop layout (phone, tablet, tests) registration is a no-op. */
export const ShortcutsContext = createContext<ShortcutsContextValue>({
  registerSidebar: () => noop,
  registerConversation: () => noop,
  openShortcutSheet: noop,
});

export function useShortcuts(): ShortcutsContextValue {
  return useContext(ShortcutsContext);
}

/** Register the sidebar list for Alt+↑/↓ while mounted. Pass a memoized value (or null). */
export function useRegisterSidebarNav(nav: SidebarNav | null): void {
  const { registerSidebar } = useShortcuts();
  useEffect(() => (nav ? registerSidebar(nav) : undefined), [registerSidebar, nav]);
}

/** Register the open conversation for Esc while mounted. Pass a memoized value (or null). */
export function useRegisterConversation(conversation: ConversationTarget | null): void {
  const { registerConversation } = useShortcuts();
  useEffect(
    () => (conversation ? registerConversation(conversation) : undefined),
    [registerConversation, conversation],
  );
}
