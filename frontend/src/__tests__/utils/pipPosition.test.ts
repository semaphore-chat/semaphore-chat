import { describe, it, expect } from 'vitest';
import {
  DOCK_MARGIN,
  EDGE_PADDING,
  toAbsolute,
  fromAbsolute,
  clampSizeToViewport,
  dockZoneRects,
  hitTestDockZone,
  defaultPlacement,
  isValidPlacement,
  type PipPlacement,
  type Viewport,
} from '../../utils/pipPosition';

const vp: Viewport = { width: 1200, height: 800, bottomInset: 64 };
const size = { width: 480, height: 360 };

describe('pipPosition', () => {
  describe('defaultPlacement', () => {
    it('is docked bottom-right at the default card size, not collapsed', () => {
      expect(defaultPlacement()).toEqual({
        anchor: 'bottom-right',
        offset: { x: 0, y: 0 },
        size: { width: 480, height: 360 },
        docked: true,
        collapsed: false,
      });
    });
  });

  describe('toAbsolute — docked', () => {
    it('lands DOCK_MARGIN from each corner', () => {
      const cases: PipPlacement[] = (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map(
        (anchor) => ({ anchor, offset: { x: 0, y: 0 }, size, docked: true, collapsed: false })
      );
      const [tl, tr, bl, br] = cases.map((p) => toAbsolute(p, vp));

      expect(tl).toEqual({ x: DOCK_MARGIN, y: DOCK_MARGIN });
      expect(tr).toEqual({ x: vp.width - size.width - DOCK_MARGIN, y: DOCK_MARGIN });
      expect(bl).toEqual({ x: DOCK_MARGIN, y: vp.height - vp.bottomInset - size.height - DOCK_MARGIN });
      expect(br).toEqual({
        x: vp.width - size.width - DOCK_MARGIN,
        y: vp.height - vp.bottomInset - size.height - DOCK_MARGIN,
      });
    });

    it('ignores offset when docked', () => {
      const placement: PipPlacement = {
        anchor: 'top-left',
        offset: { x: 999, y: 999 },
        size,
        docked: true,
        collapsed: false,
      };
      expect(toAbsolute(placement, vp)).toEqual({ x: DOCK_MARGIN, y: DOCK_MARGIN });
    });

    it('sizeOverride repositions using the same anchor for a differently-sized card (pill)', () => {
      const placement: PipPlacement = {
        anchor: 'bottom-right',
        offset: { x: 0, y: 0 },
        size,
        docked: true,
        collapsed: false,
      };
      const pillSize = { width: 200, height: 52 };
      expect(toAbsolute(placement, vp, pillSize)).toEqual({
        x: vp.width - pillSize.width - DOCK_MARGIN,
        y: vp.height - vp.bottomInset - pillSize.height - DOCK_MARGIN,
      });
    });
  });

  describe('fromAbsolute / toAbsolute round trip (free placements)', () => {
    it('is an identity for a position well within bounds', () => {
      const pos = { x: 300, y: 200 };
      const { anchor, offset } = fromAbsolute(pos, size, vp);
      const placement: PipPlacement = { anchor, offset, size, docked: false, collapsed: false };
      expect(toAbsolute(placement, vp)).toEqual(pos);
    });

    it('round-trips for each quadrant', () => {
      // y values stay within the reachable free-placement range for this
      // card height (vp.height - bottomInset - size.height), so the
      // fromAbsolute offset is never negative-clamped — see the dedicated
      // clamping tests below for what happens past that range.
      const positions = [
        { x: 20, y: 20 }, // top-left-ish
        { x: 700, y: 20 }, // top-right-ish
        { x: 20, y: 360 }, // bottom-left-ish
        { x: 700, y: 360 }, // bottom-right-ish
      ];
      for (const pos of positions) {
        const { anchor, offset } = fromAbsolute(pos, size, vp);
        const placement: PipPlacement = { anchor, offset, size, docked: false, collapsed: false };
        expect(toAbsolute(placement, vp)).toEqual(pos);
      }
    });
  });

  describe('fromAbsolute — nearest corner selection', () => {
    it('picks top-left for a card centered in the top-left quadrant', () => {
      const pos = { x: 10, y: 10 };
      expect(fromAbsolute(pos, size, vp).anchor).toBe('top-left');
    });

    it('picks top-right for a card centered in the top-right quadrant', () => {
      const pos = { x: vp.width - size.width - 10, y: 10 };
      expect(fromAbsolute(pos, size, vp).anchor).toBe('top-right');
    });

    it('picks bottom-left for a card centered in the bottom-left quadrant (above bottomInset)', () => {
      const pos = { x: 10, y: vp.height - vp.bottomInset - size.height - 10 };
      expect(fromAbsolute(pos, size, vp).anchor).toBe('bottom-left');
    });

    it('picks bottom-right for a card centered in the bottom-right quadrant (above bottomInset)', () => {
      const pos = { x: vp.width - size.width - 10, y: vp.height - vp.bottomInset - size.height - 10 };
      expect(fromAbsolute(pos, size, vp).anchor).toBe('bottom-right');
    });

    it('offsets are non-negative and measured inward from the chosen corner', () => {
      const pos = { x: vp.width - size.width - 40, y: 40 };
      const { anchor, offset } = fromAbsolute(pos, size, vp);
      expect(anchor).toBe('top-right');
      expect(offset.x).toBeGreaterThanOrEqual(0);
      expect(offset.y).toBeGreaterThanOrEqual(0);
      expect(offset).toEqual({ x: 40, y: 40 });
    });
  });

  describe('fromAbsolute — bottomInset handling', () => {
    it('measures bottom offset above bottomInset, not the raw viewport edge', () => {
      const pos = { x: 20, y: vp.height - vp.bottomInset - size.height - 30 };
      const { anchor, offset } = fromAbsolute(pos, size, vp);
      expect(anchor).toBe('bottom-left');
      expect(offset.y).toBe(30);
    });

    it('toAbsolute reproduces the bottomInset-aware position for a bottom anchor', () => {
      const placement: PipPlacement = {
        anchor: 'bottom-right',
        offset: { x: 25, y: 15 },
        size,
        docked: false,
        collapsed: false,
      };
      const result = toAbsolute(placement, vp);
      expect(result).toEqual({
        x: vp.width - size.width - 25,
        y: vp.height - vp.bottomInset - size.height - 15,
      });
    });
  });

  describe('toAbsolute — clamping', () => {
    it('clamps a free placement whose offset would push it off the left/top edge', () => {
      const placement: PipPlacement = {
        anchor: 'top-left',
        offset: { x: -500, y: -500 },
        size,
        docked: false,
        collapsed: false,
      };
      expect(toAbsolute(placement, vp)).toEqual({ x: EDGE_PADDING, y: EDGE_PADDING });
    });

    it('clamps a free placement whose offset would push it off the right/bottom edge', () => {
      const placement: PipPlacement = {
        anchor: 'bottom-right',
        offset: { x: -500, y: -500 },
        size,
        docked: false,
        collapsed: false,
      };
      expect(toAbsolute(placement, vp)).toEqual({
        x: vp.width - size.width - EDGE_PADDING,
        y: vp.height - vp.bottomInset - size.height - EDGE_PADDING,
      });
    });

    it('clamps an oversized card so it never reports a negative max bound', () => {
      const hugeSize = { width: vp.width * 2, height: vp.height * 2 };
      const placement: PipPlacement = {
        anchor: 'top-left',
        offset: { x: 0, y: 0 },
        size: hugeSize,
        docked: false,
        collapsed: false,
      };
      const result = toAbsolute(placement, vp);
      expect(result.x).toBe(EDGE_PADDING);
      expect(result.y).toBe(EDGE_PADDING);
    });
  });

  describe('clampSizeToViewport', () => {
    it('enforces the 320x240 minimum', () => {
      expect(clampSizeToViewport({ width: 10, height: 10 }, vp)).toEqual({ width: 320, height: 240 });
    });

    it('shrinks a size that overflows the viewport', () => {
      const result = clampSizeToViewport({ width: 5000, height: 5000 }, vp);
      expect(result.width).toBeLessThanOrEqual(vp.width);
      expect(result.height).toBeLessThanOrEqual(vp.height - vp.bottomInset);
    });

    it('leaves an in-range size untouched', () => {
      expect(clampSizeToViewport({ width: 480, height: 360 }, vp)).toEqual({ width: 480, height: 360 });
    });
  });

  describe('dockZoneRects', () => {
    it('produces four ~160x140 rects inset by DOCK_MARGIN, bottom ones above bottomInset', () => {
      const rects = dockZoneRects(vp);
      expect(rects).toHaveLength(4);
      const anchors = rects.map((r) => r.anchor).sort();
      expect(anchors).toEqual(['bottom-left', 'bottom-right', 'top-left', 'top-right']);

      for (const rect of rects) {
        expect(rect.width).toBe(160);
        expect(rect.height).toBe(140);
      }

      const topLeft = rects.find((r) => r.anchor === 'top-left')!;
      expect(topLeft.x).toBe(DOCK_MARGIN);
      expect(topLeft.y).toBe(DOCK_MARGIN);

      const bottomRight = rects.find((r) => r.anchor === 'bottom-right')!;
      expect(bottomRight.x).toBe(vp.width - DOCK_MARGIN - 160);
      expect(bottomRight.y).toBe(vp.height - vp.bottomInset - DOCK_MARGIN - 140);
    });
  });

  describe('hitTestDockZone', () => {
    it('returns the anchor when the point is inside a zone', () => {
      const rects = dockZoneRects(vp);
      const topLeft = rects.find((r) => r.anchor === 'top-left')!;
      const pt = { x: topLeft.x + 5, y: topLeft.y + 5 };
      expect(hitTestDockZone(pt, vp)).toBe('top-left');
    });

    it('returns null when the point is outside every zone', () => {
      const center = { x: vp.width / 2, y: vp.height / 2 };
      expect(hitTestDockZone(center, vp)).toBeNull();
    });
  });

  describe('isValidPlacement', () => {
    const validPlacement: PipPlacement = {
      anchor: 'top-left',
      offset: { x: 10, y: 20 },
      size,
      docked: false,
      collapsed: false,
    };

    it('accepts a well-formed placement', () => {
      expect(isValidPlacement(validPlacement)).toBe(true);
    });

    it.each(['offset', 'size'] as const)(
      'rejects NaN in %s (typeof NaN === "number", so a plain typeof check would wrongly pass)',
      (field) => {
        const key = field === 'offset' ? 'x' : 'width';
        const corrupted = { ...validPlacement, [field]: { ...validPlacement[field], [key]: NaN } };
        expect(isValidPlacement(corrupted)).toBe(false);
      }
    );

    it.each(['offset', 'size'] as const)('rejects Infinity in %s', (field) => {
      const key = field === 'offset' ? 'y' : 'height';
      const corrupted = { ...validPlacement, [field]: { ...validPlacement[field], [key]: Infinity } };
      expect(isValidPlacement(corrupted)).toBe(false);
    });

    it('rejects a null/undefined/primitive value', () => {
      expect(isValidPlacement(null)).toBe(false);
      expect(isValidPlacement(undefined)).toBe(false);
      expect(isValidPlacement('bottom-right')).toBe(false);
      expect(isValidPlacement(42)).toBe(false);
    });

    it('rejects an unknown anchor', () => {
      expect(isValidPlacement({ ...validPlacement, anchor: 'middle' })).toBe(false);
    });

    it('rejects a placement missing docked/collapsed', () => {
      const { docked: _docked, ...withoutDocked } = validPlacement;
      expect(isValidPlacement(withoutDocked)).toBe(false);
    });
  });
});
