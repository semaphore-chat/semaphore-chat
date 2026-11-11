/**
 * Exports the web client's built-in emoji data for the native emoji picker (unit W1-ui-emoji).
 *
 * Run with `native/scripts/gen-emoji.sh`, which calls `native/scripts/export-web.sh emoji`; this
 * writes `native-export-out/emoji/emoji.json`, and the script copies it to
 * `native/crates/semaphore-ui/assets/emoji/emoji.json`.
 *
 * Categories keep the web's order (an array, since JSON objects promise none). `names` is
 * `EMOJI_NAMES` as it is: the first name is each emoji's accessible label, the rest are search
 * terms. `quickReactions` is `QUICK_REACTIONS`, which the Rust side also states as a constant and
 * checks against this file.
 */
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { EMOJI_CATEGORIES, EMOJI_NAMES, QUICK_REACTIONS } from '../../components/Message/emojiData';

it('writes', () => {
  mkdirSync('native-export-out/emoji', { recursive: true });
  const out = {
    source: 'frontend/src/components/Message/emojiData.ts',
    categories: Object.entries(EMOJI_CATEGORIES).map(([name, emoji]) => ({ name, emoji })),
    names: EMOJI_NAMES,
    quickReactions: QUICK_REACTIONS,
  };
  writeFileSync('native-export-out/emoji/emoji.json', JSON.stringify(out, null, 1) + '\n');
});
