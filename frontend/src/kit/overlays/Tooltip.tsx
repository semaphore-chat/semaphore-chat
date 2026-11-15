import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import Popper from '@mui/material/Popper';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';
import { useOverlayContainer } from './overlayContainer';
import { ANCHOR_GAP, layerIndex } from './surface';
import { TooltipDescriptionContext, type TooltipDescription } from './tooltipDescription';

export interface TooltipProps {
  /** The text; never interactive content. */
  label: string;
  /** One element. It keeps its own accessible name; the tooltip only describes it. */
  children: ReactElement;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/** Never rendered into layout: the wrapper only catches the child's events as they bubble. */
const Wrapper = styled('span')({ display: 'contents' });

const Panel = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    boxSizing: 'border-box',
    maxWidth: `calc(100vw - ${2 * tokens.layout.gutter}px)`,
    padding: `${tokens.space.xs}px ${tokens.space.sm}px`,
    borderRadius: `${tokens.radius.sm}px`,
    // Inverted, so it reads on any surface.
    background: palette.text,
    color: palette.ground,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.small.size}px`,
    lineHeight: `${tokens.text.small.line}px`,
    fontWeight: tokens.text.small.weight,
    overflowWrap: 'anywhere',
  };
});

/** The keyboard-focus test, with a fallback for engines that lack `:focus-visible`. */
function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A text hint for a control. It opens after a short delay on a mouse or pen
 * hover and at once on keyboard focus; a touch, even into a text field, never
 * opens it. Escape and blur close it. While open, the control is linked to it
 * with `aria-describedby`.
 *
 * Kit controls take no extra props, so the link goes through an internal
 * context: the control puts the tooltip's id next to its own description on the
 * element that takes focus. A child that is not a kit control gets the id
 * written to its DOM element, merged into what is there and taken out again on
 * close. A disabled control cannot take focus and may not show a hover tooltip;
 * put the hint in text beside it instead. The panel is not hoverable.
 */
export function Tooltip({ label, children, placement = 'top' }: TooltipProps): JSX.Element {
  const id = useId();
  const container = useOverlayContainer();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // How many kit controls inside wire the description themselves.
  const claims = useRef(0);
  // True from a touch press until the next key or non-touch press: a focus then is a tap, not the keyboard.
  const touched = useRef(false);

  const claim = useCallback(() => {
    claims.current += 1;
    return () => {
      claims.current -= 1;
    };
  }, []);
  const description = useMemo<TooltipDescription>(
    () => ({ id: open ? id : undefined, claim }),
    [open, id, claim],
  );

  // The anchor is read when the tooltip opens, so a child that swapped its element is followed.
  const show = () => {
    const first = wrapper.current?.firstElementChild;
    setAnchor(first instanceof HTMLElement ? first : null);
    setOpen(true);
  };

  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clearTimer, []);

  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      touched.current = event.pointerType === 'touch';
    };
    const onKeyDown = () => {
      touched.current = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  // Escape with focus elsewhere (a hover tooltip): hide it and let the key go on.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // For a child that is not a kit control: merge the id into the focusable
  // element's description and take only that id out on close.
  useEffect(() => {
    if (!open || anchor === null || claims.current > 0) {
      return undefined;
    }
    const target = anchor.matches(FOCUSABLE) ? anchor : (anchor.querySelector<HTMLElement>(FOCUSABLE) ?? anchor);
    const ids = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.includes(id)) {
      return undefined;
    }
    target.setAttribute('aria-describedby', [...ids, id].join(' '));
    return () => {
      const left = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((token) => token !== '' && token !== id);
      if (left.length === 0) {
        target.removeAttribute('aria-describedby');
      } else {
        target.setAttribute('aria-describedby', left.join(' '));
      }
    };
  }, [open, anchor, id]);

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') {
      return;
    }
    clearTimer();
    timer.current = setTimeout(show, tokens.motion.slow);
  };
  const onPointerLeave = () => {
    clearTimer();
    setOpen(false);
  };
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (!touched.current && isFocusVisible(event.target)) {
      clearTimer();
      show();
    }
  };
  const onBlur = () => {
    clearTimer();
    setOpen(false);
  };
  // With focus in the child, Escape ends here: a dialog around it stays open and
  // the child still saw the key first (a search field that clears on Escape).
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (open && event.key === 'Escape' && !event.nativeEvent.isComposing) {
      setOpen(false);
      event.stopPropagation();
    }
  };

  return (
    <Wrapper
      ref={wrapper}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <TooltipDescriptionContext value={description}>{children}</TooltipDescriptionContext>
      <Popper
        id={id}
        open={open && anchor !== null}
        anchorEl={anchor}
        container={container}
        placement={placement}
        modifiers={[
          { name: 'offset', options: { offset: [0, ANCHOR_GAP] } },
          { name: 'preventOverflow', options: { padding: tokens.layout.gutter } },
        ]}
        // Hover must pass through to what is underneath, and the tooltip never takes focus.
        sx={(theme) => ({ pointerEvents: 'none', zIndex: layerIndex(theme, 'tooltip') })}
      >
        <SurfaceContext value="surface">
          <Panel>{label}</Panel>
        </SurfaceContext>
      </Popper>
    </Wrapper>
  );
}
