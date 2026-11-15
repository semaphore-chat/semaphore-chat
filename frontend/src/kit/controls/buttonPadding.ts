import { tokens } from '../../theme/generated/tokens';
import type { ButtonSize } from './Button';

/** Side padding of a button by size; Alert pulls its text button back by the small one. */
export const BUTTON_PADDING: Record<ButtonSize, number> = {
  sm: tokens.space.md,
  md: tokens.space.lg,
  lg: tokens.space.xl,
};
