import type { JSX, MouseEventHandler, ReactNode } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { mix } from '../theme/mix';

export type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'quietDanger' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  startIcon?: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}

const PADDING: Record<ButtonSize, number> = {
  sm: tokens.space.md,
  md: tokens.space.lg,
  lg: tokens.space.xl,
};

interface RootProps {
  $variant: ButtonVariant;
  $size: ButtonSize;
  $fullWidth: boolean;
  $loading: boolean;
}

const Root = styled(ButtonBase, {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
})<RootProps>(({ theme, $variant, $size, $fullWidth, $loading }) => {
  const { palette } = kitTheme(theme);
  const { state } = tokens;

  // [background, label, resting-under-state colour, hover alpha, pressed alpha]
  const looks: Record<ButtonVariant, [string, string, string, number, number]> = {
    primary: [palette.accent, palette.onAccent, palette.accent, state.hoverOnFill, state.pressedOnFill],
    danger: [palette.danger, palette.onDanger, palette.danger, state.hoverOnFill, state.pressedOnFill],
    soft: [palette.fill, palette.text, palette.fill, state.hover, state.pressed],
    quietDanger: [palette.fill, palette.danger, palette.fill, state.hover, state.pressed],
    ghost: ['transparent', palette.textSecondary, palette.surface, state.hover, state.pressed],
    text: ['transparent', palette.accentText, palette.surface, state.hover, state.pressed],
  };
  const [background, label, under, hover, pressed] = looks[$variant];
  const type = $size === 'sm' ? tokens.text.meta : tokens.text.bodyStrong;

  return {
    position: 'relative',
    boxSizing: 'border-box',
    display: $fullWidth ? 'flex' : 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: `${tokens.space.sm}px`,
    height: `${tokens.control[$size]}px`,
    width: $fullWidth ? '100%' : undefined,
    maxWidth: '100%',
    padding: `0 ${PADDING[$size]}px`,
    border: 'none',
    borderRadius: `${tokens.radius.full}px`,
    background,
    color: label,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: tokens.text.bodyStrong.weight,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    transition: `background-color ${tokens.motion.fast}ms`,
    '&:hover': { background: mix(palette.text, under, hover) },
    '&:active': { background: mix(palette.text, under, pressed) },
    '&:focus-visible': {
      outline: `${tokens.border.focus}px solid ${palette.focus}`,
      outlineOffset: `${tokens.border.focusOffset}px`,
    },
    '&.Mui-disabled': {
      opacity: $loading ? undefined : state.disabled,
      pointerEvents: 'none',
    },
    '&.Mui-disabled:hover, &.Mui-disabled:active': { background },
  };
});

const Label = styled('span', {
  shouldForwardProp: (prop) => typeof prop === 'string' && !prop.startsWith('$'),
})<{ $hidden: boolean }>(({ $hidden }) => ({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  opacity: $hidden ? 0 : undefined,
}));

const IconSlot = styled('span')({
  display: 'inline-flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  width: `${tokens.icon.sm}px`,
  height: `${tokens.icon.sm}px`,
});

const SpinnerOverlay = styled('span')({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

function Spinner(): JSX.Element {
  return <CircularProgress aria-hidden="true" color="inherit" size={tokens.icon.sm} thickness={5} />;
}

/**
 * Pill button. While `loading` it is busy and unclickable: the spinner takes the
 * icon's place, or covers the (invisible but still named) label, so the width
 * never changes.
 */
export function Button({
  variant = 'soft',
  size = 'md',
  startIcon,
  fullWidth = false,
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
}: ButtonProps): JSX.Element {
  const spinnerInIconSlot = loading && startIcon !== undefined;
  const spinnerOverLabel = loading && startIcon === undefined;
  return (
    <Root
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading ? true : undefined}
      disableRipple
      $variant={variant}
      $size={size}
      $fullWidth={fullWidth}
      $loading={loading && !disabled}
    >
      {startIcon !== undefined && (
        <IconSlot>{spinnerInIconSlot ? <Spinner /> : startIcon}</IconSlot>
      )}
      <Label $hidden={spinnerOverLabel}>{children}</Label>
      {spinnerOverLabel && (
        <SpinnerOverlay>
          <Spinner />
        </SpinnerOverlay>
      )}
    </Root>
  );
}
