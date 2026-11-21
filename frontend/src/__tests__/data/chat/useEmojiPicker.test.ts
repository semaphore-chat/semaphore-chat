import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CustomEmojiDto } from '../../../api-client/types.gen';
import {
  pickReaction,
  pickText,
  RECENT_EMOJI_STORAGE_KEY,
  useEmojiPicker,
  type EmojiPick,
} from '../../../data/chat/useEmojiPicker';
import { EMOJI_CATEGORIES } from '../../../data/chat/emojiCatalogue';

const custom = vi.hoisted(() => ({ emojis: [] as CustomEmojiDto[] }));
vi.mock('../../../hooks/useCommunityCustomEmojis', () => ({
  useCommunityCustomEmojis: () => ({
    emojis: custom.emojis,
    byId: new Map(custom.emojis.map((e) => [e.id, e])),
    byName: new Map(custom.emojis.map((e) => [e.name, e])),
    isLoading: false,
  }),
}));

function emoji(id: string, name: string): CustomEmojiDto {
  return { id, name, fileId: `file-${id}`, communityId: 'c-1', createdBy: null, createdAt: '2026-01-01' } as unknown as CustomEmojiDto;
}

const parrot = emoji('e1', 'party_parrot');
const shipit = emoji('e2', 'shipit');

function render(query = '', communityId: string | null = 'c-1') {
  return renderHook((props: { query: string }) => useEmojiPicker({ communityId, query: props.query }), {
    initialProps: { query },
  });
}

beforeEach(() => {
  localStorage.clear();
  custom.emojis = [parrot, shipit];
});

describe('pickText / pickReaction', () => {
  it('unicode: the emoji itself', () => {
    const pick: EmojiPick = { kind: 'unicode', emoji: '🔥' };
    expect(pickText(pick)).toBe('🔥');
    expect(pickReaction(pick)).toBe('🔥');
  });
  it('custom: :name: to insert, custom:<id> to react', () => {
    const pick: EmojiPick = { kind: 'custom', emoji: parrot };
    expect(pickText(pick)).toBe(':party_parrot:');
    expect(pickReaction(pick)).toBe('custom:e1');
  });
});

describe('useEmojiPicker', () => {
  it('no recent: Custom, then every catalogue category in order', () => {
    const { result } = render();
    const ids = result.current.sections.map((s) => s.id);
    expect(ids[0]).toBe('custom');
    expect(result.current.sections.slice(1).map((s) => s.title)).toEqual(Object.keys(EMOJI_CATEGORIES));
    expect(ids[1]).toBe('frequently-used');
    expect(result.current.hasResults).toBe(true);
    const c = result.current.sections[0].items[0];
    expect(c).toMatchObject({ label: ':party_parrot:', src: '/api/file/file-e1', pick: { kind: 'custom', emoji: parrot } });
    const u = result.current.sections[1].items[0];
    expect(u).toMatchObject({ glyph: '👍', label: 'thumbs up', pick: { kind: 'unicode', emoji: '👍' } });
  });

  it('item ids are unique across the picker', () => {
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(['👍', 'custom:e1']));
    const { result } = render();
    const ids = result.current.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no community: no Custom section', () => {
    custom.emojis = [];
    const { result } = render('', null);
    expect(result.current.sections.map((s) => s.id)).not.toContain('custom');
  });

  it('Recently used comes first, from storage, newest first; hidden while searching', () => {
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(['🔥', 'custom:e2', '🦀']));
    const { result, rerender } = render();
    expect(result.current.sections[0].id).toBe('recent');
    expect(result.current.sections[0].title).toBe('Recently used');
    const items = result.current.sections[0].items;
    expect(items.map((i) => i.pick)).toEqual([
      { kind: 'unicode', emoji: '🔥' },
      { kind: 'custom', emoji: shipit },
      { kind: 'unicode', emoji: '🦀' },
    ]);
    // A unicode token outside the catalogue still shows, glyph = token.
    expect(items[2]).toMatchObject({ glyph: '🦀', label: '🦀' });

    rerender({ query: 'parrot' });
    expect(result.current.sections.map((s) => s.id)).toEqual(['custom']);
    expect(result.current.sections[0].items.map((i) => i.label)).toEqual([':party_parrot:']);
  });

  it('skips custom tokens the community no longer has (storage untouched)', () => {
    const stored = JSON.stringify(['custom:gone', '😀']);
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, stored);
    const { result } = render();
    expect(result.current.sections[0].items.map((i) => i.glyph)).toEqual(['😀']);
    expect(localStorage.getItem(RECENT_EMOJI_STORAGE_KEY)).toBe(stored);
  });

  it('no Recently used section when every token is unknown', () => {
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(['custom:gone']));
    const { result } = render();
    expect(result.current.sections[0].id).toBe('custom');
  });

  it.each([['not json'], ['{"a":1}'], ['"🔥"'], ['[1, null, ""]']])('a bad stored value (%s) reads as empty', (raw) => {
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, raw);
    const { result } = render();
    expect(result.current.sections[0].id).toBe('custom');
  });

  it('noteUsed moves the pick to the front, dedups, caps at 16 and persists', () => {
    const { result } = render();
    act(() => result.current.noteUsed({ kind: 'unicode', emoji: '🔥' }));
    act(() => result.current.noteUsed({ kind: 'custom', emoji: parrot }));
    act(() => result.current.noteUsed({ kind: 'unicode', emoji: '🔥' }));
    expect(result.current.sections[0].items.map((i) => i.pick)).toEqual([
      { kind: 'unicode', emoji: '🔥' },
      { kind: 'custom', emoji: parrot },
    ]);
    expect(JSON.parse(localStorage.getItem(RECENT_EMOJI_STORAGE_KEY)!)).toEqual(['🔥', 'custom:e1']);

    const many = EMOJI_CATEGORIES['Smileys & People'] ?? Object.values(EMOJI_CATEGORIES).flat();
    act(() => {
      for (const e of many.slice(0, 20)) result.current.noteUsed({ kind: 'unicode', emoji: e });
    });
    const stored = JSON.parse(localStorage.getItem(RECENT_EMOJI_STORAGE_KEY)!) as string[];
    expect(stored).toHaveLength(16);
    expect(stored[0]).toBe(many[19]);
    expect(result.current.sections[0].items).toHaveLength(16);
  });

  it('a throwing storage reads as empty and noteUsed still updates the state', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      const { result } = render();
      expect(result.current.sections[0].id).toBe('custom');
      act(() => result.current.noteUsed({ kind: 'unicode', emoji: '🎉' }));
      expect(result.current.sections[0].items.map((i) => i.glyph)).toEqual(['🎉']);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('a query with no match: no sections, hasResults false', () => {
    const { result } = render('zzzznothing');
    expect(result.current.sections).toEqual([]);
    expect(result.current.hasResults).toBe(false);
  });
});
