/**
 * The words the community pieces put together from data: pure, so tests and stories share them.
 */
import type { LoadController } from '../../../../kit';

export interface NamedPerson {
  id: string;
  name: string;
}

/** "9 around"; null when no source knows the number (then no number is shown). */
export function aroundLine(aroundCount: number | null): string | null {
  return aroundCount === null ? null : `${aroundCount.toLocaleString()} around`;
}

const SHOWN_NAMES = 3;

/** "You, dropbear and pri", "dropbear and 9 more": you first, then the room's order. */
export function peopleLine(people: readonly NamedPerson[], youId: string | null): string {
  const you = people.filter((p) => p.id === youId);
  const names = [...you.map(() => 'You'), ...people.filter((p) => p.id !== youId).map((p) => p.name || 'Unknown user')];
  if (names.length <= SHOWN_NAMES) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  const shown = names.slice(0, SHOWN_NAMES - 1);
  return `${shown.join(', ')} and ${names.length - shown.length} more`;
}

/** "dropbear is talking", "dropbear and pri are talking"; you are left out (you know). */
export function talkingLine(people: readonly NamedPerson[], speaking: ReadonlySet<string>, youId: string | null): string | null {
  const names = people.filter((p) => p.id !== youId && speaking.has(p.id)).map((p) => p.name || 'Unknown user');
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is talking`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are talking`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are talking`;
}

const noop = () => undefined;

/** A load face from a query's status (the data hooks are not TanStack results). */
export function loadController(status: 'pending' | 'error' | 'success', empty: boolean, retry: () => void): LoadController {
  return {
    status: status === 'pending' ? 'loading' : status === 'error' ? 'error' : empty ? 'empty' : 'ready',
    error: null,
    retryable: true,
    refreshByUser: false,
    refresh: noop,
    retry,
  };
}
