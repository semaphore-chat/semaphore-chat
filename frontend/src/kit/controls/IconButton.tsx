import {
  useCallback,
  useEffect,
  useRef,
  type AriaAttributes,
  type JSX,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEvent,
  type Ref,
} from 'react';
import { useDescribedBy } from '../overlays/tooltipDescription';
import ButtonBase from '@mui/material/ButtonBase';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { focusRing, interactiveStates } from '../theme/states';
import { standOutFill, useSurface, type Surface } from '../theme/onSurface';
import { buttonLook, type ButtonVariant } from './buttonLook';
import { Spinner } from '../display/Spinner';
import { Badge } from '../display/Badge';
import { countWords, drawnCount, type CountMeaning } from '../display/countWords';
import { transientProps } from '../theme/transientProps';
import { assignRef } from '../behaviour/assignRef';
import { rowFocusProps, type RowFocus } from '../behaviour/hosts/listFocus';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = Extract<ButtonVariant, 'ghost' | 'soft' | 'primary' | 'danger'>;

/**
 * Press and hold (hold to talk): `onStart` when a pointer goes down on the button, `onEnd` exactly once when
 * that hold ends, wherever the pointer is by then.
 */
export interface IconButtonHold {
  onStart: () => void;
  onEnd: () => void;
}

export interface IconButtonProps {
  icon: IconName;
  /** The accessible name: an icon alone names nothing. */
  label: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** Sets `aria-pressed` and paints the fill with an accent icon. */
  selected?: boolean;
  disabled?: boolean;
  /**
   * Not available right now, but still focusable and named (unlike `disabled`): it reads as unavailable, looks
   * dimmed and a press does not run `onClick` (or start a `hold`). As Button's `aria-disabled`. Say why with
   * `onUnavailablePress`.
   */
  'aria-disabled'?: boolean;
  /** Called instead of `onClick` when an `aria-disabled` button is pressed: say why it cannot act (`useAnnounce`). */
  onUnavailablePress?: () => void;
  loading?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  ref?: Ref<HTMLButtonElement>;
  id?: string;
  /** Joins a keyboard list (a Dock): `useListFocus(...).rowFocus(id)`. The button becomes one stop of the list's single Tab stop. */
  focus?: RowFocus;
  title?: string;
  /**
   * Makes it a press-and-hold control (hold to talk). The pointer is captured on press, so sliding off the button
   * keeps the hold; it ends when the pointer is lifted or cancelled, when capture is lost, when the button becomes
   * disabled or when it unmounts. No long-press menu, no text selection, no scrolling from the button.
   */
  hold?: IconButtonHold;
  'aria-expanded'?: AriaAttributes['aria-expanded'];
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox' | true;
  'aria-controls'?: AriaAttributes['aria-controls'];
  /** A count over the button's corner (the Dock's Inbox), the same danger Badge as DockItem's; nothing for 0. Added to the name. */
  badge?: number;
  /** What `badge` counts, in the name: "9 unread" (default) or "2 mentions". */
  badgeMeaning?: CountMeaning;
  /**
   * The place you are in (an item on the Dock): the accent ring DockItem draws, ", current" in the name and
   * `aria-current="page"`. Not a toggle: use `selected` for that.
   */
  current?: boolean;
}

const ICON_SIZE = { sm: 'sm', md: 'md', lg: 'lg' } as const;

/** Half of what a small control lacks to reach the touch minimum, on each side. */
const TOUCH_OUTSET = (tokens.control.md - tokens.control.sm) / 2;

/** The current ring: as DockItem's, a surface gap then `border.selected` of accent, drawn outside the button. */
const RING = tokens.border.selected;
const RING_GAP = (tokens.control.md - tokens.avatar.md) / 2;
/** The focus ring's offset on a current button: past the current ring, then the usual focus offset. */
const CURRENT_FOCUS_OFFSET = RING_GAP + RING + tokens.border.focusOffset;

