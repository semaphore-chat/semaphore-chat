/** A client-supplied page size, held between 1 and the endpoint's maximum. */
export function clampLimit(limit: number, max: number): number {
  return Math.min(Math.max(limit, 1), max);
}
