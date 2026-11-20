import { describe, expect, it } from 'vitest';
import { iconNames, iconNodes } from '../../kit/icons/generated';

// The generator writes only these shape elements (design/gen/gen_icons.py); a new
// one has to be added to the renderer deliberately, never appear here by accident.
const SHAPES = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'];

describe('generated icon nodes', () => {
  it('lists every icon once, in the node map order', () => {
    expect(new Set(iconNames).size).toBe(iconNames.length);
    expect([...iconNames]).toEqual(Object.keys(iconNodes));
    expect(iconNames).toContain('Mic');
    expect(iconNames).toContain('TriangleAlert');
  });

  it('draws every icon with shape elements only', () => {
    for (const name of iconNames) {
      const nodes = iconNodes[name];
      expect(nodes.length).toBeGreaterThan(0);
      for (const [tag] of nodes) {
        expect(SHAPES).toContain(tag);
      }
    }
  });
});
