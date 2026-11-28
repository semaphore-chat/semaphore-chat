/**
 * Bidi control characters in text. No imports: classic code and the kit both use these, and the kit's own chunk
 * must stay out of the first page load.
 */

/** Bidi controls (embeddings, overrides, isolates, marks): they reorder what is drawn, so a shown address drops them. */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** `text` without bidi control characters. */
export function stripBidi(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

/** Bidi embeddings, overrides and isolates. The plain marks (U+200E, U+200F, U+061C) are not here: they are harmless. */
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;

/** `text` without bidi embeddings, overrides and isolates, so none can reach past its own segment. Marks are kept. */
export function stripBidiOverrides(text: string): string {
  return text.replace(BIDI_OVERRIDES, '');
}

/**
 * `text` without its unpaired bidi embeddings, overrides and isolates: the ones not closed inside it (or closing
 * nothing) would run on into the next segment. A balanced embedding or isolate pair is kept, as real right-to-left
 * text uses it, as the native client does. Overrides (U+202D, U+202E) are always dropped, even balanced: they
 * rewrite the order of what they wrap. Marks are kept.
 */
export function stripUnpairedBidi(text: string): string {
  const source = text.replace(/[\u202D\u202E]/g, '');
  const drop = new Set<number>();
  // Embeddings (LRE, RLE) close with PDF, isolates (LRI, RLI, FSI) with PDI; a PDI also closes the embeddings
  // opened inside its isolate, and a PDF closes only an embedding opened inside the innermost open isolate.
  const embeds: number[] = [];
  const isolates: { at: number; depth: number }[] = [];
  for (let at = 0; at < source.length; at += 1) {
    const code = source.charCodeAt(at);
    if (code === 0x202a || code === 0x202b) embeds.push(at);
    else if (code >= 0x2066 && code <= 0x2068) isolates.push({ at, depth: embeds.length });
    else if (code === 0x202c) {
      const floor = isolates.length > 0 ? isolates[isolates.length - 1].depth : 0;
      if (embeds.length > floor) embeds.pop();
      else drop.add(at);
    } else if (code === 0x2069) {
      const open = isolates.pop();
      if (open === undefined) drop.add(at);
      else for (const unclosed of embeds.splice(open.depth)) drop.add(unclosed);
    }
  }
  for (const at of embeds) drop.add(at);
  for (const { at } of isolates) drop.add(at);
  if (drop.size === 0) return source;
  let kept = '';
  for (let at = 0; at < source.length; at += 1) if (!drop.has(at)) kept += source[at];
  return kept;
}
