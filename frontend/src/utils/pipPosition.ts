/**
 * Pure geometry for the Float card / pill ("Stage, Float, Dock" — the Dock
 * piece). Anchor-relative placement so saved positions survive viewport
 * resizes: a placement is stored as a corner anchor plus an inward offset
 * (or, when docked, just the anchor — offset is ignored and the card sits a
 * fixed DOCK_MARGIN from the corner). All functions here are side-effect
 * free; FloatCard.tsx owns state, persistence, and pointer-event wiring.
 */

export type PipAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The area the card lives in. Normally the window (origin 0,0; bottomInset is
 * the bottom chrome — VOICE_BAR_HEIGHT when connected to voice, else 0). On
 * desktop text views it's the message column above the composer instead
 * (see `regionViewport`), with `left`/`top` its offset in the window.
 */
export interface Viewport {
  width: number;
  height: number;
  bottomInset: number;
  /** Window x of the area's left edge (default 0). */
  left?: number;
  /** Window y of the area's top edge (default 0). */
  top?: number;
}

export interface PipPlacement {
  anchor: PipAnchor;
  offset: Point;
  size: Size;
  docked: boolean;
  collapsed: boolean;
}

export interface DockZoneRect {
  anchor: PipAnchor;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DOCK_MARGIN = 16;
export const EDGE_PADDING = 8;

const ANCHORS: readonly PipAnchor[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Type guard for a persisted PipPlacement (e.g. from localStorage). Uses
 * Number.isFinite rather than typeof === 'number' — `typeof NaN` and
 * `typeof Infinity` are both 'number', so a corrupted record with those
 * values would otherwise pass and render the card off-screen with no way
 * to recover it.
 */
export function isValidPlacement(value: unknown): value is PipPlacement {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const offset = p.offset as Record<string, unknown> | undefined;
  const size = p.size as Record<string, unknown> | undefined;
  return (
    typeof p.anchor === 'string' && (ANCHORS as string[]).includes(p.anchor) &&
    !!offset && isFiniteNumber(offset.x) && isFiniteNumber(offset.y) &&
    !!size && isFiniteNumber(size.width) && isFiniteNumber(size.height) &&
    typeof p.docked === 'boolean' &&
    typeof p.collapsed === 'boolean'
  );
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 360;
const DOCK_ZONE_WIDTH = 160;
const DOCK_ZONE_HEIGHT = 140;

const splitAnchor = (anchor: PipAnchor): [vSide: 'top' | 'bottom', hSide: 'left' | 'right'] => {
  const [vSide, hSide] = anchor.split('-');
  return [vSide as 'top' | 'bottom', hSide as 'left' | 'right'];
};

const originOf = (vp: Viewport): Point => ({ x: vp.left ?? 0, y: vp.top ?? 0 });

const clampPosition = (pos: Point, size: Size, vp: Viewport): Point => {
  const o = originOf(vp);
  const minX = o.x + EDGE_PADDING;
  const minY = o.y + EDGE_PADDING;
  const maxX = Math.max(minX, o.x + vp.width - size.width - EDGE_PADDING);
  const maxY = Math.max(minY, o.y + vp.height - vp.bottomInset - size.height - EDGE_PADDING);
  return {
    x: Math.min(Math.max(pos.x, minX), maxX),
    y: Math.min(Math.max(pos.y, minY), maxY),
  };
};

/**
 * Docked → DOCK_MARGIN from the anchor corner (bottom corners sit above
 * bottomInset). Free → anchor corner + inward offset. Either way, always
 * clamped so the card stays within EDGE_PADDING of the viewport bounds.
 * `sizeOverride` lets the pill reuse the card's anchor/offset with its own
 * (smaller) intrinsic size.
 */
export const toAbsolute = (placement: PipPlacement, vp: Viewport, sizeOverride?: Size): Point => {
  const size = sizeOverride ?? placement.size;
  const [vSide, hSide] = splitAnchor(placement.anchor);
  const o = originOf(vp);

  let x: number;
  let y: number;

  if (placement.docked) {
    x = hSide === 'left' ? DOCK_MARGIN : vp.width - size.width - DOCK_MARGIN;
    y = vSide === 'top' ? DOCK_MARGIN : vp.height - vp.bottomInset - size.height - DOCK_MARGIN;
  } else {
    x = hSide === 'left' ? placement.offset.x : vp.width - size.width - placement.offset.x;
    y = vSide === 'top' ? placement.offset.y : vp.height - vp.bottomInset - size.height - placement.offset.y;
  }

  return clampPosition({ x: o.x + x, y: o.y + y }, size, vp);
};

/**
 * Nearest corner by card center. Offsets are measured inward from that
 * corner and are always non-negative, so a free placement survives a
 * viewport resize without drifting off-screen.
 */
export const fromAbsolute = (absPos: Point, size: Size, vp: Viewport): { anchor: PipAnchor; offset: Point } => {
  const o = originOf(vp);
  const pos = { x: absPos.x - o.x, y: absPos.y - o.y };
  const centerX = pos.x + size.width / 2;
  const centerY = pos.y + size.height / 2;
  const usableHeight = vp.height - vp.bottomInset;

  const hSide: 'left' | 'right' = centerX < vp.width / 2 ? 'left' : 'right';
  const vSide: 'top' | 'bottom' = centerY < usableHeight / 2 ? 'top' : 'bottom';
  const anchor = `${vSide}-${hSide}` as PipAnchor;

  const offsetX = hSide === 'left' ? pos.x : vp.width - pos.x - size.width;
  const offsetY = vSide === 'top' ? pos.y : vp.height - vp.bottomInset - pos.y - size.height;

  return {
    anchor,
    offset: { x: Math.max(0, offsetX), y: Math.max(0, offsetY) },
  };
};

/** Clamps a card size to the MIN 320x240 floor and the padded viewport ceiling. */
export const clampSizeToViewport = (size: Size, vp: Viewport): Size => {
  const maxWidth = Math.max(MIN_WIDTH, vp.width - EDGE_PADDING * 2);
  const maxHeight = Math.max(MIN_HEIGHT, vp.height - vp.bottomInset - EDGE_PADDING * 2);
  return {
    width: Math.max(MIN_WIDTH, Math.min(size.width, maxWidth)),
    height: Math.max(MIN_HEIGHT, Math.min(size.height, maxHeight)),
  };
};

/** Four ~160x140 corner rects inset by DOCK_MARGIN (bottom ones above bottomInset). */
export const dockZoneRects = (vp: Viewport): DockZoneRect[] => {
  const o = originOf(vp);
  const left = o.x + DOCK_MARGIN;
  const right = o.x + vp.width - DOCK_MARGIN - DOCK_ZONE_WIDTH;
  const top = o.y + DOCK_MARGIN;
  const bottom = o.y + vp.height - vp.bottomInset - DOCK_MARGIN - DOCK_ZONE_HEIGHT;

  return [
    { anchor: 'top-left', x: left, y: top, width: DOCK_ZONE_WIDTH, height: DOCK_ZONE_HEIGHT },
    { anchor: 'top-right', x: right, y: top, width: DOCK_ZONE_WIDTH, height: DOCK_ZONE_HEIGHT },
    { anchor: 'bottom-left', x: left, y: bottom, width: DOCK_ZONE_WIDTH, height: DOCK_ZONE_HEIGHT },
    { anchor: 'bottom-right', x: right, y: bottom, width: DOCK_ZONE_WIDTH, height: DOCK_ZONE_HEIGHT },
  ];
};

export const hitTestDockZone = (pt: Point, vp: Viewport): PipAnchor | null => {
  const hit = dockZoneRects(vp).find(
    (rect) => pt.x >= rect.x && pt.x <= rect.x + rect.width && pt.y >= rect.y && pt.y <= rect.y + rect.height
  );
  return hit ? hit.anchor : null;
};

export const defaultPlacement = (): PipPlacement => ({
  anchor: 'bottom-right',
  offset: { x: 0, y: 0 },
  size: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  docked: true,
  collapsed: false,
});

// ─────────────────────────────────────────────────────────────────────────
// Message-column docking (desktop text views)
// ─────────────────────────────────────────────────────────────────────────

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Room kept free at the bottom of the message column, above the composer:
 * the typing indicator and the "jump to latest" button (40px + gap) live
 * there, so a card docked bottom-right doesn't hide them.
 */
export const REGION_BOTTOM_LANE = 56;

/** A region narrower than this can't hold the smallest card (+ margins): show the pill. */
export const MIN_REGION_WIDTH = MIN_WIDTH + DOCK_MARGIN * 2;
/** Likewise for height (card + bottom lane + margins). */
export const MIN_REGION_HEIGHT = MIN_HEIGHT + REGION_BOTTOM_LANE + DOCK_MARGIN * 2;

/** The message column (above the composer) as a Viewport for the geometry above. */
export const regionViewport = (region: Rect): Viewport => ({
  left: region.left,
  top: region.top,
  width: region.width,
  height: region.height,
  bottomInset: REGION_BOTTOM_LANE,
});

export const regionFitsCard = (region: Rect): boolean =>
  region.width >= MIN_REGION_WIDTH && region.height >= MIN_REGION_HEIGHT;

/**
 * Default card for a message column: docked bottom-right, at most 45% of
 * the column's width (480px max, 320px min), 4:3.
 */
export const defaultRegionPlacement = (region: Rect): PipPlacement => {
  const width = Math.round(Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, region.width * 0.45)));
  return {
    ...defaultPlacement(),
    size: { width, height: Math.max(MIN_HEIGHT, Math.round((width * 3) / 4)) },
  };
};

/** Window-width buckets the message-column placement is remembered per. */
export const viewportBucket = (windowWidth: number): string => {
  if (windowWidth < 1280) return 'lt1280';
  if (windowWidth < 1600) return '1280';
  if (windowWidth < 1920) return '1600';
  if (windowWidth < 2560) return '1920';
  return '2560';
};
