/**
 * Where a key moves the focused cell of a picker grid (`PickerGrid`): sections of cells in rows of `columns[s]`,
 * one after another. Pure, so it is tested without a DOM, and the native kit mirrors it.
 *
 * - ←/→ step one cell, across the end of a section into the next one.
 * - ↑/↓ step one row; past a section's first or last row into the next section's nearest row, same column (or its
 *   last cell when that row is shorter).
 * - Home/End: the grid's first and last cell.
 *
 * Any other key, or a step past the grid's edge, returns the same position.
 */
export interface GridPosition {
  section: number;
  index: number;
}

export const GRID_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;

export function isGridKey(key: string): boolean {
  return (GRID_KEYS as readonly string[]).includes(key);
}

/** The index of the section after (step 1) or before (step -1) `from` that has cells, or -1. */
function nextFilled(counts: readonly number[], from: number, step: 1 | -1): number {
  for (let s = from + step; s >= 0 && s < counts.length; s += step) if (counts[s] > 0) return s;
  return -1;
}

export function nextGridPosition(
  key: string,
  at: GridPosition,
  counts: readonly number[],
  columns: readonly number[],
): GridPosition {
  const count = counts[at.section] ?? 0;
  if (count === 0) return at;
  const cols = Math.max(1, columns[at.section] ?? 1);
  const column = at.index % cols;
  switch (key) {
    case 'ArrowRight': {
      if (at.index + 1 < count) return { section: at.section, index: at.index + 1 };
      const next = nextFilled(counts, at.section, 1);
      return next === -1 ? at : { section: next, index: 0 };
    }
    case 'ArrowLeft': {
      if (at.index > 0) return { section: at.section, index: at.index - 1 };
      const prev = nextFilled(counts, at.section, -1);
      return prev === -1 ? at : { section: prev, index: counts[prev] - 1 };
    }
    case 'ArrowDown': {
      if (at.index + cols < count) return { section: at.section, index: at.index + cols };
      // The last row of this section, but a shorter last row below this one's column: its last cell.
      const lastRowStart = Math.floor((count - 1) / cols) * cols;
      if (at.index < lastRowStart) return { section: at.section, index: count - 1 };
      const next = nextFilled(counts, at.section, 1);
      if (next === -1) return at;
      const nextCols = Math.max(1, columns[next] ?? 1);
      return { section: next, index: Math.min(column, nextCols - 1, counts[next] - 1) };
    }
    case 'ArrowUp': {
      if (at.index - cols >= 0) return { section: at.section, index: at.index - cols };
      const prev = nextFilled(counts, at.section, -1);
      if (prev === -1) return at;
      const prevCols = Math.max(1, columns[prev] ?? 1);
      const lastRowStart = Math.floor((counts[prev] - 1) / prevCols) * prevCols;
      return { section: prev, index: Math.min(lastRowStart + Math.min(column, prevCols - 1), counts[prev] - 1) };
    }
    case 'Home': {
      const first = nextFilled(counts, -1, 1);
      return first === -1 ? at : { section: first, index: 0 };
    }
    case 'End': {
      const last = nextFilled(counts, counts.length, -1);
      return last === -1 ? at : { section: last, index: counts[last] - 1 };
    }
    default:
      return at;
  }
}
