/**
 * Freeze `value` and everything reachable from it. A reducer that mutates the
 * state it is given then throws (test files run as ES modules, in strict mode)
 * instead of silently changing the caller's state.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
