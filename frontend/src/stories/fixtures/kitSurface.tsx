import type { JSX, ReactNode } from 'react';
import { derivePalette, type IntensityName, type ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';

/**
 * An island: the `surface` colour with the island radius, where list rows live
 * in the app. Story-only.
 */
export function KitSurface({
  width,
  mode = 'dark',
  base = '#8E75FF',
  intensity = 'minimal',
  children,
}: {
  /** The same look as the surrounding KitStage (MUI stays inside the kit, so the palette is derived here). */
  mode?: ModeName;
  base?: string;
  intensity?: IntensityName;
  /** A fixed width in px, to show a row in a narrow column. */
  width?: number;
  children: ReactNode;
}): JSX.Element {
  const palette = derivePalette(base, mode, intensity);
  return (
    <div
      style={{
        boxSizing: 'border-box',
        width: width ?? '100%',
        maxWidth: '100%',
        padding: tokens.space.md,
        borderRadius: tokens.radius.island,
        background: palette.surface,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space['2xs'],
      }}
    >
      {children}
    </div>
  );
}
