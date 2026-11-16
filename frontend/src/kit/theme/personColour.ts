import { colourParams } from '../../theme/generated/colourParams';

/** `colour.people.colours` from `design/colour.json`: frozen, so a person keeps their colour. */
export const PEOPLE_COLOURS: readonly string[] = colourParams.people;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const encoder = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `text`, unsigned. */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(text)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A person's avatar colour, from their user id: `PEOPLE_COLOURS[fnv1a32(utf8(id)) % 9]`, the id
 * used exactly as the API gives it. A missing or empty id gives `undefined` (the neutral fill).
 * The same definition as `design/gen/colour_ref.py` (`person_colour`) and the native client;
 * `design/vectors/person-colour.json` pins it. Pass the result to `Avatar`'s `colour`.
 */
export function personColour(id: string | null | undefined): string | undefined {
  if (id === null || id === undefined || id === '') {
    return undefined;
  }
  return PEOPLE_COLOURS[fnv1a32(id) % PEOPLE_COLOURS.length];
}
