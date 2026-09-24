/**
 * Pixel-diff classification and diff-region geometry. Pure — `diff.ts` feeds
 * it pixelmatch output (which already discounts anti-aliased pixels and
 * per-pixel colour deltas under its `threshold`).
 */

/**
 * `unstable`: base and head differ, but so did two captures of the same side
 * (see `confirmChange`) — the story renders nondeterministically, so the diff
 * can't be attributed to the change.
 */
export type ShotStatus = 'changed' | 'unstable' | 'new' | 'removed' | 'unchanged' | 'missing';
export type StoryStatus = 'changed' | 'unstable' | 'new' | 'removed' | 'unchanged' | 'error';

export interface Thresholds {
  /** Differing pixels (after pixelmatch's AA/colour tolerance) at or below this are noise. */
  minPixels: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { minPixels: 24 };

export interface ShotComparison {
  hasBase: boolean;
  hasHead: boolean;
  sameSize: boolean;
  diffPixels: number;
  totalPixels: number;
}

export function classifyShot(c: ShotComparison, thresholds: Partial<Thresholds> = {}): ShotStatus {
  const { minPixels } = { ...DEFAULT_THRESHOLDS, ...thresholds };
  if (!c.hasBase && !c.hasHead) return 'missing';
  if (!c.hasBase) return 'new';
  if (!c.hasHead) return 'removed';
  if (!c.sameSize) return 'changed';
  return c.diffPixels > minPixels ? 'changed' : 'unchanged';
}

/**
 * Stability re-check of a change: `drift` holds the differing pixels between
 * two captures of the same side (head vs head again, base vs base again;
 * `Infinity` when the page size changed, absent when not re-captured). Any
 * drift above the noise floor means the story renders nondeterministically.
 */
export function confirmChange(
  status: ShotStatus,
  drift: { head?: number; base?: number },
  thresholds: Partial<Thresholds> = {},
): ShotStatus {
  if (status !== 'changed') return status;
  const { minPixels } = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const drifted = [drift.head, drift.base].some((d) => d !== undefined && d > minPixels);
  return drifted ? 'unstable' : 'changed';
}

export function summarizeStory(statuses: ShotStatus[]): StoryStatus {
  if (statuses.length === 0 || statuses.includes('missing')) return 'error';
  if (statuses.every((s) => s === 'new')) return 'new';
  if (statuses.every((s) => s === 'removed')) return 'removed';
  if (statuses.some((s) => s === 'changed' || s === 'new' || s === 'removed')) return 'changed';
  if (statuses.includes('unstable')) return 'unstable';
  return 'unchanged';
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Groups differing pixels into boxes: marks `cell`-sized grid cells that
 * contain a diff pixel, joins touching cells (8-neighbourhood) into clusters
 * and returns their cell-aligned bounds, clamped to the image. More than
 * `maxBoxes` clusters collapse into their union (a scattered change reads
 * better as one region).
 */
export function diffBoxes(
  mask: Uint8Array,
  width: number,
  height: number,
  { cell = 16, maxBoxes = 6 }: { cell?: number; maxBoxes?: number } = {},
): Box[] {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) grid[row + Math.floor(x / cell)] = 1;
    }
  }

  const seen = new Uint8Array(cols * rows);
  const boxes: Box[] = [];
  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || seen[start]) continue;
    let minC = cols;
    let minR = rows;
    let maxC = -1;
    let maxR = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const n = nr * cols + nc;
          if (grid[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    const x = minC * cell;
    const y = minR * cell;
    boxes.push({ x, y, width: Math.min(width, (maxC + 1) * cell) - x, height: Math.min(height, (maxR + 1) * cell) - y });
  }

  if (boxes.length > maxBoxes) return [unionBox(boxes)!];
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Vertical window of a (possibly very tall, full-page) shot to show, centred on the changes. */
export function cropWindow(pageHeight: number, boxes: Box[], maxHeight: number): { top: number; height: number } {
  if (pageHeight <= maxHeight) return { top: 0, height: pageHeight };
  const union = unionBox(boxes);
  if (!union) return { top: 0, height: maxHeight };
  const center = union.y + union.height / 2;
  const top = Math.round(Math.min(Math.max(0, center - maxHeight / 2), pageHeight - maxHeight));
  return { top, height: maxHeight };
}