/** The count over the corner, ringed in the surface colour, placed as on a DockItem. */
const BadgeSlot = styled('span')(({ theme }) => ({
  position: 'absolute',
  top: `${-tokens.space.xs}px`,
  right: `${-tokens.space.xs}px`,
  display: 'inline-flex',
  borderRadius: `${tokens.radius.full}px`,
  boxShadow: `0 0 0 ${RING}px ${kitTheme(theme).palette.surface}`,
  pointerEvents: 'none',
}));

interface RootProps {
  $current: boolean;
  $variant: IconButtonVariant;
  $size: IconButtonSize;
  $selected: boolean;
  $on: Surface;
  $hold: boolean;
}

const Root = styled(ButtonBase, {
  shouldForwardProp: transientProps,
})<RootProps>(({ theme, $variant, $size, $selected, $on, $current, $hold }) => {
  const { palette } = kitTheme(theme);
  const look = buttonLook(palette, $variant, $on);
  // On the accent pill a ghost or soft button reads as the on-accent ink; a soft one keeps a faint
  // on-accent tint for its fill. States are the on-fill ones, tinted over the accent.
  const onAccent = $on === 'accent' && !$selected && ($variant === 'ghost' || $variant === 'soft');
  const tint = standOutFill(palette, 'accent');
  // The selected fill stands out from what it sits on; on the accent pill it is a plain `fill` chip.
  const selectedFill = $on === 'accent' ? palette.fill : standOutFill(palette, $on);
  const background = $selected
    ? selectedFill
    : onAccent
      ? $variant === 'soft'
        ? tint
        : 'transparent'
      : look.background;
  const color = $selected ? palette.accentText : onAccent ? palette.onAccent : look.label;
  const under = $selected ? selectedFill : onAccent ? ($variant === 'soft' ? tint : palette.accent) : look.stateBase;
  const onFill = onAccent || (!$selected && ($variant === 'primary' || $variant === 'danger'));

  return {
    position: 'relative',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: `${tokens.control[$size]}px`,
    height: `${tokens.control[$size]}px`,
    padding: 0,
    border: 'none',
    borderRadius: `${tokens.radius.full}px`,
    background,
    color,
    transition: `background-color ${tokens.motion.fast}ms`,
    ...interactiveStates({
      palette,
      under,
      hover: onFill ? tokens.state.hoverOnFill : tokens.state.hover,
      pressed: onFill ? tokens.state.pressedOnFill : tokens.state.pressed,
    }),
    // A small button keeps its look but gets a touch-sized hit area.
    ...($size === 'sm' && {
      '@media (pointer: coarse)': {
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: `${-TOUCH_OUTSET}px`,
        },
      },
    }),
    ...($current && {
      boxShadow: `0 0 0 ${RING_GAP}px ${palette.surface}, 0 0 0 ${RING_GAP + RING}px ${palette.accent}`,
      // The current ring covers the band the focus ring would draw in: move the focus ring outside it, with the
      // focus offset as its own gap, so keyboard focus on the current item always shows.
      '&:focus-visible': focusRing(palette, CURRENT_FOCUS_OFFSET),
    }),
    // A hold control: the finger on it must not scroll, select text or open the long-press menu.
    ...($hold && {
      touchAction: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
    }),
    '&:disabled': {
      opacity: tokens.state.disabled,
      pointerEvents: 'none',
    },
    // Unavailable but focusable: dimmed like disabled, with no hover or pressed layer (as Button).
    '&[aria-disabled="true"]:not([aria-busy="true"])': {
      opacity: tokens.state.disabled,
      cursor: 'default',
      '&:hover, &:active': { background },
    },
    '&[aria-busy="true"]': {
      cursor: 'progress',
      '&:hover, &:active': { background },
    },
  };
});

/**
 * Round, square icon button. `label` is its accessible name. While `loading`
 * it is busy (keeps focus and name, ignores activation) and shows a spinner in
 * place of the icon; only `disabled` removes it from the tab order, and
 * `disabled` wins over `loading`.
 */
