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
 * Default width of the channel sidebar next to the community rail (the
 * `TwoColumnLayout` sidebar in the community and DM views).
 */
export const CHANNEL_SIDEBAR_WIDTH = 280;

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

/**
 * Docked right-hand side panel (threads, pinned messages, search) on wide
 * desktop windows. Same width as the thread drawer it replaces.
 */
export const SIDE_PANEL_WIDTH = 400;

/**
 * Narrowest the chat column gets next to the docked side panel. At the
 * docking breakpoint (1200px) the rail, channel list and panel leave it 480px;
 * this guards the column if the sidebars ever grow.
 */
export const CHAT_COLUMN_MIN_WIDTH = 400;

/**
 * Longest line of message text: about 80 characters of the 16px message font
 * (~720px). Long paragraphs stay readable on wide windows; the column stays
 * left-aligned under the avatars. Images, GIFs and link cards keep their own caps.
 */
export const MESSAGE_TEXT_MAX_WIDTH = "80ch";

/**
 * Widest a code block in a message grows past the text cap (in the code font's
 * own `ch`), never wider than the message column; longer lines scroll. Only on
 * columns of at least CODE_BLOCK_UNWRAP_MIN_COLUMN_PX: narrower ones (phones,
 * tablets) wrap code lines as before.
 */
export const CODE_BLOCK_MAX_WIDTH = "120ch";

/** Message column width (px, ~80ch of message text) from which code blocks stop wrapping. */
export const CODE_BLOCK_UNWRAP_MIN_COLUMN_PX = 720;
