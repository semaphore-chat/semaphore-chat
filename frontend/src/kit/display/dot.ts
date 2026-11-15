import { tokens } from '../../theme/generated/tokens';

/** The small round mark shared by Badge, Pill and Avatar-presence-sized dots: `space.sm` across. */
export function dotStyle(background: string) {
  return {
    flexShrink: 0,
    width: `${tokens.space.sm}px`,
    height: `${tokens.space.sm}px`,
    borderRadius: `${tokens.radius.full}px`,
    background,
  } as const;
}