export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  selected,
  disabled = false,
  'aria-disabled': unavailableProp = false,
  onUnavailablePress,
  loading = false,
  onClick,
  ref,
  id,
  focus,
  title,
  hold,
  'aria-expanded': ariaExpanded,
  'aria-haspopup': ariaHaspopup,
  'aria-controls': ariaControls,
  badge,
  badgeMeaning = 'unread',
  current = false,
}: IconButtonProps): JSX.Element {
  const count = drawnCount(badge);
  const name = [label, current ? 'current' : undefined, count > 0 ? countWords(count, badgeMeaning) : undefined]
    .filter((part) => part !== undefined)
    .join(', ');
  const on = useSurface();
  const busy = loading && !disabled;
  // Disabled wins over unavailable; busy wins over unavailable (it is already announced as unavailable).
  const unavailable = unavailableProp && !disabled && !busy;
  const describedBy = useDescribedBy(undefined);
  // A disabled button is not in the list: no tab stop, no clicks to report.
  const roving = disabled ? undefined : rowFocusProps(focus);
  const rovingRef = roving?.ref;
  // Stable, so neither the caller's ref nor the list's is detached and attached again on every render.
  const mainRef = useCallback(
    (element: HTMLButtonElement | null) => {
      assignRef(ref, element);
      rovingRef?.(element);
    },
    [ref, rovingRef],
  );

  // Hold: the latest callbacks given (a re-render mid-hold, even one that drops `hold`, must end the hold it
  // started) and whether one is running.
  const holdRef = useRef(hold);
  if (hold) holdRef.current = hold;
  // The pointer holding it: only that pointer's lift, cancel or lost capture ends the hold (a second finger's
  // tap on the button does not). Null while no hold runs.
  const holdingRef = useRef<number | null>(null);
  const endHold = useCallback(() => {
    if (holdingRef.current === null) return;
    holdingRef.current = null;
    holdRef.current?.onEnd();
  }, []);
  const endHoldFor = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerId === holdingRef.current) endHold();
  };
  const startHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!hold || disabled || busy || unavailable || holdingRef.current !== null) return;
    // The main button of a mouse or pen; any touch.
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    holdingRef.current = event.pointerId;
    hold.onStart();
  };
  // Ends a running hold when the button becomes disabled, unavailable or busy, stops being a hold control, or
  // unmounts.
  const holdAllowed = hold !== undefined && !disabled && !busy && !unavailable;
  useEffect(() => {
    if (!holdAllowed) endHold();
  }, [holdAllowed, endHold]);
  useEffect(() => endHold, [endHold]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    roving?.onClick(event);
    if (unavailable) {
      event.preventDefault();
      onUnavailablePress?.();
      return;
    }
    onClick?.(event);
  };

  return (
    <Root
      ref={mainRef}
      type="button"
      disabled={disabled}
      onClick={handleClick}
      aria-label={name}
      aria-current={current ? 'page' : undefined}
      aria-pressed={selected}
      aria-disabled={busy || unavailable || undefined}
      aria-busy={busy || undefined}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
      aria-describedby={describedBy}
      id={id}
      tabIndex={roving?.tabIndex}
      title={title}
      onPointerDown={hold ? startHold : undefined}
      onPointerUp={hold ? endHoldFor : undefined}
      onPointerCancel={hold ? endHoldFor : undefined}
      onLostPointerCapture={hold ? endHoldFor : undefined}
      onContextMenu={hold ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : undefined}
      disableRipple
      $variant={variant}
      $size={size}
      $selected={selected === true}
      $on={on}
      $current={current}
      $hold={hold !== undefined}
    >
      {busy ? (
        <Spinner size={ICON_SIZE[size]} />
      ) : (
        <Icon name={icon} size={ICON_SIZE[size]} />
      )}
      {count > 0 && (
        <BadgeSlot aria-hidden="true">
          <Badge count={count} tone="danger" label={countWords(count, badgeMeaning)} />
        </BadgeSlot>
      )}
    </Root>
  );
}
