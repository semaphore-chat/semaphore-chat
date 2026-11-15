/**
 * Fakes the on-screen keyboard for a story: the visual viewport reports `KEYBOARD_SHARE` of the window less, as
 * a phone browser does while the keyboard is up, so `useKeyboardInset` (and `AppFrame`) see a keyboard. Put back
 * on unmount.
 */
import { useEffect, useState, type JSX, type ReactNode } from 'react';

/** How much of the window the faked keyboard covers (browser-tests/toast-region.spec.ts uses the same share). */
export const KEYBOARD_SHARE = 0.36;

let restore: (() => void) | undefined;

export function FakeKeyboard({ children }: { children: ReactNode }): JSX.Element {
  useState(() => {
    const real = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const fake = {
      get height() {
        return window.innerHeight - Math.round(window.innerHeight * KEYBOARD_SHARE);
      },
      offsetTop: 0,
      scale: 1,
      addEventListener: (_: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener),
      removeEventListener: (_: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    restore = () => {
      if (real) Object.defineProperty(window, 'visualViewport', real);
    };
    return null;
  });
  useEffect(() => () => restore?.(), []);
  return <>{children}</>;
}
