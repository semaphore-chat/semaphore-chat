import { describe, expect, it } from 'vitest';
import {
  EMOJI_CATEGORIES,
  emojiName,
  filterCustomEmojis,
  searchEmojiCategories,
} from '../../../data/chat/emojiCatalogue';
import * as classic from '../../../components/Message/emojiData';

describe('emojiCatalogue', () => {
  it('classic emojiData still re-exports the catalogue and the quick reactions', () => {
    expect(classic.EMOJI_CATEGORIES).toBe(EMOJI_CATEGORIES);
    expect(classic.QUICK_REACTIONS).toEqual(EMOJI_CATEGORIES['Frequently Used'].slice(0, 8));
  });

  it('emojiName: the first name, else the emoji itself', () => {
    expect(emojiName('👍')).toBe('thumbs up');
    expect(emojiName('🦀')).toBe('🦀');
  });

  it('searchEmojiCategories: a blank query returns every category', () => {
    expect(searchEmojiCategories('')).toBe(EMOJI_CATEGORIES);
    expect(searchEmojiCategories('   ')).toBe(EMOJI_CATEGORIES);
  });

  it('searchEmojiCategories: matches names case-insensitively and drops empty categories', () => {
    const result = searchEmojiCategories('  THUMBS ');
    for (const emojis of Object.values(result)) {
      expect(emojis.length).toBeGreaterThan(0);
      for (const e of emojis) expect(e === '👍' || e === '👎').toBe(true);
    }
    expect(Object.values(result).flat()).toContain('👍');
    expect(Object.values(result).flat()).toContain('👎');
    expect(Object.keys(result).length).toBeLessThan(Object.keys(EMOJI_CATEGORIES).length);
  });

  it('searchEmojiCategories: matches the glyph itself', () => {
    expect(Object.values(searchEmojiCategories('🔥')).flat()).toContain('🔥');
  });

  it('searchEmojiCategories: no match gives no categories', () => {
    expect(searchEmojiCategories('zzzznotanemoji')).toEqual({});
  });

  it('filterCustomEmojis: blank query keeps all; else name contains the query, case-insensitive', () => {
    const list = [{ name: 'party_parrot' }, { name: 'shipit' }];
    expect(filterCustomEmojis(list, ' ')).toBe(list);
    expect(filterCustomEmojis(list, 'PARROT')).toEqual([{ name: 'party_parrot' }]);
    expect(filterCustomEmojis(list, 'nope')).toEqual([]);
  });
});
