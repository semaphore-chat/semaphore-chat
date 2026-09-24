/**
 * Pixel-diff classification and diff-region geometry. Pure — `cli.ts diff`
 * feeds it pixelmatch output (which already discounts anti-aliased pixels and
 * per-pixel colour deltas under its `threshold`).
 */

/**
 * `unstable`: base and head differ, but capturing both sides again did not
 * reproduce the difference (see `confirmChange`) — the story renders
 * nondeterministically, so the diff can't be attributed to the change.
 */
export type ShotStatus = 'changed' | 'unstable' | 'new' | 'removed' | 'unchanged' | 'missing';
export type StoryStatus = 'changed' | 'unstable' | 'new' | 'removed' | 'unchanged' | 'error';

export interface Thresholds {
  /** Differing pixels (after pixelmatch's AA/colour tolerance) at or below this are noise. */
  minPixels: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { minPixels: 24 };

/**
 * pixelmatch's per-pixel colour tolerance (0-1, YIQ distance). 0.1, its
 * default, ignores grey steps below ~26/255 — a divider or border opacity
 * tweak. Renders are pixel-exact run to run (same Chromium, fonts, frozen
 * clock), so the tool can afford a much stricter value: 0.03 still ignores
 * steps below ~8/255.
 */
export const DEFAULT_PIXEL_THRESHOLD = 0.03;

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
 * Stability re-check of a change. `rechecks` holds, for each re-capture of
 * both sides, the base-vs-head differing pixels *inside the region of the
 * first diff* (see `pixelsInBoxes`). A real change reproduces there on every
 * re-capture; a difference that vanishes on any re-capture came from a race
 * (a menu opened while media was sizing, a page caught mid-load), so the shot
 * is `unstable`. Differences elsewhere on the page (a list scrolled
 * differently on one capture) don't matter: they neither confirm nor refute
 * this change.
 */
export function confirmChange(status: ShotStatus, rechecks: number[], thresholds: Partial<Thresholds> = {}): ShotStatus {
  if (status !== 'changed') return status;
  const { minPixels } = { ...DEFAULT_THRESHOLDS, ...thresholds };
  return rechecks.some((pixels) => pixels <= minPixels) ? 'unstable' : 'changed';
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

/** Boxes grown by `margin` px on every side, clamped to the image. */
export function growBoxes(boxes: Box[], margin: number, width: number, height: number): Box[] {
  return boxes.map((b) => {
    const x = Math.max(0, b.x - margin);
    const y = Math.max(0, b.y - margin);
    return { x, y, width: Math.min(width, b.x + b.width + margin) - x, height: Math.min(height, b.y + b.height + margin) - y };
  });
}

/** Set pixels of `mask` (width × height) that fall inside any of `boxes` (each pixel counted once). */
export function pixelsInBoxes(mask: Uint8Array, width: number, height: number, boxes: Box[]): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] && boxes.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height)) count++;
    }
  }
  return count;
}
