import type { Palette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { standOutFill, tintBase, type Surface } from '../theme/onSurface';

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
 * resting fill, or for a transparent fill what the button sits on (`on`). The soft
 * variants are drawn so they stand out from `on`: `surface` on a Card, `fill` elsewhere.
 * On the accent pill a soft button keeps a plain `fill` chip (the faint on-accent tint
 * cannot carry a text label).
 */
export function buttonLook(palette: Palette, variant: ButtonVariant, on: Surface = 'surface'): ButtonLook {
  const { state } = tokens;
  const soft = on === 'accent' ? palette.fill : standOutFill(palette, on);
  const behind = tintBase(palette, on);
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
      stateBase: behind,
      hover: state.hover,
      pressed: state.pressed,
    },
    text: {
      background: 'transparent',
      label: palette.accentText,
      stateBase: behind,
      hover: state.hover,
      pressed: state.pressed,
    },
  };
  return looks[variant];
}
