import { act } from '@testing-library/react';
import { afterEach } from 'vitest';
import { tokens } from '../../../theme/generated/tokens';

/** A viewport width inside each range. */
export const WIDTH = {
  phone: tokens.breakpoint.phone - 1,
  compact: tokens.breakpoint.docked - 1,
  wide: tokens.breakpoint.docked,
} as const;

type Listener = (event: MediaQueryListEvent) => void;

interface Fake {
  query: string;
  listeners: Set<Listener>;
}

/** Evaluates the two query shapes the layouts use: `(min-width: Npx)` and `not all and (min-width: Npx)`. */
function evaluate(query: string, width: number): boolean {
  const match = /(not all and )?\(min-width: (\d+(?:\.\d+)?)px\)$/.exec(query);
  if (match === null) {
    throw new Error(`The matchMedia fake does not understand "${query}"`);
  }
  const min = Number(match[2]);
  return match[1] === undefined ? width >= min : width < min;
}

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

/**
 * Installs a `window.matchMedia` for a viewport of `width`. `setWidth` moves the viewport and fires
 * the change events, inside `act`.
 */
export function mockViewport(width: number): { setWidth: (next: number) => void } {
  let current = width;
  const fakes: Fake[] = [];
  window.matchMedia = ((query: string) => {
    const fake: Fake = { query, listeners: new Set() };
    fakes.push(fake);
    return {
      get matches() {
        return evaluate(query, current);
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: Listener) => fake.listeners.add(listener),
      removeEventListener: (_: string, listener: Listener) => fake.listeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    setWidth: (next) => {
      current = next;
      act(() => {
        for (const fake of fakes) {
          for (const listener of fake.listeners) {
            listener({ matches: evaluate(fake.query, next), media: fake.query } as MediaQueryListEvent);
          }
        }
      });
    },
  };
}

/** Removes `window.matchMedia`, as in an environment without it. */
export function removeMatchMedia(): void {
  // @ts-expect-error the property is deleted on purpose
  delete window.matchMedia;
}
