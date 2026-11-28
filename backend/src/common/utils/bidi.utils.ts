/**
 * Bidi embeddings, overrides, isolates and the plain marks: they reorder what is drawn, so text a client draws as
 * a name (a file name, a display name in a notification) drops them.
 */
const BIDI_CONTROLS = /[‪-‮⁦-⁩‎‏؜]/g;

/** `text` without bidi control characters. */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}
