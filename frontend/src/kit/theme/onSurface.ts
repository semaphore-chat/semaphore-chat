import { createContext, useContext } from 'react';
import type { Palette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { mix } from './mix';

/**
 * Which layer a kit piece is drawn on. Pieces read it and adjust their own
 * colours, so a caller never picks a different colour because it sits on a card.
 *
 * - `ground`: the page under everything (KitRoot, outside an Island).
 * - `surface`: an Island or an overlay panel (Dialog, Sheet, Popover, Menu, Tooltip).
 * - `fill`: a Card, or anything else drawn in the `fill` colour.
 * - `accent`: a selected ListRow, the solid accent pill.
 *
 * Internal: no public prop. An overlay panel resets the value to `surface`
 * (context crosses portals, so a Dialog opened from a Card would otherwise
 * inherit `fill`). Content that is not a kit component keeps its own colours.
 */
export type Surface = 'ground' | 'surface' | 'fill' | 'accent';

export const SurfaceContext = createContext<Surface>('ground');

/** The layer this component is drawn on. */
export function useSurface(): Surface {
  return useContext(SurfaceContext);
}

/**
 * The background a fill-coloured piece (a soft button, a neutral pill, a field
 * box, a track) uses so it stays visible on `on`: `fill` on the ground or a
 * surface, `surface` on a fill, and on the accent pill the faint on-accent tint.
 */
export function standOutFill(palette: Palette, on: Surface): string {
  switch (on) {
    case 'fill':
      return palette.surface;
    case 'accent':
      return mix(palette.onAccent, palette.accent, tokens.state.pressedOnFill);
    default:
      return palette.fill;
  }
}

/** The colour a hover or pressed tint is mixed over for a piece with no background of its own on `on`. */
export function tintBase(palette: Palette, on: Surface): string {
  switch (on) {
    case 'ground':
      return palette.ground;
    case 'fill':
      return palette.fill;
    case 'accent':
      return palette.accent;
    default:
      return palette.surface;
  }
}

/**
 * The unfilled part of a slider or progress rail: the hairline colour, except on a fill, where a
 * hairline would all but vanish and the rail takes the surface colour like any fill-coloured piece.
 */
export function railFill(palette: Palette, on: Surface): string {
  return on === 'fill' ? standOutFill(palette, on) : palette.hairline;
}
