/**
 * How the Lounge's pieces arrange kit components inside an island: rows and columns with a gap from
 * the space scale. The kit has no layout primitive for the inside of an island; its own stories lay
 * components out the same way (`stories/kit/KitCard.stories.tsx`, `stories/fixtures/layoutSamples.tsx`),
 * with the token names and never a pixel number. Only flex direction, alignment and gap: colours,
 * sizes and shapes always come from the components.
 */
import type { CSSProperties } from 'react';
import { tokens } from '../../../theme/generated/tokens';

export type Gap = keyof typeof tokens.space;

/** Children side by side, centred on the cross axis. */
export function row(gap: Gap = 'sm'): CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: tokens.space[gap], minWidth: 0 };
}

/** Children stacked, full width. */
export function column(gap: Gap = 'none'): CSSProperties {
  return { display: 'flex', flexDirection: 'column', gap: tokens.space[gap], minWidth: 0 };
}

/** Takes the rest of a row and lets its text truncate. */
export const grow: CSSProperties = { flex: 1, minWidth: 0 };

/** Stays its own size in a row. */
export const fixed: CSSProperties = { flexShrink: 0 };

/** Each section of an island starts this far below the one above it. */
export const SECTION_GAP: Gap = 'lg';

/**
 * Pins a block to the foot of a scrolling island (the user card): it sits below short content and over
 * the end of long content, reaching into the island's bottom padding with the island's own fill so a
 * row scrolling beneath never shows under it. `surface` is the island's palette role.
 */
export function pinnedFoot(surface: string, islandPadding: Gap = 'md'): CSSProperties {
  const inset = tokens.space[islandPadding];
  return {
    marginTop: 'auto',
    position: 'sticky',
    bottom: -inset,
    marginBottom: -inset,
    paddingTop: tokens.space.sm,
    paddingBottom: inset,
    background: surface,
    zIndex: 1,
  };
}
