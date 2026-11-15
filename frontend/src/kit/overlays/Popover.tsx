import { useEffect, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import Fade from '@mui/material/Fade';
import Popper from '@mui/material/Popper';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import { ANCHOR_GAP, overlaySurface, reducedMotion, type Placement } from './surface';

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
 * The panel renders in a portal at the end of the page, so Tab from its last
 * control continues after the page. Do not open one from inside a Dialog: the
 * Dialog's focus trap takes focus back.
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
  // The latest onClose, so the listeners below are not re-added on every render.
  const close = useRef(onClose);
  close.current = onClose;

  // Focus in on open; focus back to the anchor on close.
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

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      close.current();
      // Spent here: an enclosing layer must not also close on this key.
      event.stopPropagation();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The anchor handles its own presses (it may toggle the popover).
      if (panel.current?.contains(target) === true || anchor?.contains(target) === true) {
        return;
      }
      close.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, anchor]);

  return (
    <Popper
      open={open && anchor !== null}
      anchorEl={anchor}
      placement={placement}
      transition
      role={undefined}
      modifiers={[
        { name: 'offset', options: { offset: [0, ANCHOR_GAP] } },
        { name: 'preventOverflow', options: { padding: tokens.layout.gutter } },
      ]}
      sx={(theme) => ({ zIndex: theme.zIndex.modal })}
    >
      {({ TransitionProps }) => (
        <Fade {...TransitionProps} timeout={tokens.motion.fast}>
          <Panel
            ref={panel}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            $padding={padding}
          >
            <FocusIn panel={panel} />
            {children}
          </Panel>
        </Fade>
      )}
    </Popper>
  );
}
