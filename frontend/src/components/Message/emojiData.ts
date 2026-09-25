/**
 * Built-in emoji data for the emoji picker and the mobile quick-reaction row.
 *
 * Lives outside EmojiPicker.tsx so that file only exports components (React
 * Fast Refresh; eslint react-refresh/only-export-components).
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

/** Common emoji for the mobile quick-reaction row (first row of "Frequently Used"). */
export const QUICK_REACTIONS = EMOJI_CATEGORIES['Frequently Used'].slice(0, 8);
