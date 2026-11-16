/**
 * Opening a message's file from the new shell's chat. Files are fetched with the reader's token (the shared file
 * cache). Only a raster picture of a known type opens in a new tab (there is no lightbox yet, design §1.2); every
 * other file, whatever its name says, is downloaded and never shown as a page. The decision is made from the type
 * the server reported for the file, and the tab gets a copy of the bytes labelled with exactly that type.
 *
 * The opener is one stable object for the whole list (it goes into the rows' shared context): which files are on
 * their way is read per file through `useAttachmentBusy`, so one download re-renders only its own tile.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFileCache } from '../../contexts/AvatarCacheContext';
import { downloadBlob } from '../../utils/format';
import { logger } from '../../utils/logger';

/** The picture types a tab may show. Anything else (SVG, HTML, PDF, unknown) is downloaded. */
export const VIEWABLE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

/** What pressing a file does, from the type the server reported: show it in a tab, or download it. */
export function attachmentAction(mimeType: string | null | undefined): 'open' | 'download' {
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  return VIEWABLE_IMAGE_TYPES.includes(type) ? 'open' : 'download';
}

export interface AttachmentFile {
  id: string;
  name: string;
  /** The type the server reported for the file. */
  mimeType: string;
}

/** How long a typed copy shown in a tab is kept at most before its address is revoked (the tab keeps its page). */
export const TYPED_URL_LIFETIME_MS = 60_000;

export interface AttachmentOpener {
  open(file: AttachmentFile): void;
  /** Whether the file's open or download is on its way. */
  isBusy(id: string): boolean;
  subscribe(listener: () => void): () => void;
}

/** Whether `id`'s open or download is on its way; re-renders only when that file's state changes. */
export function useAttachmentBusy(opener: AttachmentOpener, id: string): boolean {
  return useSyncExternalStore(
    opener.subscribe,
    () => opener.isBusy(id),
    () => false,
  );
}

export function useAttachmentOpener(onError?: (message: string) => void): AttachmentOpener {
  const cache = useFileCache();
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [{ opener, dispose }] = useState(() => {
    const busy = new Set<string>();
    // The typed copies shown in tabs, each revoked after a bounded delay (the tab has long loaded it by then; a load
    // event cannot be watched, the navigation replaces the tab's window) or when the screen goes away, so opening
    // many pictures does not keep their bytes alive.
    const typedUrls = new Map<string, ReturnType<typeof setTimeout>>();
    const revoke = (url: string) => {
      const timer = typedUrls.get(url);
      if (timer === undefined) return;
      clearTimeout(timer);
      typedUrls.delete(url);
      URL.revokeObjectURL(url);
    };
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    const setBusy = (id: string, on: boolean) => {
      if (on) busy.add(id);
      else busy.delete(id);
      notify();
    };
    const opener: AttachmentOpener = {
      isBusy: (id) => busy.has(id),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      open: ({ id, name, mimeType }) => {
        const action = attachmentAction(mimeType);
        // A tab opened after an await is a blocked pop-up: open it inside the press, point it at the file later.
        const tab = action === 'open' ? window.open('', '_blank') : null;
        // Cut the tab's way back to the app at once, before any wait: whatever the tab shows never gets an opener.
        if (tab !== null) tab.opener = null;
        const fileCache = cacheRef.current;
        setBusy(id, true);
        void (async () => {
          try {
            const url = fileCache.getBlob(id) ?? (await fileCache.fetchBlob(id));
            if (action === 'download') {
              downloadBlob(url, name);
              return;
            }
            // A copy labelled with exactly the reported (allow-listed) type, whatever the response said.
            const bytes = await (await fetch(url)).blob();
            const typed = URL.createObjectURL(new Blob([bytes], { type: mimeType.split(';')[0].trim().toLowerCase() }));
            typedUrls.set(
              typed,
              setTimeout(() => revoke(typed), TYPED_URL_LIFETIME_MS),
            );
            if (tab !== null) {
              tab.location.href = typed;
            } else {
              downloadBlob(typed, name);
            }
          } catch (error: unknown) {
            tab?.close();
            logger.warn('[chat] could not open a file', error);
            onErrorRef.current?.(`Couldn't open ${name}`);
          } finally {
            setBusy(id, false);
          }
        })();
      },
    };
    const dispose = () => [...typedUrls.keys()].forEach(revoke);
    return { opener, dispose };
  });
  useEffect(() => dispose, [dispose]);

  // The same object on every render.
  return opener;
}
