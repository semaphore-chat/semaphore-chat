import { describe, it, expect } from 'vitest';
import {
  DOCK_MARGIN,
  EDGE_PADDING,
  REGION_BOTTOM_LANE,
  defaultPlacement,
  defaultRegionPlacement,
  dockZoneRects,
  fromAbsolute,
  hitTestDockZone,
  regionFitsCard,
  regionViewport,
  toAbsolute,
  viewportBucket,
  type PipPlacement,
  type Viewport,
} from '../../utils/pipPosition';

/**
 * Message-column docking (P15). The window-based behaviour (origin 0,0) is
 * covered unchanged by pipPosition.test.ts; these cover the region origin.
 */
// 1280 window: rail + channel sidebar on the left, member list on the right,
// composer at the bottom → the message column above the composer.
const region = { left: 352, top: 56, width: 688, height: 560 };
const vp = regionViewport(region);

describe('regionViewport', () => {
  it('maps the column to a Viewport with the FAB/typing lane kept free', () => {
    expect(vp).toEqual({ left: 352, top: 56, width: 688, height: 560, bottomInset: REGION_BOTTOM_LANE });
  });
});

describe('toAbsolute inside a region', () => {
  const size = { width: 400, height: 300 };

  it('docks bottom-right inside the column, above the lane, never past its right edge', () => {
    const placement: PipPlacement = { ...defaultPlacement(), size };
    const pos = toAbsolute(placement, vp);
    expect(pos.x).toBe(region.left + region.width - size.width - DOCK_MARGIN);
    expect(pos.y).toBe(region.top + region.height - REGION_BOTTOM_LANE - size.height - DOCK_MARGIN);
    // The card's bottom stays above the composer (the region's bottom)
    expect(pos.y + size.height).toBeLessThanOrEqual(region.top + region.height);
    // ...and its right edge left of the member list (the region's right)
    expect(pos.x + size.width).toBeLessThanOrEqual(region.left + region.width);
  });

  it('docks top-left at the column origin plus the margin', () => {
    const placement: PipPlacement = { ...defaultPlacement(), size, anchor: 'top-left' };
    expect(toAbsolute(placement, vp)).toEqual({ x: region.left + DOCK_MARGIN, y: region.top + DOCK_MARGIN });
  });

  it('clamps a free placement that would cover the composer or the member list', () => {
    const placement: PipPlacement = { ...defaultPlacement(), size, docked: false, anchor: 'top-left', offset: { x: 5000, y: 5000 } };
    const pos = toAbsolute(placement, vp);
    expect(pos.x).toBe(region.left + region.width - size.width - EDGE_PADDING);
    expect(pos.y).toBe(region.top + region.height - REGION_BOTTOM_LANE - size.height - EDGE_PADDING);
  });

  it('round-trips a free position through fromAbsolute', () => {
    const abs = { x: region.left + 100, y: region.top + 80 };
    const { anchor, offset } = fromAbsolute(abs, size, vp);
    const placement: PipPlacement = { ...defaultPlacement(), size, docked: false, anchor, offset };
    expect(toAbsolute(placement, vp)).toEqual(abs);
  });

  it('places the dock zones in the column corners and hit-tests them', () => {
    const zones = dockZoneRects(vp);
    const br = zones.find((z) => z.anchor === 'bottom-right')!;
    expect(br.x + br.width).toBe(region.left + region.width - DOCK_MARGIN);
    expect(br.y + br.height).toBe(region.top + region.height - REGION_BOTTOM_LANE - DOCK_MARGIN);
    expect(hitTestDockZone({ x: br.x + 10, y: br.y + 10 }, vp)).toBe('bottom-right');
    // A point over the member list (right of the column) is no dock zone
    expect(hitTestDockZone({ x: region.left + region.width + 50, y: br.y + 10 }, vp)).toBeNull();
  });

  it('leaves window-based geometry unchanged when no origin is given', () => {
    const windowVp: Viewport = { width: 1280, height: 800, bottomInset: 64 };
    const withZeroOrigin: Viewport = { ...windowVp, left: 0, top: 0 };
    const placement: PipPlacement = { ...defaultPlacement(), size };
    expect(toAbsolute(placement, windowVp)).toEqual(toAbsolute(placement, withZeroOrigin));
  });
});

describe('defaultRegionPlacement', () => {
  it('sizes the card to 45% of the column, 4:3, between 320 and 480 wide', () => {
    expect(defaultRegionPlacement(region).size).toEqual({ width: 320, height: 240 });
    expect(defaultRegionPlacement({ ...region, width: 2000 }).size).toEqual({ width: 480, height: 360 });
    expect(defaultRegionPlacement({ ...region, width: 900 }).size).toEqual({ width: 405, height: 304 });
  });

  it('is docked bottom-right', () => {
    const p = defaultRegionPlacement(region);
    expect(p.anchor).toBe('bottom-right');
    expect(p.docked).toBe(true);
  });
});

describe('regionFitsCard', () => {
  it('needs room for the smallest card plus margins and the lane', () => {
    expect(regionFitsCard(region)).toBe(true);
    expect(regionFitsCard({ ...region, width: 340 })).toBe(false);
    expect(regionFitsCard({ ...region, height: 300 })).toBe(false);
  });
});

describe('viewportBucket', () => {
  it.each([
    [1024, 'lt1280'],
    [1279, 'lt1280'],
    [1280, '1280'],
    [1599, '1280'],
    [1600, '1600'],
    [1920, '1920'],
    [2559, '1920'],
    [2560, '2560'],
    [3840, '2560'],
  ])('%i → %s', (width, bucket) => {
    expect(viewportBucket(width)).toBe(bucket);
  });
});
