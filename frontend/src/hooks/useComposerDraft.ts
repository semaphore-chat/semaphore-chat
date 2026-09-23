/**
 * useComposerDraft
 *
 * Composer text that survives the composer unmounting. On mobile, leaving a
 * chat (switching tabs, opening a profile) unmounts MessageInput; without this
 * the half-written message would be lost.
 *
 * Drafts are kept per conversation (channel or DM) in sessionStorage, so they
 * last for the tab's session but never outlive it or leak to other devices.
 * Every storage access is wrapped in try/catch: in private windows or with
 * blocked site data the hook degrades to plain component state.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'semaphore:composerDraft:';

/** The sessionStorage key a draft for `draftKey` is stored under. */
export function composerDraftStorageKey(draftKey: string): string {
  return `${STORAGE_PREFIX}${draftKey}`;
}

/** Removes every saved composer draft (e.g. between sandbox stories). */
export function clearComposerDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was saved.
  }
}

function readDraft(draftKey: string): string {
  try {
    return sessionStorage.getItem(composerDraftStorageKey(draftKey)) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(draftKey: string, text: string): void {
  try {
    const storageKey = composerDraftStorageKey(draftKey);
    if (text) {
      sessionStorage.setItem(storageKey, text);
    } else {
      sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Storage unavailable (private mode, quota, blocked): keep in-memory only.
  }
}

type DraftState = { key: string; text: string };

/**
 * Returns `[text, setText, clearDraft]` for the conversation named by
 * `draftKey` (e.g. `channel:<id>` or `dm:<id>`). Changing the key swaps in
 * that conversation's saved draft; the previous one stays saved.
 */
export function useComposerDraft(
  draftKey: string,
): [string, (text: string) => void, () => void] {
  const [state, setState] = useState<DraftState>(() => ({
    key: draftKey,
    text: readDraft(draftKey),
  }));

  // Same composer, different conversation: load that conversation's draft.
  // Adjusting state during render avoids a frame showing the old text.
  let current = state;
  if (state.key !== draftKey) {
    current = { key: draftKey, text: readDraft(draftKey) };
    setState(current);
  }

  const setText = useCallback(
    (text: string) => {
      setState({ key: draftKey, text });
    },
    [draftKey],
  );

  const clearDraft = useCallback(() => {
    writeDraft(draftKey, '');
    setState({ key: draftKey, text: '' });
  }, [draftKey]);

  // Persist after commit so StrictMode double renders stay side-effect free.
  useEffect(() => {
    writeDraft(state.key, state.text);
  }, [state]);

  return [current.text, setText, clearDraft];
}
