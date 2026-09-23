/**
 * Responsive breakpoint constants
 * Based on Material-UI breakpoint system with enhanced mobile/tablet support
 */

export const BREAKPOINTS = {
  xs: 0,      // Phone portrait
  sm: 600,    // Phone landscape
  md: 768,    // Tablet portrait (updated for better tablet detection)
  lg: 1024,   // Tablet landscape / Small desktop
  xl: 1200,   // Desktop
  xxl: 1536,  // Large desktop
} as const;

// Device-specific breakpoints
export const DEVICE_BREAKPOINTS = {
  PHONE: 600,           // < 600px = phone
  PHONE_LANDSCAPE: 768, // 600-768px = phone landscape
  TABLET: 1024,         // 768-1024px = tablet portrait
  TABLET_LANDSCAPE: 1200, // 1024-1200px = tablet landscape
  DESKTOP: 1200,        // >= 1200px = desktop
} as const;

export const MOBILE_MAX_WIDTH = DEVICE_BREAKPOINTS.TABLET - 1;  // 1023px (includes tablets)
export const PHONE_MAX_WIDTH = DEVICE_BREAKPOINTS.PHONE - 1;    // 599px
export const TABLET_MIN_WIDTH = DEVICE_BREAKPOINTS.PHONE;       // 600px
export const TABLET_MAX_WIDTH = DEVICE_BREAKPOINTS.DESKTOP - 1; // 1199px

/**
 * Layout dimensions
 */
export const LAYOUT_CONSTANTS = {
  APPBAR_HEIGHT: 64,
  APPBAR_HEIGHT_MOBILE: 56,
  SIDEBAR_WIDTH: 80,
  SIDEBAR_WIDTH_EXPANDED: 320,
  CHANNEL_LIST_WIDTH: 280,
  VOICE_BAR_HEIGHT: 64,
  VOICE_BAR_HEIGHT_MOBILE: 72,
  BOTTOM_NAV_HEIGHT: 56,
  BOTTOM_NAV_HEIGHT_MOBILE: 56,
  MIN_TOUCH_TARGET: 48,
} as const;

/**
 * Mobile-specific constants
 */
export const MOBILE_CONSTANTS = {
  DRAWER_WIDTH: 280,
  DRAWER_WIDTH_FULL: '85vw',
  COMMUNITY_AVATAR_SIZE: 64,
  CHANNEL_ITEM_HEIGHT: 56,
  MESSAGE_AVATAR_SIZE: 32,
  SWIPE_THRESHOLD: 50, // pixels
  EDGE_SWIPE_ZONE: 20, // pixels from edge to trigger drawer
  // Gestures that START within this many pixels of the left/right screen edge
  // are ignored, so they don't fight the browser's native edge back-gesture.
  EDGE_BACK_GESTURE_ZONE: 24, // pixels from edge to ignore navigation swipes
  LONG_PRESS_DURATION: 500, // milliseconds
  LONG_PRESS_SLOP: 10, // pixels of movement that cancels a pending long-press
} as const;

/**
 * Whether the app runs as an installed PWA (`display-mode: standalone`, or the
 * legacy iOS `navigator.standalone` flag). Side-effect free; safe where
 * `matchMedia` is missing (SSR, jsdom).
 */
export const isStandaloneDisplayMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const mql = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)')
    : null;
  if (mql?.matches) return true;
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

/**
 * Width of the left/right dead zone for in-app navigation swipes. In a browser
 * tab the browser owns the edge back-gesture, so swipes starting there are left
 * alone. An installed (standalone) PWA has no browser chrome and no competing
 * edge gesture, so the dead zone is dropped and a swipe from the very edge
 * works as "back".
 */
export const getBackGestureEdgeZone = (): number =>
  isStandaloneDisplayMode() ? 0 : MOBILE_CONSTANTS.EDGE_BACK_GESTURE_ZONE;

/**
 * Drag-following back swipe (MobileChatPanel): how the screen settles once
 * the finger lifts.
 */
export const BACK_SWIPE = {
  SETTLE_DURATION: 200, // ms, snap-back / release animation
  AXIS_LOCK_DISTANCE: 10, // px of movement before the drag commits to an axis
  AXIS_RATIO: 1.5, // horizontal must beat vertical by this much to follow
} as const;

/**
 * Touch target sizes (accessibility)
 */
export const TOUCH_TARGETS = {
  MINIMUM: 44,     // iOS HIG minimum
  RECOMMENDED: 48, // Material Design recommended
  COMFORTABLE: 56, // For primary actions
} as const;

/**
 * Animation durations
 */
export const MOBILE_ANIMATIONS = {
  FAST: 150,    // Micro-interactions
  NORMAL: 250,  // Screen transitions
  SLOW: 400,    // Drawer animations
} as const;
