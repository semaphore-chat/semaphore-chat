import { useCallback, useRef, useState, type JSX, type ReactNode } from 'react';
import MuiDialog from '@mui/material/Dialog';
import type { CSSObject, Theme } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { LiveRegionSlot } from '../behaviour/hosts/LiveRegionSlot';
import { LayerContext, useOverlayLayer } from '../behaviour/hosts/overlay';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';
import { OverlayContainerContext } from './overlayContainer';
import { fadeTransition, reducedMotion } from './surface';

/**
 * Why a Dialog closes: Escape or a press on the dimmed page (requests the
 * parent may refuse), or `'parentClosed'`: the layer it was opened from closed,
 * so it has closed too (a command: it renders closed whatever `open` says until
 * `open` goes false).
 */
export type DialogCloseReason = 'escape' | 'scrim' | 'parentClosed';

/** Why a Sheet closes: a Dialog's reasons, or its own Close button. */
export type SheetCloseReason = DialogCloseReason | 'button';

/**
 * What a Dialog and a Sheet share. The overlay stack decides (see
 * `behaviour/hosts/overlay.ts`): Escape, a press on the scrim and focus return
 * are its rules, so MUI's own Escape handling, focus restore and close reasons
 * are turned off. MUI still draws it, keeps the page behind from scrolling and
 * hidden from assistive technology, and cycles Tab inside. This adds the kit's
 * scrim and fade, the heading style, and the element that layers opened from
 * inside (a Popover, Tooltip, Menu or SelectField list) render in, so the
 * focus trap lets focus into them. It also holds a live-region slot, so an
 * announcement made while it is open is read from inside it.
 */
export interface ModalProps {
  kind: 'dialog' | 'sheet';
  open: boolean;
  /** A Sheet's Close button calls its own `onClose('button')`; this never sends `'button'`. */
  onClose: (reason: DialogCloseReason) => void;
  /** The id of the element that names the modal. */
  labelledBy: string;
  /** The id of the element that describes it. */
  describedBy?: string;
  /** Styles the full-viewport box the panel sits in: the margin and where the panel is anchored. */
  container: CSSObject;
  /** Styles the panel itself; read the kit theme from the MUI theme it is given. */
  panel: (theme: Theme) => CSSObject;
  children: ReactNode;
}

export function Modal({
  kind,
  open,
  onClose,
  labelledBy,
  describedBy,
  container,
  panel,
  children,
}: ModalProps): JSX.Element {
  // The element MUI's focus trap guards: layers opened from inside render in it.
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const containerRef = useCallback((node: HTMLElement | null) => {
    root.current = node;
    setLayer(node);
  }, []);
  const paper = useRef<HTMLDivElement>(null);
  const { id, forcedClosed } = useOverlayLayer({
    kind,
    open,
    panel: paper,
    // A press on the scrim focuses the container: focus there is still in the modal.
    root,
    onRequestClose: (reason) => {
      // 'pressOutside' and 'tab' never come for a dialog or sheet.
      if (reason === 'escape' || reason === 'scrim' || reason === 'parentClosed') onClose(reason);
    },
  });
  return (
    <MuiDialog
      open={open && !forcedClosed}
      // No onClose: MUI's reasons (escapeKeyDown, backdropClick) are not ours to act on.
      disableEscapeKeyDown
      disableRestoreFocus
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      maxWidth={false}
      transitionDuration={tokens.motion.base}
      {...fadeTransition}
      sx={{ '& .MuiDialog-container': { boxSizing: 'border-box', ...container, ...reducedMotion } }}
      slotProps={{
        // A stable hook for tests that ask whether focus is inside a kit modal (not MUI's class name).
        container: { ref: containerRef, 'data-kit-modal': kind } as { ref: typeof containerRef },
        backdrop: {
          sx: (theme) => ({ background: kitTheme(theme).palette.scrim, ...reducedMotion }),
        },
        paper: { sx: panel, ref: paper },
      }}
    >
      {/* The panel is a portal: context from where it was opened crosses it, so reset to the panel's own layer. */}
      <SurfaceContext value="surface">
        <OverlayContainerContext value={layer}>
          <LayerContext value={id}>{children}</LayerContext>
        </OverlayContainerContext>
        <LiveRegionSlot scope="layer" active={open && !forcedClosed} />
      </SurfaceContext>
    </MuiDialog>
  );
}
