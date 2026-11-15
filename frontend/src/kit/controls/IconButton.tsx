import { useCallback, type AriaAttributes, type JSX, type MouseEvent, type MouseEventHandler, type Ref } from 'react';
import { useDescribedBy } from '../overlays/tooltipDescription';
import ButtonBase from '@mui/material/ButtonBase';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
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

export interface IconButtonProps {
  icon: IconName;
  /** The accessible name: an icon alone names nothing. */
  label: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** Sets `aria-pressed` and paints the fill with an accent icon. */
  selected?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  ref?: Ref<HTMLButtonElement>;
  id?: string;
  /** Joins a keyboard list (a Dock): `useListFocus(...).rowFocus(id)`. The button becomes one stop of the list's single Tab stop. */
  focus?: RowFocus;
  title?: string;
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
}

const Root = styled(ButtonBase, {
  shouldForwardProp: transientProps,
})<RootProps>(({ theme, $variant, $size, $selected, $on, $current }) => {
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
    }),
    '&:disabled': {
      opacity: tokens.state.disabled,
      pointerEvents: 'none',
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
  loading = false,
  onClick,
  ref,
  id,
  focus,
  title,
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

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    roving?.onClick(event);
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
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
      aria-describedby={describedBy}
      id={id}
      tabIndex={roving?.tabIndex}
      title={title}
      disableRipple
      $variant={variant}
      $size={size}
      $selected={selected === true}
      $on={on}
      $current={current}
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
