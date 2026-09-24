// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  classifyShot,
  confirmChange,
  summarizeStory,
  diffBoxes,
  unionBox,
  cropWindow,
  DEFAULT_THRESHOLDS,
} from '../../../../scripts/ui-review/lib/classify.ts';

describe('classifyShot', () => {
  const both = { hasBase: true, hasHead: true, sameSize: true };

  it('new / removed / missing by which side exists', () => {
    expect(classifyShot({ hasBase: false, hasHead: true, sameSize: false, diffPixels: 0, totalPixels: 0 })).toBe('new');
    expect(classifyShot({ hasBase: true, hasHead: false, sameSize: false, diffPixels: 0, totalPixels: 0 })).toBe('removed');
    expect(classifyShot({ hasBase: false, hasHead: false, sameSize: false, diffPixels: 0, totalPixels: 0 })).toBe('missing');
  });

  it('ignores a handful of differing pixels (antialiasing/raster noise)', () => {
    expect(classifyShot({ ...both, diffPixels: 0, totalPixels: 1_296_000 })).toBe('unchanged');
    expect(classifyShot({ ...both, diffPixels: DEFAULT_THRESHOLDS.minPixels, totalPixels: 1_296_000 })).toBe('unchanged');
  });

  it('flags anything above the pixel floor, even a tiny share of a big page', () => {
    expect(classifyShot({ ...both, diffPixels: DEFAULT_THRESHOLDS.minPixels + 1, totalPixels: 1_296_000 })).toBe('changed');
  });

  it('respects custom thresholds', () => {
    expect(classifyShot({ ...both, diffPixels: 500, totalPixels: 1000 }, { minPixels: 600 })).toBe('unchanged');
  });

  it('a size change is always a change', () => {
    expect(classifyShot({ hasBase: true, hasHead: true, sameSize: false, diffPixels: 0, totalPixels: 100 })).toBe('changed');
  });
});

describe('summarizeStory', () => {
  it('rolls viewport statuses up to a story status', () => {
    expect(summarizeStory(['unchanged', 'changed', 'unchanged'])).toBe('changed');
    expect(summarizeStory(['new', 'new'])).toBe('new');
    expect(summarizeStory(['removed'])).toBe('removed');
    expect(summarizeStory(['unchanged', 'unchanged'])).toBe('unchanged');
    expect(summarizeStory(['missing', 'unchanged'])).toBe('error');
    expect(summarizeStory([])).toBe('error');
  });

  it('a stable change outranks an unstable one; unstable outranks unchanged', () => {
    expect(summarizeStory(['unstable', 'changed'])).toBe('changed');
    expect(summarizeStory(['unstable', 'unchanged'])).toBe('unstable');
  });
});

describe('confirmChange (stability re-check)', () => {
  it('keeps a change when both sides re-render identically', () => {
    expect(confirmChange('changed', { head: 0, base: 3 })).toBe('changed');
  });

  it('marks a change unstable when either side renders differently on a second capture', () => {
    expect(confirmChange('changed', { head: 0, base: 5000 })).toBe('unstable');
    expect(confirmChange('changed', { head: DEFAULT_THRESHOLDS.minPixels + 1, base: 0 })).toBe('unstable');
    expect(confirmChange('changed', { head: Number.POSITIVE_INFINITY })).toBe('unstable');
  });

  it('leaves unchecked changes and other statuses alone', () => {
    expect(confirmChange('changed', {})).toBe('changed');
    expect(confirmChange('unchanged', { head: 9999, base: 9999 })).toBe('unchanged');
    expect(confirmChange('new', { head: 9999 })).toBe('new');
  });
});

function mask(width: number, height: number, points: [number, number][]): Uint8Array {
  const m = new Uint8Array(width * height);
  for (const [x, y] of points) m[y * width + x] = 1;
  return m;
}

describe('diffBoxes', () => {
  it('returns nothing for an empty mask', () => {
    expect(diffBoxes(new Uint8Array(100 * 100), 100, 100)).toEqual([]);
  });

  it('clusters nearby pixels into one cell-aligned box and keeps distant clusters apart', () => {
    const m = mask(200, 200, [
      [10, 10],
      [20, 12],
      [150, 180],
    ]);
    const boxes = diffBoxes(m, 200, 200, { cell: 16 });
    expect(boxes).toEqual([
      { x: 0, y: 0, width: 32, height: 16 },
      { x: 144, y: 176, width: 16, height: 16 },
    ]);
  });

  it('clamps boxes to the image and merges into one union box above maxBoxes', () => {
    expect(diffBoxes(mask(390, 20, [[385, 18]]), 390, 20, { cell: 16 })).toEqual([{ x: 384, y: 16, width: 6, height: 4 }]);
    const points: [number, number][] = [];
    for (let i = 0; i < 10; i++) points.push([i * 40 + 1, 5]);
    const boxes = diffBoxes(mask(390, 20, points), 390, 20, { cell: 16, maxBoxes: 3 });
    expect(boxes).toEqual([{ x: 0, y: 0, width: 368, height: 16 }]);
  });
});

describe('unionBox / cropWindow', () => {
  it('unions boxes', () => {
    expect(unionBox([{ x: 10, y: 20, width: 5, height: 5 }, { x: 0, y: 40, width: 30, height: 10 }])).toEqual({ x: 0, y: 20, width: 30, height: 30 });
    expect(unionBox([])).toBeNull();
  });

  it('keeps short pages whole', () => {
    expect(cropWindow(900, [], 3000)).toEqual({ top: 0, height: 900 });
  });

  it('centers a tall page window on the changes and clamps to the page', () => {
    expect(cropWindow(10_000, [{ x: 0, y: 5000, width: 10, height: 100 }], 2000)).toEqual({ top: 4050, height: 2000 });
    expect(cropWindow(10_000, [{ x: 0, y: 9900, width: 10, height: 100 }], 2000)).toEqual({ top: 8000, height: 2000 });
    expect(cropWindow(10_000, [], 2000)).toEqual({ top: 0, height: 2000 });
  });
});
