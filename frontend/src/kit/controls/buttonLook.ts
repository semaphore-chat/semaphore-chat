import type { Palette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';

export type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'quietDanger' | 'text';

/** A variant's paint: the resting fill and label, plus the tint and alphas of its states. */
export interface ButtonLook {
  background: string;
  label: string;
  stateBase: string;
  hover: number;
  pressed: number;
}

/**
 * The six variants' colours. `stateBase` is what hover and pressed tint: the
 * resting fill, or for a transparent fill the surface behind it. `onFill`: the
 * button sits on a Card, so the soft variants are drawn on `surface`.
 */
export function buttonLook(palette: Palette, variant: ButtonVariant, onFill = false): ButtonLook {
  const { state } = tokens;
  // On a Card (itself `fill`) the soft variants are `surface`, so they stay visible.
  const soft = onFill ? palette.surface : palette.fill;
  const looks: Record<ButtonVariant, ButtonLook> = {
    primary: {
      background: palette.accent,
      label: palette.onAccent,
      stateBase: palette.accent,
      hover: state.hoverOnFill,
      pressed: state.pressedOnFill,
    },
    danger: {
      background: palette.danger,
      label: palette.onDanger,
      stateBase: palette.danger,
      hover: state.hoverOnFill,
      pressed: state.pressedOnFill,
    },
    soft: {
      background: soft,
      label: palette.text,
      stateBase: soft,
      hover: state.hover,
      pressed: state.pressed,
    },
    quietDanger: {
      background: soft,
      label: palette.danger,
      stateBase: soft,
      hover: state.hover,
      pressed: state.pressed,
    },
    ghost: {
      background: 'transparent',
      label: palette.textSecondary,
      stateBase: palette.surface,
      hover: state.hover,
      pressed: state.pressed,
    },
    text: {
      background: 'transparent',
      label: palette.accentText,
      stateBase: palette.surface,
      hover: state.hover,
      pressed: state.pressed,
    },
  };
  return looks[variant];
}
