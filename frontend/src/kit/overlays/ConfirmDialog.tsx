import { useEffect, useLayoutEffect, useRef, type JSX } from 'react';
import type { CancelReason, Phase } from '../behaviour/confirmDestructive';
import { Button } from '../controls/Button';
import { Alert } from '../display/Alert';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  /** `idle` is closed. */
  phase: Phase;
  /** The failure shown in the body while `phase` is `failed`. */
  error: string | null;
  /** Names what is lost: "Delete #general?". */
  title: string;
  /** What goes with it. */
  description: string;
  /** The confirm button, which stays the same on retry. */
  confirmLabel: string;
  onConfirm: () => void;
  /** Cancel, Escape or a press on the dimmed page. */
  onCancel: (reason: CancelReason) => void;
  /**
   * Whether the dialog is on the page. `false`: it went away without an
   * answer (the layer it was opened from closed and took it along, or it left
   * the page). `true`: it is on the page again (that layer reopened).
   */
  onPresence: (present: boolean) => void;
}

/**
 * The dialog a destructive confirmation shows. Use `useConfirmDestructive`,
 * which owns the phase; this is its view, so a story or a test can draw each
 * phase without running anything.
 */
export function ConfirmDialog({
  phase,
  error,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  onPresence,
}: ConfirmDialogProps): JSX.Element {
  const working = phase === 'working';
  const presence = useRef(onPresence);
  useLayoutEffect(() => {
    presence.current = onPresence;
  });
  // Rendered inside a layer that closes and reopens (a Sheet, a Popover), the dialog can leave the page and come back.
  useEffect(() => {
    presence.current(true);
    return () => presence.current(false);
  }, []);
  return (
    <Dialog
      open={phase !== 'idle'}
      // A layer closed by its parent has gone already: the hook decides what that means for the run.
      onClose={(reason) => (reason === 'parentClosed' ? onPresence(false) : onCancel(reason))}
      title={title}
      description={description}
      actions={
        <>
          {/* Unavailable while working, but focusable: focus may sit on it (Safari does not focus a clicked button). */}
          <Button variant="ghost" aria-disabled={working} onClick={() => onCancel('button')}>
            Cancel
          </Button>
          <Button variant="danger" loading={working} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {phase === 'failed' && error !== null ? <Alert severity="danger">{error}</Alert> : undefined}
    </Dialog>
  );
}
