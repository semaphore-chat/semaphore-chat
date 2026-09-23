/**
 * Deterministic seeded PRNG for scenario generation.
 *
 * Ladle scenarios must render identically on every run (screenshots are
 * diffed by eye and, eventually, by pixel) so nothing here may use
 * `Math.random()`. `createRng(seed)` turns any string into a stable
 * mulberry32 generator; every helper below is a pure function of that
 * generator's state.
 */

export type Rng = () => number;

/** FNV-1a string hash, used to turn a seed string into a 32-bit int. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, decent-quality seeded PRNG. */
export function createRng(seed: string): Rng {
  let a = hashSeed(seed);
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] inclusive. */
export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Pick one element deterministically. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[int(rng, 0, items.length - 1)];
}

/** Pick `count` distinct elements (no repeats), order preserved from source. */
export function pickMany<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const result: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = int(rng, 0, pool.length - 1);
    result.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return result;
}

/** True with the given probability (0..1). */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Deterministic ISO timestamp offset backwards from a fixed epoch by `minutesAgo`. */
export function timeAgo(minutesAgo: number): string {
  // Fixed epoch (not `Date.now()`) so scenario output — and therefore
  // screenshots — never changes from one sweep to the next.
  const EPOCH = Date.UTC(2026, 8, 22, 18, 0, 0);
  return new Date(EPOCH - minutesAgo * 60_000).toISOString();
}
