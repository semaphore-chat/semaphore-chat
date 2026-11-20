import type { Ref } from 'react';

/** Sets a function or object ref, so a component can pass one element to its own ref and the caller's. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}
