import { act } from '@testing-library/react';
import { afterEach } from 'vitest';

const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');

afterEach(() => {
  if (descriptor) {
    Object.defineProperty(window, 'visualViewport', descriptor);
  } else {
    // @ts-expect-error the property is deleted on purpose
    delete window.visualViewport;
  }
});

/**
 * Installs a fake `window.visualViewport` on a window `innerHeight` px tall. `cover(px)` makes the on-screen
 * keyboard cover `px` of it (the visual viewport shrinks) and fires `resize`, inside `act`.
 */
export function fakeVisualViewport(innerHeight = 800): {
  cover: (px: number) => void;
  set: (values: { height?: number; offsetTop?: number; scale?: number }) => void;
  listeners: () => number;
} {
  const target = new EventTarget();
  const viewport = Object.assign(target, { height: innerHeight, offsetTop: 0, scale: 1 });
  let count = 0;
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (...args: Parameters<typeof add>) => {
    count += 1;
    add(...args);
  };
  target.removeEventListener = (...args: Parameters<typeof remove>) => {
    count -= 1;
    remove(...args);
  };
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  return {
    cover: (px) => {
      viewport.height = innerHeight - px;
      act(() => {
        target.dispatchEvent(new Event('resize'));
      });
    },
    set: (values) => {
      Object.assign(viewport, values);
      act(() => {
        target.dispatchEvent(new Event('scroll'));
      });
    },
    listeners: () => count,
  };
}
