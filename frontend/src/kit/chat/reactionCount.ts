/** Up to this many, the count is drawn in full; above it in a compact form ("1.2K"). The name keeps the exact count. */
const FULL_COUNT_MAX = 999;

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** The count as drawn: whole, never negative, compact above `FULL_COUNT_MAX`. */
export function drawnReactionCount(count: number): string {
  const whole = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return whole > FULL_COUNT_MAX ? compact.format(whole) : String(whole);
}
