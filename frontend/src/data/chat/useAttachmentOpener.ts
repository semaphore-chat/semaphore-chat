/**
 * Opening a message's file from the new shell's chat: an image in a new tab, any other file as a download. Files
 * are fetched with the reader's token (the shared file cache), so the address opened is the file's local copy.
 * There is no lightbox yet (design §1.2): the new tab is it.
 */
import { useCallback, useState } from 'react';
import { useFileCache } from '../../contexts/AvatarCacheContext';
import { downloadBlob } from '../../utils/format';
import { logger } from '../../utils/logger';

export interface AttachmentOpener {
  /** The file ids on their way. */
  busy: ReadonlySet<string>;
  open(file: { id: string; kind: 'image' | 'file'; name: string }): void;
}

export function useAttachmentOpener(onError?: (message: string) => void): AttachmentOpener {
  const cache = useFileCache();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const open = useCallback(
    ({ id, kind, name }: { id: string; kind: 'image' | 'file'; name: string }) => {
      // The tab is opened inside the press (a tab opened after an await is a blocked pop-up), then pointed at the
      // file once it is here.
      const tab = kind === 'image' ? window.open('', '_blank') : null;
      const cached = cache.getBlob(id);
      const finish = (url: string) => {
        if (tab !== null) {
          tab.opener = null;
          tab.location.href = url;
        } else if (kind === 'image') {
          window.open(url, '_blank', 'noopener');
        } else {
          downloadBlob(url, name);
        }
      };
      if (cached !== null) {
        finish(cached);
        return;
      }
      setBusy((prev) => new Set(prev).add(id));
      cache
        .fetchBlob(id)
        .then(finish)
        .catch((error: unknown) => {
          tab?.close();
          logger.warn('[chat] could not open a file', error);
          onError?.(`Couldn't open ${name}`);
        })
        .finally(() =>
          setBusy((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        );
    },
    [cache, onError],
  );

  return { busy, open };
}
