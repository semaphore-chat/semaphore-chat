import type { AriaAttributes, JSX, MouseEvent, MouseEventHandler, Ref } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { Icon } from '../display/Icon';
import type { IconName } from '../icons/generated';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { buttonLook, type ButtonVariant } from './buttonLook';

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
  title?: string;
  'aria-expanded'?: AriaAttributes['aria-expanded'];
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox' | true;
  'aria-controls'?: AriaAttributes['aria-controls'];
}

const ICON_SIZE = { sm: 'sm', md: 'md', lg: 'lg' } as const;

/** Half of what a small control lacks to reach the touch minimum, on each side. */
const TOUCH_OUTSET = (tokens.control.md - tokens.control.sm) / 2;

interface RootProps {
  $variant: IconButtonVariant;
  $size: IconButtonSize;
  $selected: boolean;
}

const Root = styled(ButtonBase, {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
})<RootProps>(({ theme, $variant, $size, $selected }) => {
  const { palette } = kitTheme(theme);
  const look = buttonLook(palette, $variant);
  const background = $selected ? palette.fill : look.background;
  const color = $selected ? palette.accentText : look.label;
  const under = $selected ? palette.fill : look.stateBase;
  const onFill = !$selected && ($variant === 'primary' || $variant === 'danger');

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
 * place of the icon; only `disabled` removes it from the tab order.
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
  title,
  'aria-expanded': ariaExpanded,
  'aria-haspopup': ariaHaspopup,
  'aria-controls': ariaControls,
}: IconButtonProps): JSX.Element {
  const busy = loading && !disabled;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <Root
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={handleClick}
      aria-label={label}
      aria-pressed={selected}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
      id={id}
      title={title}
      disableRipple
      $variant={variant}
      $size={size}
      $selected={selected === true}
    >
      {busy ? (
        <CircularProgress
          aria-hidden="true"
          color="inherit"
          size={tokens.icon[ICON_SIZE[size]]}
          thickness={5}
        />
      ) : (
        <Icon name={icon} size={ICON_SIZE[size]} />
      )}
    </Root>
  );
}
