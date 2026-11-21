/**
 * Built-in emoji data for the emoji picker and the mobile quick-reaction row.
 *
 * Lives outside EmojiPicker.tsx so that file only exports components (React
 * Fast Refresh; eslint react-refresh/only-export-components). The catalogue
 * itself lives in data/chat/emojiCatalogue.ts (shared with the Lounge shell).
 */
import { EMOJI_CATEGORIES, EMOJI_NAMES } from '../../data/chat/emojiCatalogue';

export { EMOJI_CATEGORIES, EMOJI_NAMES };

/** Common emoji for the mobile quick-reaction row (first row of "Frequently Used"). */
export const QUICK_REACTIONS = EMOJI_CATEGORIES['Frequently Used'].slice(0, 8);
