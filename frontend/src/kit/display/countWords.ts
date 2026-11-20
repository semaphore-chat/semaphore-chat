/** What a count on an item means, in its accessible name: "3 unread", or "1 mention" / "3 mentions". */
export type CountMeaning = 'unread' | 'mentions';

export function countWords(count: number, meaning: CountMeaning): string {
  if (meaning === 'mentions') return count === 1 ? '1 mention' : `${count} mentions`;
  return `${count} unread`;
}

/** A count to draw: a finite number, floored; anything else is 0. */
export function drawnCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
