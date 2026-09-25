// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { compositeLayout, compositeHtml, focusRegions, COMPOSITE_MAX_WIDTH, type CompositeInput } from '../../../../scripts/ui-review/lib/layout.ts';

const img = (width: number, height: number, src = 'x.png') => ({ src, width, height });

function input(overrides: Partial<CompositeInput>): CompositeInput {
  return {
    storyId: 'story--id',
    viewport: 'phone',
    status: 'changed',
    before: img(390, 844, 'before.png'),
    after: img(390, 844, 'after.png'),
    diff: img(390, 844, 'diff.png'),
    boxes: [{ x: 16, y: 400, width: 64, height: 32 }],
    labels: { before: 'before · base aaaaaaa', after: 'after · head bbbbbbb' },
    diffPercent: 0.4,
    ...overrides,
  };
}

const desktop = (overrides: Partial<CompositeInput>) =>
  input({ viewport: 'desktop', before: img(1440, 900), after: img(1440, 900), diff: img(1440, 900), ...overrides });
const tablet = (overrides: Partial<CompositeInput>) =>
  input({ viewport: 'tablet', before: img(820, 1180), after: img(820, 1180), diff: img(820, 1180), ...overrides });

describe('focusRegions', () => {
  it('pads a change, grows a tiny one to a minimum size and clamps to the page', () => {
    const [r] = focusRegions([{ x: 0, y: 0, width: 16, height: 16 }], 1440, 900);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBeGreaterThanOrEqual(260);
    expect(r.height).toBeGreaterThanOrEqual(96);
    const [wide] = focusRegions([{ x: 100, y: 800, width: 1300, height: 80 }], 1440, 900);
    expect(wide.x).toBe(76);
    expect(wide.x + wide.width).toBe(1424);
    expect(wide.y + wide.height).toBe(900);
  });

  it('merges changes that are close together, keeps distant ones apart', () => {
    const regions = focusRegions(
      [
        { x: 100, y: 100, width: 40, height: 16 },
        { x: 150, y: 110, width: 40, height: 16 },
        { x: 1000, y: 700, width: 40, height: 16 },
      ],
      1440,
      900,
    );
    expect(regions).toHaveLength(2);
    expect(regions[0].y).toBeLessThan(regions[1].y);
  });
});

