// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { compositeLayout, compositeHtml, type CompositeInput } from '../../../../scripts/ui-review/lib/layout.ts';

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

describe('compositeLayout', () => {
  it('phone: before | after | diff at 1:1, no zoom row needed', () => {
    const layout = compositeLayout(input({}));
    expect(layout.panels.map((p) => p.kind)).toEqual(['before', 'after', 'diff']);
    expect(layout.scale).toBe(1);
    expect(layout.width).toBeLessThanOrEqual(1600);
    expect(layout.zoom).toBeNull();
  });

  it('desktop: two panels scaled to fit 1600px, plus a 1:1 zoom on a small change', () => {
    const layout = compositeLayout(
      input({ viewport: 'desktop', before: img(1440, 900), after: img(1440, 900), diff: img(1440, 900), boxes: [{ x: 600, y: 300, width: 80, height: 32 }] }),
    );
    expect(layout.panels.map((p) => p.kind)).toEqual(['before', 'after']);
    expect(layout.scale).toBeLessThan(0.6);
    expect(layout.width).toBeLessThanOrEqual(1600);
    expect(layout.zoom).not.toBeNull();
    expect(layout.zoom!.scale).toBe(1);
    // padded around the change, never outside the page
    expect(layout.zoom!.region.x).toBeLessThanOrEqual(600);
    expect(layout.zoom!.region.x + layout.zoom!.region.width).toBeGreaterThanOrEqual(680);
    expect(layout.zoom!.region.x + layout.zoom!.region.width).toBeLessThanOrEqual(1440);
  });

  it('skips the zoom row when the change covers most of the page', () => {
    const layout = compositeLayout(
      input({ viewport: 'desktop', before: img(1440, 900), after: img(1440, 900), boxes: [{ x: 0, y: 0, width: 1440, height: 900 }] }),
    );
    expect(layout.zoom).toBeNull();
  });

  it('unstable shots are laid out like changes (before | after | diff, zoom)', () => {
    expect(compositeLayout(input({ status: 'unstable' })).panels.map((p) => p.kind)).toEqual(['before', 'after', 'diff']);
    const desktop = compositeLayout(
      input({ status: 'unstable', viewport: 'desktop', before: img(1440, 900), after: img(1440, 900), boxes: [{ x: 600, y: 300, width: 80, height: 32 }] }),
    );
    expect(desktop.zoom).not.toBeNull();
    expect(compositeHtml(input({ status: 'unstable' }))).toContain('unstable');
  });

  it('new / removed stories get a single panel', () => {
    expect(compositeLayout(input({ status: 'new', before: undefined, diff: undefined, boxes: [] })).panels.map((p) => p.kind)).toEqual(['after']);
    expect(compositeLayout(input({ status: 'removed', after: undefined, diff: undefined, boxes: [] })).panels.map((p) => p.kind)).toEqual(['before']);
  });

  it('crops very tall full-page shots around the change', () => {
    const layout = compositeLayout(input({ before: img(390, 6000), after: img(390, 6200), diff: img(390, 6200), boxes: [{ x: 0, y: 5000, width: 390, height: 40 }] }));
    expect(layout.crop.height).toBeLessThan(6200);
    expect(layout.crop.top).toBeGreaterThan(3000);
    expect(layout.crop.top + layout.crop.height).toBeLessThanOrEqual(6200);
  });
});

describe('compositeHtml', () => {
  it('renders labels, images and escaped text', () => {
    const html = compositeHtml(input({ storyId: 'a--b<script>' }));
    expect(html).toContain('before · base aaaaaaa');
    expect(html).toContain('after · head bbbbbbb');
    expect(html).toContain('src="before.png"');
    expect(html).toContain('src="after.png"');
    expect(html).toContain('a--b&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('id="composite"');
  });
});
