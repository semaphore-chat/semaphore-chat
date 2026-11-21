import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { interactiveStates } from '../theme/states';
import { tintBase, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';
import { assignRef } from '../behaviour/assignRef';
import { isGridKey, nextGridPosition, type GridPosition } from './gridFocus';

/** One choice in the grid: an emoji (its glyph, or a custom emoji's picture) or a GIF's preview. */
export interface PickerGridItem {
  id: string;
  /** Its accessible name: "thumbs up", ":party_parrot:", the GIF's title. */
  label: string;
  /** A character drawn as the cell (an emoji). */
  glyph?: string;
  /** A picture drawn as the cell (a custom emoji, a GIF preview). */
  src?: string;
}

export interface PickerGridSection {
  id: string;
  /** Shown above the section's cells, and names the group. Leave it out for a grid of one unnamed section. */
  title?: string;
  items: readonly PickerGridItem[];
}

export type PickerGridVariant = 'glyph' | 'media';

export interface PickerGridProps {
  /** Names the whole grid: "Emoji", "GIFs". */
  label: string;
  sections: readonly PickerGridSection[];
  /** `glyph` (default): small square cells for emoji. `media`: wide cells for GIF previews, cropped to fit. */
  variant?: PickerGridVariant;
  onPick: (item: PickerGridItem, sectionId: string) => void;
  /** More can be loaded: called when the end of the grid comes into view (or focus reaches its last row). */
  loadMore?: () => void;
  /** Under the last section: a spinner while more load. */
  footer?: ReactNode;
  /** The cell that is in the tab order (the grid's one Tab stop), for focusing the grid from outside. */
  activeCellRef?: Ref<HTMLButtonElement>;
}

const Root = styled('div')({ display: 'flex', flexDirection: 'column', gap: `${tokens.space.md}px`, minWidth: 0 });

const Section = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: `${tokens.space.xs}px`,
  minWidth: 0,
  // Long lists draw only what is near the view (the picker has ~500 emoji).
  contentVisibility: 'auto',
  containIntrinsicSize: `auto ${4 * tokens.control.md}px`,
});

const Title = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.tag;
  return {
    color: palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
    padding: `0 ${tokens.space.xs}px`,
  };
});

/** Glyph cells are at least a control wide (a touch target on a phone); media cells about a third of a small dialog. */
const MIN_CELL: Record<PickerGridVariant, number> = { glyph: tokens.control.md, media: tokens.layout.dialogSm / 3 };

