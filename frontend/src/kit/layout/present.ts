import type { ReactNode } from 'react';

/**
 * Whether an optional slot holds anything. `undefined`, `null`, `false` and `''` are all "not there", so
 * `right={showThread && <Thread />}` leaves no empty region, column or Sheet behind. Every optional slot of every
 * layout is checked with this one function.
 */
export function isPresent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}
