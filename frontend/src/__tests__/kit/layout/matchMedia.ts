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

/**
 * Evaluates a media query against a width. It understands every shape `media` builds: `(min-width: N)`,
 * `not all and (min-width: N)` and `(min-width: A) and (not (min-width: B))`. Anything else throws, so a new
 * query form cannot slip through unchecked.
 */
export function matches(query: string, width: number): boolean {
  // The touch-device query (`data/touchFirst`): the fake is a mouse-and-keyboard device.
  if (query === '(hover: none) and (pointer: coarse)') return false;
  const px = '(\\d+(?:\\.\\d+)?)px';
  const below = new RegExp(`^not all and \\(min-width: ${px}\\)$`).exec(query);
  if (below) {
    return width < Number(below[1]);
  }
  const between = new RegExp(`^\\(min-width: ${px}\\) and \\(not \\(min-width: ${px}\\)\\)$`).exec(query);
  if (between) {
    return width >= Number(between[1]) && width < Number(between[2]);
  }
  const above = new RegExp(`^\\(min-width: ${px}\\)$`).exec(query);
  if (above) {
    return width >= Number(above[1]);
  }
  throw new Error(`The matchMedia fake does not understand "${query}"`);
}

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
});

/**
 * Installs a `window.matchMedia` for a viewport of `width`. `await setWidth(n)` moves the viewport and fires
 * the change events, inside `act`.
 */
export function mockViewport(width: number): { setWidth: (next: number) => Promise<void> } {
  let current = width;
  const fakes: Fake[] = [];
  window.matchMedia = ((query: string) => {
    const fake: Fake = { query, listeners: new Set() };
    fakes.push(fake);
    return {
      get matches() {
        return matches(query, current);
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
    // Async, because a layout may move focus when the width changes, and the blur it causes updates state.
    setWidth: async (next) => {
      current = next;
      await act(async () => {
        for (const fake of fakes) {
          for (const listener of fake.listeners) {
            listener({ matches: matches(fake.query, next), media: fake.query } as MediaQueryListEvent);
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