const Cells = styled('div', { shouldForwardProp: transientProps })<{ $variant: PickerGridVariant }>(({ $variant }) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_CELL[$variant]}px, 1fr))`,
  gap: `${$variant === 'glyph' ? tokens.space['2xs'] : tokens.space.xs}px`,
  minWidth: 0,
}));

const Cell = styled('button', { shouldForwardProp: transientProps })<{ $variant: PickerGridVariant; $on: Surface }>(
  ({ theme, $variant, $on }) => {
    const { palette } = kitTheme(theme);
    return {
      appearance: 'none',
      border: 0,
      margin: 0,
      padding: $variant === 'glyph' ? `${tokens.space.xs}px` : 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 0,
      aspectRatio: $variant === 'glyph' ? '1' : '4 / 3',
      overflow: 'hidden',
      cursor: 'pointer',
      color: palette.text,
      background: $variant === 'glyph' ? 'transparent' : palette.fill,
      borderRadius: `${$variant === 'glyph' ? tokens.radius.sm : tokens.radius.md}px`,
      fontSize: `${tokens.icon.xl}px`,
      lineHeight: 1,
      ...interactiveStates({ palette, under: tintBase(palette, $on), hover: tokens.state.hover, pressed: tokens.state.pressed }),
      '&:focus-visible': { outline: `${tokens.border.focus}px solid ${palette.focus}`, outlineOffset: `${-tokens.border.focus}px` },
      '& > img': {
        display: 'block',
        width: $variant === 'glyph' ? `${tokens.icon.xl}px` : '100%',
        height: $variant === 'glyph' ? `${tokens.icon.xl}px` : '100%',
        objectFit: $variant === 'glyph' ? 'contain' : 'cover',
        pointerEvents: 'none',
      },
    };
  },
);

const Sentinel = styled('div')({ height: 1, flex: '0 0 auto' });

/** How many columns a section's grid has as laid out (one when it is not laid out, as in a test DOM). */
function columnsOf(element: HTMLElement | null): number {
  if (element === null) return 1;
  const template = getComputedStyle(element).gridTemplateColumns;
  const count = template && template !== 'none' ? template.trim().split(/\s+/).length : 0;
  if (count > 0) return count;
  // No computed template: count the cells on the first row by their offset.
  const cells = [...element.children] as HTMLElement[];
  const top = cells[0]?.offsetTop;
  return Math.max(1, cells.filter((cell) => cell.offsetTop === top).length);
}

/**
 * A grid of choices to pick one from: the emoji picker and the GIF picker. Sections of cells in rows that fill the
 * width; one Tab stop (the last cell focused, else the first), the arrow keys move between cells in two dimensions
 * and across sections, Home and End go to the first and last cell, Enter or Space picks. Each cell is a button named
 * by its label. It holds no data: the search, the sections and what a pick does are the screen's.
 */
export function PickerGrid({ label, sections, variant = 'glyph', onPick, loadMore, footer, activeCellRef }: PickerGridProps): JSX.Element {
  const on = useSurface();
  const [active, setActive] = useState<GridPosition>({ section: 0, index: 0 });
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const grids = useRef<(HTMLDivElement | null)[]>([]);
  const counts = sections.map((section) => section.items.length);

  // The sections changed under the active cell (a search narrowed them): keep it in range.
  const valid = (counts[active.section] ?? 0) > active.index;
  const position: GridPosition = valid ? active : { section: Math.max(0, counts.findIndex((n) => n > 0)), index: 0 };
  const activeItem = sections[position.section]?.items[position.index];

  const moveTo = useCallback(
    (next: GridPosition) => {
      setActive(next);
      const item = sections[next.section]?.items[next.index];
      if (item !== undefined) cells.current.get(`${sections[next.section].id}/${item.id}`)?.focus();
    },
    [sections],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isGridKey(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const columns = sections.map((_, s) => columnsOf(grids.current[s] ?? null));
    const next = nextGridPosition(event.key, position, counts, columns);
    if (next.section !== position.section || next.index !== position.index) moveTo(next);
    // Focus on the last row asks for more (a keyboard reader never scrolls the sentinel into view first).
    const last = sections.length - 1;
    if (loadMore !== undefined && next.section === last && next.index >= counts[last] - (columns[last] ?? 1)) loadMore();
  };

  // The end of the grid came into view: load more.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(loadMore);
  useLayoutEffect(() => {
    loadMoreRef.current = loadMore;
  });
  const wantsMore = loadMore !== undefined;
  useEffect(() => {
    const element = sentinel.current;
    if (!wantsMore || element === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current?.();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [wantsMore]);

  return (
    <Root role="group" aria-label={label} onKeyDown={onKeyDown}>
      {sections.map((section, s) =>
        section.items.length === 0 ? null : (
          <Section key={section.id} role="group" aria-label={section.title}>
            {section.title !== undefined && <Title aria-hidden>{section.title}</Title>}
            <Cells
              $variant={variant}
              ref={(element: HTMLDivElement | null) => {
                grids.current[s] = element;
              }}
            >
              {section.items.map((item, index) => {
                const isActive = activeItem !== undefined && s === position.section && index === position.index;
                const key = `${section.id}/${item.id}`;
                return (
                  <Cell
                    key={item.id}
                    type="button"
                    $variant={variant}
                    $on={on}
                    aria-label={item.label}
                    title={variant === 'glyph' ? item.label : undefined}
                    tabIndex={isActive ? 0 : -1}
                    data-picker-cell=""
                    ref={(element: HTMLButtonElement | null) => {
                      if (element === null) cells.current.delete(key);
                      else cells.current.set(key, element);
                      if (isActive && activeCellRef !== undefined) assignRef(activeCellRef, element);
                    }}
                    onFocus={() => {
                      if (!isActive) setActive({ section: s, index });
                    }}
                    onClick={() => onPick(item, section.id)}
                  >
                    {item.src !== undefined ? (
                      <img src={item.src} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} />
                    ) : (
                      <span aria-hidden>{item.glyph ?? item.label}</span>
                    )}
                  </Cell>
                );
              })}
            </Cells>
          </Section>
        ),
      )}
      {footer}
      {wantsMore && <Sentinel ref={sentinel} aria-hidden />}
    </Root>
  );
}
