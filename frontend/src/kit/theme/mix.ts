/**
 * Blend `over` into `under` by `alpha`, per 8-bit channel, rounded to nearest.
 *
 * The kit paints transient states (hover, pressed) by mixing the state tint
 * over the colour underneath, so this returns an opaque `#rrggbb` and callers
 * never stack translucent layers.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(colour: string): [number, number, number] {
  if (!HEX.test(colour)) {
    throw new RangeError(`mix() expects #rrggbb colours, got ${JSON.stringify(colour)}`);
  }
  return [
    parseInt(colour.slice(1, 3), 16),
    parseInt(colour.slice(3, 5), 16),
    parseInt(colour.slice(5, 7), 16),
  ];
}

export function mix(over: string, under: string, alpha: number): string {
  const top = channels(over);
  const bottom = channels(under);
  const weight = Math.min(1, Math.max(0, alpha));
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const channel = Math.floor(bottom[i] + (top[i] - bottom[i]) * weight + 0.5);
    out += channel.toString(16).padStart(2, '0');
  }
  return out;
}
