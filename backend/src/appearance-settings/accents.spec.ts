import {
  ACCENT_NAMES,
  ACCENT_PRIMARY,
  nearestAccent,
} from '@semaphore-chat/shared';

// The backend keeps `accentColor` equal to `nearestAccent(baseColor)`, so
// these vectors are the guarantee that every existing user keeps their accent
// when the server derives it from their base colour.
describe('nearestAccent', () => {
  it('maps every accent primary to itself', () => {
    for (const name of ACCENT_NAMES) {
      expect(nearestAccent(ACCENT_PRIMARY[name])).toBe(name);
    }
  });

  it('maps a colour without a meaningful chroma to slate', () => {
    for (const grey of ['#808080', '#eeeeee', '#111111']) {
      expect(nearestAccent(grey)).toBe('slate');
    }
  });

  it('maps the Lounge violet to purple', () => {
    expect(nearestAccent('#8e75ff')).toBe('purple');
  });

  it('accepts uppercase input', () => {
    expect(nearestAccent('#8E75FF')).toBe('purple');
  });

  it('throws RangeError for anything but #rrggbb', () => {
    for (const invalid of ['', 'purple', '#8e75f', '#8e75fff', '#gggggg']) {
      expect(() => nearestAccent(invalid)).toThrow(RangeError);
    }
  });
});
