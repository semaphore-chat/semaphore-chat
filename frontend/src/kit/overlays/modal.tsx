import { useState, type JSX, type ReactNode } from 'react';
import MuiDialog from '@mui/material/Dialog';
import type { CSSObject, Theme } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { OverlayContainerContext } from './overlayContainer';
import { fadeTransition, reducedMotion } from './surface';

/**
 * What a Dialog and a Sheet share. MUI's Dialog supplies the behaviour: the
 * page behind is inert and does not scroll, Tab cycles inside, Escape and a
 * press on the scrim call `onClose`, and focus returns to the opener. This adds
 * the kit's scrim and fade, the heading style, and the element that layers
 * opened from inside (a Popover, Tooltip, Menu or SelectField list) render in,
 * so the focus trap lets focus into them.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
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
  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      maxWidth={false}
      transitionDuration={tokens.motion.base}
      {...fadeTransition}
      sx={{ '& .MuiDialog-container': { boxSizing: 'border-box', ...container, ...reducedMotion } }}
      slotProps={{
        container: { ref: setLayer },
        backdrop: {
          sx: (theme) => ({ background: kitTheme(theme).palette.scrim, ...reducedMotion }),
        },
        paper: { sx: panel },
      }}
    >
      <OverlayContainerContext value={layer}>{children}</OverlayContainerContext>
    </MuiDialog>
  );
}
