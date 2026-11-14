import { describe, expect, it } from 'vitest';
import { mix } from '../../kit/theme/mix';

describe('mix', () => {
  it('blends over into under on the 8-bit channels, rounded to nearest', () => {
    expect(mix('#f2f2f5', '#26262c', 0.04)).toBe('#2e2e34');
    expect(mix('#F2F2F5', '#8E75FF', 0.16)).toBe('#9e89fd');
  });

  it('returns the under colour at alpha 0 and the over colour at alpha 1', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#ffffff');
    // alpha is clamped to 0..1, so 2 paints the over colour
    expect(mix('#000000', '#ffffff', 2)).toBe('#000000');
  });

  it('only accepts #rrggbb', () => {
    for (const colour of ['red', '#fff', '#26262cff', 'rgb(0, 0, 0)', '']) {
      expect(() => mix(colour, '#ffffff', 0.5)).toThrow(RangeError);
    }
    expect(() => mix('#ffffff', '#fff', 0.5)).toThrow(RangeError);
  });
});
