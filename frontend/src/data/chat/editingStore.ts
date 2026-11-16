/**
 * Which message of a conversation is being edited in place: one small store per list, read per row through
 * `useIsEditing`, so starting or ending an edit re-renders only that row (never the whole list, whose rows share
 * one context value that must not change). One message at a time, as the old chat.
 */
import { useSyncExternalStore } from 'react';

export interface EditingStore {
  /** The message being edited, or null. */
  current(): string | null;
  start(messageId: string): void;
  /** Ends the edit of `messageId` (a later edit of another message is left alone). */
  stop(messageId: string): void;
  subscribe(listener: () => void): () => void;
}

export function createEditingStore(): EditingStore {
  let editing: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === editing) return;
    editing = next;
    listeners.forEach((listener) => listener());
  };
  return {
    current: () => editing,
    start: (messageId) => set(messageId),
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
