import type {
  AriaAttributes,
  JSX,
  MouseEvent,
  MouseEventHandler,
  ReactNode,
  Ref,
} from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { BUTTON_PADDING } from './buttonPadding';
import { buttonLook, type ButtonVariant } from './buttonLook';
import { Spinner } from '../display/Spinner';
import { transientProps } from '../theme/transientProps';

export type { ButtonVariant } from './buttonLook';

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
  /** React 19 plain prop, so a component can anchor a menu or tooltip to the button. */
  ref?: Ref<HTMLButtonElement>;
  id?: string;
  title?: string;
  'aria-label'?: AriaAttributes['aria-label'];
  'aria-expanded'?: AriaAttributes['aria-expanded'];
  'aria-haspopup'?: AriaAttributes['aria-haspopup'];
  'aria-controls'?: AriaAttributes['aria-controls'];
  'aria-pressed'?: AriaAttributes['aria-pressed'];
  children: ReactNode;
}

interface RootProps {
  $variant: ButtonVariant;
  $size: ButtonSize;
  $fullWidth: boolean;
}

const Root = styled(ButtonBase, {
  shouldForwardProp: transientProps,
})<RootProps>(({ theme, $variant, $size, $fullWidth }) => {
  const { palette } = kitTheme(theme);
  const look = buttonLook(palette, $variant);
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
    padding: `0 ${BUTTON_PADDING[$size]}px`,
    border: 'none',
    borderRadius: `${tokens.radius.full}px`,
    background: look.background,
    color: look.label,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: tokens.text.bodyStrong.weight,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    transition: `background-color ${tokens.motion.fast}ms`,
    ...interactiveStates({
      palette,
      under: look.stateBase,
      hover: look.hover,
      pressed: look.pressed,
    }),
    '&:disabled': {
      opacity: tokens.state.disabled,
      pointerEvents: 'none',
    },
    // Busy is an ARIA state, not `disabled`: the button keeps focus and its
    // name, so it must not paint a hover or pressed layer while it works.
    '&[aria-busy="true"]': {
      cursor: 'progress',
      '&:hover, &:active': { background: look.background },
    },
  };
});

const Label = styled('span', {
  shouldForwardProp: transientProps,
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

/**
 * Pill button. While `loading` it is busy: it keeps focus and its accessible
 * name, ignores clicks and Enter (so a `type="submit"` button cannot submit
 * its form), and shows a spinner in the icon's place, or over the label, so
 * the width never changes. Only `disabled` takes it out of the tab order.
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
  ref,
  id,
  title,
  'aria-label': ariaLabel,
  'aria-expanded': ariaExpanded,
  'aria-haspopup': ariaHaspopup,
  'aria-controls': ariaControls,
  'aria-pressed': ariaPressed,
  children,
}: ButtonProps): JSX.Element {
  const busy = loading && !disabled;
  // Disabled wins over loading: a disabled button shows no spinner.
  const spinnerInIconSlot = busy && startIcon !== undefined;
  const spinnerOverLabel = busy && startIcon === undefined;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      // Cancelling the click also cancels the submit a type="submit" button
      // would trigger, by mouse or by Enter in a field of the same form.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <Root
      ref={ref}
      type={type}
      disabled={disabled}
      onClick={handleClick}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
      aria-pressed={ariaPressed}
      id={id}
      title={title}
      disableRipple
      $variant={variant}
      $size={size}
      $fullWidth={fullWidth}
    >
      {startIcon !== undefined && (
        <IconSlot>{spinnerInIconSlot ? <Spinner size="sm" /> : startIcon}</IconSlot>
      )}
      <Label $hidden={spinnerOverLabel}>{children}</Label>
      {spinnerOverLabel && (
        <SpinnerOverlay>
          <Spinner size="sm" />
        </SpinnerOverlay>
      )}
    </Root>
  );
}