describe('compositeLayout', () => {
  it('never exceeds the width GitHub shows (860 px)', () => {
    for (const layout of [
      compositeLayout(input({})),
      compositeLayout(tablet({ boxes: [{ x: 300, y: 500, width: 80, height: 32 }] })),
      compositeLayout(desktop({ boxes: [{ x: 600, y: 300, width: 80, height: 32 }] })),
      compositeLayout(desktop({ boxes: [{ x: 0, y: 0, width: 1440, height: 900 }] })),
      compositeLayout(desktop({ status: 'new', before: undefined, diff: undefined, boxes: [] })),
    ]) {
      expect(layout.width).toBeLessThanOrEqual(COMPOSITE_MAX_WIDTH);
    }
  });

  it('phone: before | after side by side at 1:1, plus a before | after | diff crop of a small change', () => {
    const layout = compositeLayout(input({}));
    expect(layout.full.direction).toBe('row');
    expect(layout.full.scale).toBe(1);
    expect(layout.full.panels.map((p) => p.kind)).toEqual(['before', 'after']);
    expect(layout.focus).toHaveLength(1);
    expect(layout.focus[0].scale).toBe(1);
    expect(layout.focus[0].panels.map((p) => p.kind)).toEqual(['before', 'after', 'diff']);
  });

  it('phone: no crop when it would only repeat the 1:1 full view (a change too wide for the diff panel)', () => {
    const layout = compositeLayout(input({ boxes: [{ x: 0, y: 700, width: 390, height: 60 }] }));
    expect(layout.focus).toEqual([]);
    expect(layout.full.scale).toBe(1);
  });

  it('desktop, small change: a 1:1 crop with the diff, and a small side-by-side full view', () => {
    const layout = compositeLayout(desktop({ boxes: [{ x: 600, y: 300, width: 80, height: 32 }] }));
    expect(layout.focus).toHaveLength(1);
    const [f] = layout.focus;
    expect(f.scale).toBe(1);
    expect(f.direction).toBe('row');
    expect(f.panels.map((p) => p.kind)).toEqual(['before', 'after', 'diff']);
    // padded around the change, inside the page
    expect(f.region.x).toBeLessThanOrEqual(600);
    expect(f.region.x + f.region.width).toBeGreaterThanOrEqual(680);
    expect(f.region.x + f.region.width).toBeLessThanOrEqual(1440);
    expect(layout.full.direction).toBe('row');
    expect(layout.full.scale).toBeLessThan(0.5);
  });

  it('desktop, wide change (a composer row): before above after at ~1:1', () => {
    const layout = compositeLayout(desktop({ boxes: [{ x: 216, y: 520, width: 800, height: 32 }] }));
    expect(layout.focus).toHaveLength(1);
    expect(layout.focus[0].direction).toBe('column');
    expect(layout.focus[0].panels.map((p) => p.kind)).toEqual(['before', 'after']);
    expect(layout.focus[0].scale).toBeGreaterThan(0.95);
  });

  it('a change too big to crop: before above after at the full width, no crops', () => {
    const layout = compositeLayout(desktop({ boxes: [{ x: 0, y: 0, width: 1440, height: 900 }] }));
    expect(layout.focus).toEqual([]);
    expect(layout.full.direction).toBe('column');
    expect(layout.full.scale).toBeGreaterThan(0.55);
    const tall = compositeLayout(tablet({ boxes: [{ x: 280, y: 120, width: 540, height: 1000 }] }));
    expect(tall.focus).toEqual([]);
    expect(tall.full.direction).toBe('column');
    expect(tall.full.scale).toBe(1);
  });

  it('crops at most three regions, the biggest, and outlines the rest in the full view', () => {
    const boxes = [
      { x: 20, y: 20, width: 32, height: 16 },
      { x: 700, y: 20, width: 64, height: 32 },
      { x: 20, y: 500, width: 96, height: 48 },
      { x: 700, y: 500, width: 128, height: 64 },
      { x: 1200, y: 850, width: 16, height: 16 },
    ];
    const layout = compositeLayout(desktop({ boxes }));
    expect(layout.regions).toHaveLength(5);
    expect(layout.focus).toHaveLength(3);
    const html = compositeHtml(desktop({ boxes }));
    expect(html).toContain('2 more changed regions outlined below');
  });

  it('unstable shots are laid out like changes', () => {
    expect(compositeLayout(input({ status: 'unstable' })).focus[0].panels.map((p) => p.kind)).toEqual(['before', 'after', 'diff']);
    expect(compositeLayout(desktop({ status: 'unstable', boxes: [{ x: 600, y: 300, width: 80, height: 32 }] })).focus).toHaveLength(1);
    expect(compositeHtml(input({ status: 'unstable' }))).toContain('unstable');
  });

  it('new / removed stories get their single side, as large as fits', () => {
    const added = compositeLayout(input({ status: 'new', before: undefined, diff: undefined, boxes: [] }));
    expect(added.full.panels.map((p) => p.kind)).toEqual(['after']);
    expect(added.focus).toEqual([]);
    expect(added.full.scale).toBe(1);
    const removed = compositeLayout(desktop({ status: 'removed', after: undefined, diff: undefined, boxes: [] }));
    expect(removed.full.panels.map((p) => p.kind)).toEqual(['before']);
    expect(removed.full.scale).toBeCloseTo(836 / 1440, 2);
  });

  it('crops very tall full-page shots around the change', () => {
    const layout = compositeLayout(input({ before: img(390, 6000), after: img(390, 6200), diff: img(390, 6200), boxes: [{ x: 0, y: 5000, width: 390, height: 40 }] }));
    expect(layout.full.crop.height).toBeLessThan(6200);
    expect(layout.full.crop.top).toBeGreaterThan(3000);
    expect(layout.full.crop.top + layout.full.crop.height).toBeLessThanOrEqual(6200);
  });
});

describe('compositeHtml', () => {
  it('renders labels, images and escaped text', () => {
    const html = compositeHtml(input({ storyId: 'a--b<script>' }));
    expect(html).toContain('before · base aaaaaaa');
    expect(html).toContain('after · head bbbbbbb');
    expect(html).toContain('src="before.png"');
    expect(html).toContain('src="after.png"');
    expect(html).toContain('src="diff.png"');
    expect(html).toContain('a--b&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('id="composite"');
    expect(html).toContain(`max-width: ${COMPOSITE_MAX_WIDTH}px`);
  });

  it('does not outline a region covering most of the page, and says why', () => {
    const html = compositeHtml(tablet({ boxes: [{ x: 0, y: 100, width: 820, height: 1000 }] }));
    expect(html).not.toContain('class="box"');
    expect(html).toContain('most of the page changed');
    expect(compositeHtml(desktop({ boxes: [{ x: 600, y: 300, width: 80, height: 32 }] }))).toContain('class="box"');
  });

  it('labels the crops and the full view', () => {
    const html = compositeHtml(desktop({ boxes: [{ x: 600, y: 300, width: 80, height: 32 }] }));
    expect(html).toContain('Changed region · 100%');
    expect(html).toMatch(/Full view · \d+%/);
  });
});
