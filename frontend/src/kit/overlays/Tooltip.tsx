import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type PointerEvent,
  type ReactElement,
} from 'react';
import Popper from '@mui/material/Popper';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { ANCHOR_GAP } from './surface';

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

/**
 * A text hint for a control. It opens after a short delay on a mouse or pen
 * hover and at once on keyboard focus; a touch never opens it. Escape and blur
 * close it. While open, the child is linked to it with `aria-describedby`.
 *
 * The child can be any kit control: those take no extra props, so the events
 * are caught on a wrapper and the link is written to the child's DOM element.
 */
export function Tooltip({ label, children, placement = 'top' }: TooltipProps): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const wrapperRef = useCallback((node: HTMLElement | null) => {
    setTarget(node?.firstElementChild instanceof HTMLElement ? node.firstElementChild : null);
  }, []);

  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clearTimer, []);

  // Escape dismisses it from anywhere. When focus is on the child, the key is
  // spent here so a dialog around it stays open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      setOpen(false);
      if (target?.contains(event.target as Node) === true) {
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, target]);

  useEffect(() => {
    if (!open || target === null) {
      return undefined;
    }
    target.setAttribute('aria-describedby', id);
    return () => target.removeAttribute('aria-describedby');
  }, [open, target, id]);

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') {
      return;
    }
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), tokens.motion.slow);
  };
  const onPointerLeave = () => {
    clearTimer();
    setOpen(false);
  };
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (isFocusVisible(event.target)) {
      clearTimer();
      setOpen(true);
    }
  };
  const onBlur = () => {
    clearTimer();
    setOpen(false);
  };

  return (
    <Wrapper
      ref={wrapperRef}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
      <Popper
        id={id}
        open={open && target !== null}
        anchorEl={target}
        placement={placement}
        modifiers={[
          { name: 'offset', options: { offset: [0, ANCHOR_GAP] } },
          { name: 'preventOverflow', options: { padding: tokens.layout.gutter } },
        ]}
        // Hover must pass through to what is underneath, and the tooltip never takes focus.
        sx={(theme) => ({ pointerEvents: 'none', zIndex: theme.zIndex.tooltip })}
      >
        <Panel>
          {label}
        </Panel>
      </Popper>
    </Wrapper>
  );
}
