/**
 * A set that holds at most `limit` entries: adding one past the limit drops the oldest.
 * Re-adding an entry makes it the newest.
 */
export interface BoundedSet<T> {
  add: (value: T) => void;
  has: (value: T) => boolean;
  readonly size: number;
}

export function createBoundedSet<T>(limit: number): BoundedSet<T> {
  const items = new Set<T>();
  return {
    add(value) {
      items.delete(value);
      items.add(value);
      if (items.size > limit) {
        const oldest = items.values().next();
        if (!oldest.done) items.delete(oldest.value);
      }
    },
    has: (value) => items.has(value),
    get size() {
      return items.size;
    },
  };
}
