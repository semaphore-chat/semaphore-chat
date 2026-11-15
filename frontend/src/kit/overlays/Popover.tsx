import { useEffect, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import Fade from '@mui/material/Fade';
import Popper from '@mui/material/Popper';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { LayerContext, useOverlayLayer } from '../behaviour/hosts/overlay';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { useOverlayContainer } from './overlayContainer';
import { ANCHOR_GAP, layerIndex, overlaySurface, reducedMotion, type Placement } from './surface';

export interface PopoverProps {
  open: boolean;
  /** The element the popover opens from; focus returns to it on close. */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Names the panel for assistive technology. */
  label: string;
  children: ReactNode;
  placement?: Placement;
  padding?: 'none' | 'md' | 'lg';
}

const PADDING = { none: 0, md: tokens.space.md, lg: tokens.space.lg } as const;

const Panel = styled('div', {
  shouldForwardProp: transientProps,
})<{ $padding: keyof typeof PADDING }>(({ theme, $padding }) => ({
  ...overlaySurface(kitTheme(theme)),
  ...reducedMotion,
  boxSizing: 'border-box',
  maxWidth: `calc(100vw - ${2 * tokens.layout.gutter}px)`,
  padding: `${PADDING[$padding]}px`,
  color: kitTheme(theme).palette.text,
  // The panel takes focus only when nothing inside can; a ring on a container is noise.
  outline: 'none',
}));

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Renders nothing; on mount it moves focus to the first control in the panel, or the panel. */
function FocusIn({ panel }: { panel: RefObject<HTMLDivElement | null> }): null {
  useEffect(() => {
    const node = panel.current;
    if (node !== null) {
      (node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus({ preventScroll: true });
    }
  }, [panel]);
  return null;
}

/**
 * A small floating panel anchored to an element, a layer of the overlay stack.
 * It is not modal: nothing traps Tab and the page keeps its scroll. Focus moves
 * to the first control inside (or the panel); Escape, or a press outside the
 * panel and its anchor, calls `onClose` (the stack decides both); on close,
 * focus returns to the anchor. Placement flips to the other side and shifts to
 * stay in the viewport.
 *
 * Other layers can open from inside it (a Menu, a SelectField list, a Dialog):
 * they are owned by it in the stack, so a press or an Escape in them belongs to
 * them, not to the Popover. Opened from inside a Dialog it renders within the
 * Dialog, so the focus trap lets focus in.
 *
 * Outside a Dialog the panel renders in a portal at the end of the page, so Tab
 * from its last control continues after the page.
 */
export function Popover({
  open,
  anchor,
  onClose,
  label,
  children,
  placement = 'bottom-start',
  padding = 'md',
}: PopoverProps): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const container = useOverlayContainer();
  const { id, forcedClosed } = useOverlayLayer({
    kind: 'popover',
    open: open && anchor !== null,
    panel,
    // A press on the anchor is left to the anchor (it may toggle the popover).
    inside: [anchor],
    opener: anchor,
    onRequestClose: () => onClose(),
  });

  return (
    <Popper
      open={open && anchor !== null && !forcedClosed}
      anchorEl={anchor}
      container={container}
      placement={placement}
      transition
      role={undefined}
      modifiers={[
        { name: 'offset', options: { offset: [0, ANCHOR_GAP] } },
        { name: 'preventOverflow', options: { padding: tokens.layout.gutter } },
      ]}
      sx={(theme) => ({ zIndex: layerIndex(theme, 'panel') })}
    >
      {({ TransitionProps }) => (
        <Fade {...TransitionProps} timeout={tokens.motion.fast}>
          <Panel ref={panel} role="dialog" aria-label={label} tabIndex={-1} $padding={padding}>
            <FocusIn panel={panel} />
            {/* A portal: reset to the panel's own layer, whatever it was opened from. */}
            <SurfaceContext value="surface">
              <LayerContext value={id}>{children}</LayerContext>
            </SurfaceContext>
          </Panel>
        </Fade>
      )}
    </Popper>
  );
}
