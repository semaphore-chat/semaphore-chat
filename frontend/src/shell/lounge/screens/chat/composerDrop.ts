/**
 * Files dropped on a conversation go to its composer's tray (the old chat's drop zone, `data/chat/useDropZone`). The
 * pane owns the drag events (the kit ChatPane's `dropZone`); the composer, which owns the queued files, says where
 * dropped files go through `into` and draws the drop look while `active`. With no composer (the reader cannot
 * write) a drop does nothing.
 */
import { useCallback, useRef, type RefObject } from 'react';
import type { ChatPaneDropZone } from '../../../../kit';
import { useDropZone } from '../../../../data/chat/useDropZone';

export type DropInto = RefObject<((files: File[]) => void) | null>;

export interface ComposerDrop {
  dropZone: ChatPaneDropZone;
  /** Files are dragged over the conversation. */
  active: boolean;
  /** Set by the composer: where dropped files go. */
  into: DropInto;
}

export function useComposerDrop(): ComposerDrop {
  const into = useRef<((files: File[]) => void) | null>(null);
  const onDrop = useCallback((files: File[]) => into.current?.(files), []);
  const { isDragOver, dropZoneProps } = useDropZone({ onDrop });
  return { dropZone: dropZoneProps, active: isDragOver, into };
}
