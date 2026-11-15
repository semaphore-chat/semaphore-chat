import { useEffect, useRef, type JSX, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Fade from '@mui/material/Fade';
import Popper from '@mui/material/Popper';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
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
 * A small floating panel anchored to an element. It is not modal: nothing traps
 * Tab and the page keeps its scroll. Focus moves to the first control inside (or
 * the panel); Escape, or a press outside the panel and its anchor, calls
 * `onClose`; on close, focus returns to the anchor. Placement flips to the other
 * side and shifts to stay in the viewport.
 *
 * Other layers can open from inside it (a Menu, a SelectField list, a Dialog):
 * a press or an Escape in them belongs to them, not to the Popover, because
 * both are tracked through the React tree, not the DOM. Opened from inside a
 * Dialog it renders within the Dialog, so the focus trap lets focus in.
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
  // The latest onClose, so the listeners below are not re-added on every render.
  const close = useRef(onClose);
  close.current = onClose;

  // Focus back to the anchor on close.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const active = document.activeElement;
      // Only take focus back if it is in the panel or lost: a press on another control keeps its focus.
      // The panel is read at cleanup on purpose: it mounts after this effect runs.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (active === document.body || active === null || panel.current?.contains(active) === true) {
        (anchor ?? opener)?.focus({ preventScroll: true });
      }
    };
  }, [open, anchor]);

  // Escape with focus on the anchor (after a press on it, say). It is a native listener on the
  // anchor so it runs before any layer around the anchor, such as a Dialog, sees the key.
  useEffect(() => {
    if (!open || anchor === null) {
      return undefined;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        close.current();
        event.stopPropagation();
      }
    };
    anchor.addEventListener('keydown', onKeyDown);
    return () => anchor.removeEventListener('keydown', onKeyDown);
  }, [open, anchor]);

  // A React handler on the panel: React events bubble through portals, so a layer opened
  // from inside has already used the key (MUI's modals stop the Escape they consume).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      close.current();
      event.stopPropagation();
    }
  };

  return (
    <Popper
      open={open && anchor !== null}
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
        <ClickAwayListener
          mouseEvent="onPointerDown"
          touchEvent={false}
          onClickAway={(event) => {
            // The anchor handles its own presses (it may toggle the popover).
            if (anchor?.contains(event.target as Node) !== true) {
              close.current();
            }
          }}
        >
          <Fade {...TransitionProps} timeout={tokens.motion.fast}>
            <Panel
              ref={panel}
              role="dialog"
              aria-label={label}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              $padding={padding}
            >
              <FocusIn panel={panel} />
              {children}
            </Panel>
          </Fade>
        </ClickAwayListener>
      )}
    </Popper>
  );
}
