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

/** bottomInset is VOICE_BAR_HEIGHT when connected to voice, else 0. */
export interface Viewport {
  width: number;
  height: number;
  bottomInset: number;
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

const clampPosition = (pos: Point, size: Size, vp: Viewport): Point => {
  const maxX = Math.max(EDGE_PADDING, vp.width - size.width - EDGE_PADDING);
  const maxY = Math.max(EDGE_PADDING, vp.height - vp.bottomInset - size.height - EDGE_PADDING);
  return {
    x: Math.min(Math.max(pos.x, EDGE_PADDING), maxX),
    y: Math.min(Math.max(pos.y, EDGE_PADDING), maxY),
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

  let x: number;
  let y: number;

  if (placement.docked) {
    x = hSide === 'left' ? DOCK_MARGIN : vp.width - size.width - DOCK_MARGIN;
    y = vSide === 'top' ? DOCK_MARGIN : vp.height - vp.bottomInset - size.height - DOCK_MARGIN;
  } else {
    x = hSide === 'left' ? placement.offset.x : vp.width - size.width - placement.offset.x;
    y = vSide === 'top' ? placement.offset.y : vp.height - vp.bottomInset - size.height - placement.offset.y;
  }

  return clampPosition({ x, y }, size, vp);
};

/**
 * Nearest corner by card center. Offsets are measured inward from that
 * corner and are always non-negative, so a free placement survives a
 * viewport resize without drifting off-screen.
 */
export const fromAbsolute = (pos: Point, size: Size, vp: Viewport): { anchor: PipAnchor; offset: Point } => {
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
  const left = DOCK_MARGIN;
  const right = vp.width - DOCK_MARGIN - DOCK_ZONE_WIDTH;
  const top = DOCK_MARGIN;
  const bottom = vp.height - vp.bottomInset - DOCK_MARGIN - DOCK_ZONE_HEIGHT;

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
