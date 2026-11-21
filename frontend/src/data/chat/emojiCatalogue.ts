/**
 * The built-in emoji catalogue (names for search, categories for the picker)
 * and the pure search rules both shells' pickers use. Headless: no UI imports.
 */

// Emoji names for search functionality
export const EMOJI_NAMES: Record<string, string[]> = {
  '👍': ['thumbs up', 'like', 'yes', 'good', 'ok', 'approve'],
  '👎': ['thumbs down', 'dislike', 'no', 'bad', 'disapprove'],
  '❤️': ['heart', 'love', 'red heart'],
  '😂': ['laugh', 'lol', 'joy', 'crying laughing', 'tears'],
  '😮': ['surprised', 'wow', 'shocked', 'omg'],
  '😢': ['sad', 'cry', 'crying'],
  '😡': ['angry', 'mad', 'rage'],
  '👏': ['clap', 'applause', 'bravo'],
  '🎉': ['party', 'celebrate', 'tada', 'celebration'],
  '🔥': ['fire', 'hot', 'lit', 'flames'],
  '💯': ['hundred', 'perfect', '100'],
  '⭐': ['star', 'favorite'],
  '✅': ['check', 'done', 'complete', 'yes'],
  '❌': ['x', 'no', 'wrong', 'cancel', 'cross'],
  '🤔': ['thinking', 'hmm', 'think'],
  '😍': ['love eyes', 'heart eyes', 'adore'],
  '😀': ['grin', 'happy', 'smile'],
  '😊': ['blush', 'happy', 'smile'],
  '😭': ['sob', 'crying hard', 'tears'],
  '🥳': ['party face', 'celebrate'],
  '😎': ['cool', 'sunglasses'],
  '🤣': ['rofl', 'rolling'],
  '😱': ['scream', 'fear', 'scared'],
  '🙏': ['pray', 'please', 'thanks', 'hope'],
  '💪': ['muscle', 'strong', 'flex'],
  '🤝': ['handshake', 'deal', 'agree'],
  '🙌': ['raise hands', 'hooray', 'praise'],
  '💎': ['diamond', 'gem'],
  '🔔': ['bell', 'notification', 'alert'],
  '🎂': ['cake', 'birthday'],
  '🎁': ['gift', 'present'],
  '🎈': ['balloon', 'party'],
  '✨': ['sparkle', 'magic', 'shine'],
  '🌟': ['glowing star', 'shine'],
  '💥': ['boom', 'explosion'],
  '💫': ['dizzy', 'star'],
  '🐶': ['dog', 'puppy'],
  '🐱': ['cat', 'kitty'],
  '🐻': ['bear', 'teddy'],
  '🦊': ['fox'],
  '🐼': ['panda'],
  '🦁': ['lion'],
  '🐯': ['tiger'],
  '🍕': ['pizza'],
  '🍔': ['burger', 'hamburger'],
  '🍟': ['fries', 'french fries'],
  '🍦': ['ice cream'],
  '🍰': ['cake', 'slice'],
  '☕': ['coffee', 'tea'],
  '🍺': ['beer'],
  '🍷': ['wine'],
  '⚽': ['soccer', 'football'],
  '🏀': ['basketball'],
  '🏈': ['football', 'american football'],
  '⚾': ['baseball'],
  '🎮': ['game', 'controller', 'gaming'],
  '🎬': ['movie', 'film', 'action'],
  '🎵': ['music', 'note'],
  '🎧': ['headphones', 'music'],
  '💻': ['computer', 'laptop'],
  '📱': ['phone', 'mobile'],
  '🏆': ['trophy', 'winner', 'champion'],
  '🥇': ['gold', 'first', 'medal'],
  '🥈': ['silver', 'second'],
  '🥉': ['bronze', 'third'],
};

export const EMOJI_CATEGORIES: Record<string, string[]> = {
  'Frequently Used': [
    '👍', '👎', '❤️', '😂', '😮', '😢', '😡', '👏',
    '🎉', '🔥', '💯', '⭐', '✅', '❌', '🤔', '😍'
  ],
  'Smileys & People': [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
    '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
    '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
    '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨',
    '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
    '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢',
    '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠',
    '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️',
    '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨',
    '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞',
    '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬',
    '👍', '👎', '👏', '🙌', '🤝', '💪', '🙏', '✌️'
  ],
  'Animals & Nature': [
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
    '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵',
    '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤',
    '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗',
    '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜',
    '🦟', '🦗', '🕷️', '🐢', '🐍', '🦎', '🦖', '🦕',
    '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟',
    '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓',
    '🦍', '🦧', '🐘', '🦏', '🦛', '🐪', '🐫', '🦒',
    '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑'
  ],
  'Food & Drink': [
    '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈',
    '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆',
    '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄',
    '🧅', '🥔', '🍠', '🥐', '🍞', '🥖', '🥨', '🧀',
    '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗',
    '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙',
    '🌮', '🌯', '🥗', '🥘', '🥫', '🍝', '🍜', '🍲',
    '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚',
    '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨',
    '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬'
  ],
  'Activities & Sports': [
    '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉',
    '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍',
    '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿',
    '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿',
    '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺',
    '🏊', '🏄', '🚣', '🧗', '🚵', '🚴', '🏇', '🏆',
    '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫',
    '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤',
    '🎧', '🎼', '🎵', '🎶', '🥁', '🪘', '🎷', '🎺'
  ],
  'Objects & Symbols': [
    '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟',
    '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙', '💜',
    '🤎', '🖤', '🤍', '💯', '💢', '💥', '💫', '💦',
    '💨', '🕳️', '💣', '💬', '🗨️', '🗯️', '💭', '💤',
    '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏',
    '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆',
    '🖕', '👇', '☝️', '👍', '👎', '👊', '✊', '🤛',
    '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️',
    '⭐', '🌟', '✨', '🎊', '🎉', '🎀', '🎁', '🎈',
    '🎂', '🎄', '🎃', '🎆', '🎇', '🧨', '💎', '🔔'
  ]
};

/** The first search name of an emoji, or the emoji itself when it has none. */
export function emojiName(emoji: string): string {
  return EMOJI_NAMES[emoji]?.[0] ?? emoji;
}

/**
 * The catalogue categories that match `query`: all of them for a blank query;
 * otherwise the emoji whose glyph or any name contains the query
 * (case-insensitive), with empty categories dropped.
 */
export function searchEmojiCategories(query: string): Record<string, string[]> {
  if (!query.trim()) return EMOJI_CATEGORIES;
  const q = query.toLowerCase().trim();
  const results: Record<string, string[]> = {};
  for (const [category, emojis] of Object.entries(EMOJI_CATEGORIES)) {
    const matched = emojis.filter((emoji) => {
      if (emoji.includes(q)) return true;
      const names = EMOJI_NAMES[emoji];
      return names ? names.some((name) => name.toLowerCase().includes(q)) : false;
    });
    if (matched.length > 0) results[category] = matched;
  }
  return results;
}

/** Custom emoji whose name contains `query` (case-insensitive); all for a blank query. */
export function filterCustomEmojis<T extends { name: string }>(emojis: T[], query: string): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return emojis;
  return emojis.filter((e) => e.name.toLowerCase().includes(q));
}
