/**
 * Layout Constants
 *
 * Centralized layout dimensions used across the application.
 * These values ensure consistent spacing and sizing.
 */

/**
 * Top app bar height on phone and tablet. The desktop layout has no app bar:
 * navigation and the account menu live in the community rail.
 */
export const APPBAR_HEIGHT = 64;

/**
 * Community rail width (left side, desktop), collapsed.
 */
export const SIDEBAR_WIDTH = 80;

/**
 * Community rail width when expanded into a labelled list (desktop).
 */
export const RAIL_EXPANDED_WIDTH = 160;

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

/**
 * Page shells (components/Common/PageShell.tsx), desktop only. List pages cap
 * at PAGE_LIST_MAX_WIDTH by default; a page can ask for another cap
 * (PAGE_FEED_MAX_WIDTH for a readable feed, PAGE_PROFILE_MAX_WIDTH,
 * PAGE_WIDE_MAX_WIDTH for Home's grid and the admin tables). User pages are
 * centred in the content area; admin stays left-aligned next to its drawer.
 * Form pages put a FORM_NAV_WIDTH section nav next to a FORM_COLUMN_WIDTH
 * column (a fluid column up to FORM_WIDE_COLUMN_WIDTH for tables); when the
 * shell is narrower than FORM_SHELL_COLLAPSE_PX (an 800px Electron window, the
 * expanded rail) the nav becomes a row of tabs above the column.
 */
export const PAGE_LIST_MAX_WIDTH = 960;
export const PAGE_FEED_MAX_WIDTH = 800;
export const PAGE_PROFILE_MAX_WIDTH = 1200;
export const PAGE_WIDE_MAX_WIDTH = 1600;
export const FORM_NAV_WIDTH = 220;
export const FORM_COLUMN_WIDTH = 680;
export const FORM_WIDE_COLUMN_WIDTH = 1280;
export const FORM_SHELL_COLLAPSE_PX = 940;

/**
 * Home's layout by the shell's own width (not the viewport): one column below
 * HOME_TWO_COLUMN_PX, Mentions | Unread messages side by side from it, and from
 * HOME_SIDE_COLUMN_PX a HOME_SIDE_COLUMN_WIDTH column for the invite and
 * download cards.
 */
export const HOME_TWO_COLUMN_PX = 1200;
export const HOME_SIDE_COLUMN_PX = 1560;
export const HOME_SIDE_COLUMN_WIDTH = 340;

/** Friends: from this shell width the list gets a side panel (add friend, pending requests). */
export const FRIENDS_SPLIT_PX = 1200;
export const FRIENDS_LIST_MAX_WIDTH = 720;
export const FRIENDS_SIDE_PANEL_WIDTH = 380;
