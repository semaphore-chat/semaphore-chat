// @vitest-environment node
import { describe, it, expect } from 'vitest';
import pixelmatch from 'pixelmatch';
import {
  classifyShot,
  confirmChange,
  summarizeStory,
  diffBoxes,
  growBoxes,
  pixelsInBoxes,
  unionBox,
  cropWindow,
  DEFAULT_PIXEL_THRESHOLD,
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
  // Each number: base-vs-head differing pixels inside the first diff's region on one re-capture.
  it('keeps a change that reproduces in its region on every re-capture', () => {
    expect(confirmChange('changed', [89, 89])).toBe('changed');
  });

  it('keeps a real change even when a re-capture also differs elsewhere (a list scrolled differently)', () => {
    // Regression: a 1px chip border change (89 px, same box in every pass) was
    // "unstable" because one pass-2 capture scrolled differently (~200k px of
    // drift) — drift anywhere used to veto the change.
    expect(confirmChange('changed', [89, 200_000])).toBe('changed');
    // ...and when both sides dropped the same banner on the last pass, the 50 px change still showed.
    expect(confirmChange('changed', [50, 50])).toBe('changed');
  });

  it('marks a change unstable when a re-capture no longer shows it', () => {
    // A menu opened while media was sizing: same diff twice, gone on the third capture.
    expect(confirmChange('changed', [61_080, 0])).toBe('unstable');
    // The base's first capture was a half-loaded "Loading..." page.
    expect(confirmChange('changed', [0])).toBe('unstable');
    expect(confirmChange('changed', [DEFAULT_THRESHOLDS.minPixels])).toBe('unstable');
  });

  it('leaves unchecked changes and other statuses alone', () => {
    expect(confirmChange('changed', [])).toBe('changed');
    expect(confirmChange('unchanged', [0])).toBe('unchanged');
    expect(confirmChange('new', [0])).toBe('new');
  });
});

describe('re-check regions', () => {
  it('grows boxes by a margin, clamped to the image', () => {
    expect(growBoxes([{ x: 5, y: 90, width: 10, height: 8 }], 16, 100, 100)).toEqual([{ x: 0, y: 74, width: 31, height: 26 }]);
  });

  it('counts only the differing pixels inside the boxes, each once', () => {
    const m = new Uint8Array(20 * 10);
    for (const [x, y] of [[1, 1], [2, 2], [15, 8], [18, 1]]) m[y * 20 + x] = 1;
    const boxes = [{ x: 0, y: 0, width: 5, height: 5 }, { x: 1, y: 1, width: 3, height: 3 }, { x: 14, y: 7, width: 3, height: 3 }];
    expect(pixelsInBoxes(m, 20, 10, boxes)).toBe(3);
    expect(pixelsInBoxes(m, 20, 10, [])).toBe(0);
  });
});

describe('default pixel threshold', () => {
  /** 20×20 grey page with a 1px horizontal line at y=10 in `line` grey. */
  const page = (line: number) => {
    const data = new Uint8Array(20 * 20 * 4);
    for (let p = 0; p < 400; p++) {
      const v = Math.floor(p / 20) === 10 ? line : 30;
      data.set([v, v, v, 255], p * 4);
    }
    return data;
  };
  const differing = (a: number, b: number, threshold: number) => pixelmatch(page(a), page(b), undefined, 20, 20, { threshold, includeAA: false });

  it('sees a subtle 1px border colour change that 0.1 misses', () => {
    // Regression: divider rgba(255,255,255,.12) -> alpha(text.primary,.2) over #121212 is grey 64 -> 81.
    expect(differing(64, 81, 0.1)).toBe(0);
    expect(differing(64, 81, DEFAULT_PIXEL_THRESHOLD)).toBe(20);
  });

  it('still ignores identical renders and near-invisible steps', () => {
    expect(differing(64, 64, DEFAULT_PIXEL_THRESHOLD)).toBe(0);
    expect(differing(64, 68, DEFAULT_PIXEL_THRESHOLD)).toBe(0);
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
