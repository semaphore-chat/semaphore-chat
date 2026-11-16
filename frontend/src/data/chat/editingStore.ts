/**
 * Which message of a conversation is being edited in place: one small store per list, read per row through
 * `useIsEditing`, so starting or ending an edit re-renders only that row (never the whole list, whose rows share
 * one context value that must not change). One message at a time, as the old chat.
 *
 * The edit's text lives here too, so a row that leaves the list's render window and comes back shows what the
 * reader had typed, and the editor takes focus only when the edit starts, never when its row mounts again.
 */
import { useSyncExternalStore } from 'react';

export interface EditingStore {
  /** The message being edited, or null. */
  current(): string | null;
  start(messageId: string): void;
  /** Ends the edit of `messageId` (a later edit of another message is left alone). */
  stop(messageId: string): void;
  /** The text typed into the edit of `messageId` so far, or null before the first change. */
  draft(messageId: string): string | null;
  setDraft(messageId: string, text: string): void;
  /** True once per edit, for the first editor that asks: it takes focus; a later remount of the row does not. */
  claimFocus(messageId: string): boolean;
  subscribe(listener: () => void): () => void;
}

export function createEditingStore(): EditingStore {
  let editing: string | null = null;
  let text: string | null = null;
  let focusClaimed = false;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === editing) return;
    editing = next;
    text = null;
    focusClaimed = false;
    listeners.forEach((listener) => listener());
  };
  return {
    current: () => editing,
    start: (messageId) => set(messageId),
    draft: (messageId) => (editing === messageId ? text : null),
    setDraft: (messageId, next) => {
      if (editing === messageId) text = next;
    },
    claimFocus: (messageId) => {
      if (editing !== messageId || focusClaimed) return false;
      focusClaimed = true;
      return true;
    },
    stop: (messageId) => {
      if (editing === messageId) set(null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Whether `messageId` is the one being edited; re-renders only when that changes. */
export function useIsEditing(store: EditingStore, messageId: string): boolean {
  return useSyncExternalStore(
    store.subscribe,
    () => store.current() === messageId,
    () => false,
  );
}
