import { useCallback, useMemo, useState } from 'react';
import type { CustomEmojiDto } from '../../api-client/types.gen';
import { useCommunityCustomEmojis } from '../../hooks/useCommunityCustomEmojis';
import { getFileUrl } from '../../utils/fileHelpers';
import { emojiName, filterCustomEmojis, searchEmojiCategories } from './emojiCatalogue';

export type EmojiPick = { kind: 'unicode'; emoji: string } | { kind: 'custom'; emoji: CustomEmojiDto };

export interface EmojiPickerItem {
  id: string;
  label: string;
  glyph?: string;
  src?: string;
  pick: EmojiPick;
}

export interface EmojiPickerSection {
  id: string;
  title: string;
  items: EmojiPickerItem[];
}

export const RECENT_EMOJI_STORAGE_KEY = 'semaphore:recent-emoji';
export const RECENT_EMOJI_MAX = 16;

const CUSTOM_TOKEN_PREFIX = 'custom:';

/** What the composer inserts for a pick: the emoji, or `:name:` for a custom one. */
export function pickText(pick: EmojiPick): string {
  return pick.kind === 'unicode' ? pick.emoji : `:${pick.emoji.name}:`;
}

/** The reaction value sent for a pick: the emoji, or the `custom:<id>` sentinel. */
export function pickReaction(pick: EmojiPick): string {
  return pick.kind === 'unicode' ? pick.emoji : `${CUSTOM_TOKEN_PREFIX}${pick.emoji.id}`;
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_EMOJI_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of parsed) {
      if (typeof t !== 'string' || t === '' || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= RECENT_EMOJI_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

function writeRecent(tokens: string[]): void {
  try {
    localStorage.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Storage unavailable (private mode, quota): the in-memory list still updates.
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unicodeItem(sectionId: string, emoji: string): EmojiPickerItem {
  return {
    id: `${sectionId}:${emoji}`,
    label: emojiName(emoji),
    glyph: emoji,
    pick: { kind: 'unicode', emoji },
  };
}

function customItem(sectionId: string, emoji: CustomEmojiDto): EmojiPickerItem {
  return {
    id: `${sectionId}:${CUSTOM_TOKEN_PREFIX}${emoji.id}`,
    label: `:${emoji.name}:`,
    src: getFileUrl(emoji.fileId) ?? undefined,
    pick: { kind: 'custom', emoji },
  };
}

/**
 * The emoji picker's content as plain sections: "Recently used" (blank query
 * only), the community's custom emoji, then the catalogue categories, all
 * filtered by `query`. `noteUsed` records a pick in the recent list
 * (localStorage `semaphore:recent-emoji`, newest first, unique, at most 16).
 */
export function useEmojiPicker(opts: { communityId?: string | null; query: string }): {
  sections: EmojiPickerSection[];
  hasResults: boolean;
  noteUsed: (pick: EmojiPick) => void;
} {
  const { communityId, query } = opts;
  const { emojis: customEmojis, byId } = useCommunityCustomEmojis(communityId);
  const [recent, setRecent] = useState<string[]>(readRecent);

  const noteUsed = useCallback((pick: EmojiPick) => {
    const token = pickReaction(pick);
    setRecent((prev) => {
      const next = [token, ...prev.filter((t) => t !== token)].slice(0, RECENT_EMOJI_MAX);
      writeRecent(next);
      return next;
    });
  }, []);

  const sections = useMemo(() => {
    const out: EmojiPickerSection[] = [];

    if (!query.trim()) {
      const items: EmojiPickerItem[] = [];
      for (const token of recent) {
        if (token.startsWith(CUSTOM_TOKEN_PREFIX)) {
          const emoji = byId.get(token.slice(CUSTOM_TOKEN_PREFIX.length));
          if (emoji) items.push(customItem('recent', emoji));
        } else {
          items.push(unicodeItem('recent', token));
        }
      }
      if (items.length > 0) out.push({ id: 'recent', title: 'Recently used', items });
    }

    const custom = filterCustomEmojis(customEmojis, query);
    if (custom.length > 0) {
      out.push({ id: 'custom', title: 'Custom', items: custom.map((e) => customItem('custom', e)) });
    }

    for (const [name, emojis] of Object.entries(searchEmojiCategories(query))) {
      const id = slug(name);
      out.push({ id, title: name, items: emojis.map((e) => unicodeItem(id, e)) });
    }
    return out;
  }, [query, recent, byId, customEmojis]);

  return { sections, hasResults: sections.length > 0, noteUsed };
}
