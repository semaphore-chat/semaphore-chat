/**
 * Layout Constants
 *
 * Centralized layout dimensions used across the application.
 * These values ensure consistent spacing and sizing.
 */

/**
 * Main app bar height (top navigation)
 */
export const APPBAR_HEIGHT = 64;

/**
 * Community sidebar width (left side)
 */
export const SIDEBAR_WIDTH = 80;

/**
 * Voice bottom bar height (when connected to voice)
 */
export const VOICE_BAR_HEIGHT = 64;

/**
 * Mobile voice bar height
 */
export const VOICE_BAR_HEIGHT_MOBILE = 56;

/**
 * Channel list width (in community view)
 */
export const CHANNEL_LIST_WIDTH = 240;

/**
 * Member list width (right sidebar)
 */
export const MEMBER_LIST_WIDTH = 240;

/**
 * Height of the "X is typing..." indicator that floats over the bottom of
 * the message list. The list reserves a spacer of this height after the
 * newest message so the indicator never covers it (no layout shift when
 * typing starts or stops).
 */
export const TYPING_INDICATOR_HEIGHT = 32;
