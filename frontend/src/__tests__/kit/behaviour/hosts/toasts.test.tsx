/**
 * The toast host on the real region, with fake timers: every reason to pause
 * and their combinations, rule 13 (a toast shown while a reason holds), rule 17
 * (a waiting toast that is not danger is dropped after its wait), a repeated
 * id, dismiss, the action, F6 and focus return, and the announcements.
 * The reducer vectors prove the queue; these prove the host's translation.
 */
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import {
  AppFrame,
  Button,
  Dialog,
  ToastRegion,
  useScreenFocusTarget,
  useToasts,
  type Toasts,
} from '../../../../kit';
import { useBehaviourHost, type BehaviourHostValue } from '../../../../kit/behaviour/hosts/hostContext';
import { tokens } from '../../../../theme/generated/tokens';
import { renderWithKit } from '../../../test-utils/renderWithKit';

const { toast: SHORT, toastAction: LONG, base: FADE } = tokens.motion;

let consoleError: MockInstance;
beforeEach(() => {
  vi.useFakeTimers();
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  vi.useRealTimers();
  setVisibility('visible');
});

let toasts: Toasts;
let host: BehaviourHostValue;
function Probe() {
  toasts = useToasts();
  host = useBehaviourHost();
  return null;
}

/** A screen with a button outside the region, an optional dialog, and the region. */
function Screen({ dialog = false }: { dialog?: boolean }) {
  const [open, setOpen] = useState(dialog);
  return (
    <>
      <Probe />
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Button onClick={() => undefined}>Elsewhere</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Settings"
        actions={<Button onClick={() => setOpen(false)}>Close</Button>}
      />
      <ToastRegion />
    </>
  );
}

/** The region, found in the DOM: under an open dialog MUI hides it from the accessibility tree. */
const region = () => document.querySelector<HTMLElement>('[data-kit-toast-region]');
const shownText = () => region()?.textContent ?? null;
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const show = (...args: Parameters<Toasts['show']>) => {
  let id = '';
  act(() => {
    id = toasts.show(...args);
  });
  return id;
};
const paused = () => host.toasts.machine.getState().paused;
const rootSlot = () => document.querySelector('[data-kit-live-slot="root"]') as HTMLElement;
const polite = (slot: HTMLElement = rootSlot()) => slot.querySelector('[aria-live="polite"]')?.textContent;
const assertive = (slot: HTMLElement = rootSlot()) => slot.querySelector('[aria-live="assertive"]')?.textContent;

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
}
function mouse(element: Element, inside: boolean) {
  const init = { pointerType: 'mouse' };
  if (inside) fireEvent.pointerEnter(element, init);
  else fireEvent.pointerLeave(element, init);
}

describe('toast host: showing and leaving', () => {
  it('shows a toast in the Notifications region, quiet itself, announced by the host, gone after its timer', () => {
    renderWithKit(<Screen />);
    expect(region()).toBeNull();
    show({ message: 'Saved', tone: 'positive' });
    expect(screen.getByRole('region', { name: 'Notifications' })).toBe(region());
    expect(shownText()).toContain('Saved');
    // The Toast is a quiet note: the host announces it, once, in the page's slot.
    expect(region()?.querySelector('[role="status"], [role="alert"]')).toBeNull();
    advance(SHORT - 1);
    expect(polite()).toBe('Saved');
    expect(region()).not.toBeNull();
    advance(1);
    expect(region()).toBeNull();
  });

  it('announces a danger toast assertively, with its action label after the message', () => {
    renderWithKit(<Screen />);
    show({ message: "Couldn't send", tone: 'danger', action: { label: 'Retry', onAction: () => undefined } });
    act(() => vi.advanceTimersToNextFrame());
    expect(assertive()).toBe("Couldn't send. Retry");
    expect(polite()).toBe('');
  });

  it('a repeated id replaces the toast in place and is announced again only when it changed', () => {
    renderWithKit(<Screen />);
    const id = show({ id: 'up', message: 'Uploading' });
    expect(id).toBe('up');
    advance(SHORT - 100);
    show({ id: 'up', message: 'Uploaded', tone: 'positive' });
    expect(screen.getAllByRole('region', { name: 'Notifications' })).toHaveLength(1);
    // Its timer started again.
    advance(SHORT - 1);
    expect(shownText()).toContain('Uploaded');
    expect(polite()).toBe('Uploaded');
    const say = vi.spyOn(host.announcer, 'say');
    show({ id: 'up', message: 'Uploaded', tone: 'positive' });
    expect(say).not.toHaveBeenCalled();
  });

  it('a fresh id each time without one; dismiss takes a toast away, showing or waiting', () => {
    renderWithKit(<Screen />);
    const a = show({ message: 'A' });
    const b = show({ message: 'B' });
    const c = show({ message: 'C' });
    expect(new Set([a, b, c]).size).toBe(3);
    act(() => toasts.dismiss(b));
    act(() => toasts.dismiss(a));
    expect(shownText()).toContain('C');
    act(() => toasts.dismiss('nobody'));
    expect(shownText()).toContain('C');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(region()).toBeNull();
  });

  it('the action runs its callback and dismisses the toast', () => {
    renderWithKit(<Screen />);
    const onAction = vi.fn();
    show({ message: 'Message deleted', action: { label: 'Undo', onAction } });
    show({ message: 'Next' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(shownText()).toContain('Next');
  });

  it('is rendered by AppFrame', () => {
    renderWithKit(
      <AppFrame>
        <Probe />
      </AppFrame>,
    );
    show({ message: 'Saved' });
    expect(shownText()).toContain('Saved');
  });
});

describe('toast host: reasons to pause', () => {
  it('pointer: a mouse over the region holds the toast; leaving starts the full time again', () => {
    renderWithKit(<Screen />);
    show({ message: 'Saved' });
    advance(SHORT - 100);
    mouse(region() as HTMLElement, true);
    expect(paused()).toBe(true);
    advance(LONG * 2);
    expect(region()).not.toBeNull();
    mouse(region() as HTMLElement, false);
    expect(paused()).toBe(false);
    advance(SHORT - 1);
    expect(region()).not.toBeNull();
    advance(1);
    expect(region()).toBeNull();
  });

  it('pointer: a touch does not hold it (there is no hover to end the pause)', () => {
    renderWithKit(<Screen />);
    show({ message: 'Saved' });
    fireEvent.pointerEnter(region() as HTMLElement, { pointerType: 'touch' });
    expect(paused()).toBe(false);
    advance(SHORT);
    expect(region()).toBeNull();
  });

  it('focus: focus inside holds it; focus leaving ends that reason', () => {
    renderWithKit(<Screen />);
    show({ message: 'Saved' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    act(() => dismiss.focus());
    expect(paused()).toBe(true);
    advance(LONG * 2);
    expect(region()).not.toBeNull();
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
    expect(paused()).toBe(false);
    advance(SHORT);
    expect(region()).toBeNull();
  });

  it('hidden: the page hidden, or the window blurred, holds it', () => {
    renderWithKit(<Screen />);
    show({ message: 'Saved' });
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(paused()).toBe(true);
    advance(LONG * 2);
    expect(region()).not.toBeNull();
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(paused()).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(paused()).toBe(true);
    advance(LONG * 2);
    expect(region()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(paused()).toBe(false);
    advance(SHORT);
    expect(region()).toBeNull();
  });

  it('modal: an open dialog holds it; closing the dialog ends that reason', () => {
    renderWithKit(<Screen />);
    show({ message: 'Saved' });
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(paused()).toBe(true);
    // Seen, but out of reach: the dialog hides the page, the region with it.
    expect(region()?.closest('[aria-hidden="true"]')).not.toBeNull();
    advance(LONG * 2);
    expect(shownText()).toContain('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(paused()).toBe(false);
    advance(SHORT);
    expect(region()).toBeNull();
  });

  it('several reasons are one pause: it resumes only when the last one ends, once', () => {
    renderWithKit(<Screen />);
    show({ message: 'Saved' });
    const send = vi.spyOn(host.toasts.machine, 'send');
    mouse(region() as HTMLElement, true);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    mouse(region() as HTMLElement, false);
    expect(paused()).toBe(true);
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(paused()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(paused()).toBe(false);
    const names = send.mock.calls.map(([event]) => Object.keys(event)[0]);
    expect(names.filter((name) => name === 'pause')).toHaveLength(1);
    expect(names.filter((name) => name === 'resume')).toHaveLength(1);
    advance(SHORT);
    expect(region()).toBeNull();
  });

  it('rule 13: a toast shown from empty while a reason holds is paused again', () => {
    renderWithKit(<Screen dialog />);
    show({ message: 'Saved' });
    expect(paused()).toBe(true);
    // Mounted after the dialog opened, so MUI did not hide it: it hides itself, and is out of reach.
    expect(region()?.getAttribute('aria-hidden')).toBe('true');
    expect(region()?.hasAttribute('inert')).toBe(true);
    advance(LONG * 2);
    expect(shownText()).toContain('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    advance(SHORT);
    expect(region()).toBeNull();
  });

  it('the pointer and focus reasons end when the region goes, so the next toast runs its timer', () => {
    renderWithKit(<Screen />);
    const id = show({ message: 'Saved' });
    mouse(region() as HTMLElement, true);
    // Dismissed by the caller while the pointer is on it: no pointerleave comes for a removed element.
    act(() => toasts.dismiss(id));
    expect(region()).toBeNull();
    expect(host.toasts.reasons().has('pointer')).toBe(false);
    show({ message: 'Next' });
    expect(paused()).toBe(false);
    advance(SHORT);
    expect(region()).toBeNull();
  });
});

describe('toast host: rule 17, a waiting toast that is not danger is dropped after its wait', () => {
  it('a success waiting behind a sticky danger toast is dropped at toastAction; a waiting danger toast is not', () => {
    renderWithKit(<Screen />);
    show({ message: "Couldn't send", tone: 'danger', action: { label: 'Retry', onAction: () => undefined } });
    show({ message: 'Saved', tone: 'positive' });
    show({ message: "Couldn't upload", tone: 'danger' });
    advance(LONG - 1);
    expect(host.toasts.machine.getState().queue.map((t) => t.message)).toEqual(['Saved', "Couldn't upload"]);
    advance(1);
    expect(host.toasts.machine.getState().queue.map((t) => t.message)).toEqual(["Couldn't upload"]);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(shownText()).toContain("Couldn't upload");
  });

  it('a toast that shows before its wait ends stays its full time', () => {
    renderWithKit(<Screen />);
    show({ message: 'Copied' });
    show({ message: 'Saved' });
    advance(SHORT);
    expect(shownText()).toContain('Saved');
    advance(SHORT - 1);
    expect(shownText()).toContain('Saved');
    advance(1);
    expect(region()).toBeNull();
  });

  it('the wait counts while the toast area is paused', () => {
    renderWithKit(<Screen />);
    show({ message: 'Copied' });
    show({ message: 'Saved' });
    mouse(region() as HTMLElement, true);
    advance(LONG);
    expect(host.toasts.machine.getState().queue).toEqual([]);
    mouse(region() as HTMLElement, false);
    advance(SHORT);
    expect(region()).toBeNull();
  });
});

describe('toast host: F6 and focus return', () => {
  it('F6 moves focus into the region and back to where it was', () => {
    renderWithKit(<Screen />);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => elsewhere.focus());
    show({ message: 'Saved' });
    expect(fireEvent.keyDown(elsewhere, { key: 'F6' })).toBe(false);
    expect(document.activeElement).toBe(region());
    expect(paused()).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, { key: 'F6', shiftKey: true });
    expect(document.activeElement).toBe(elsewhere);
    expect(paused()).toBe(false);
  });

  it('F6 does nothing with no toast, with a modifier, or while a dialog is open', () => {
    renderWithKit(<Screen />);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => elsewhere.focus());
    expect(fireEvent.keyDown(elsewhere, { key: 'F6' })).toBe(true);
    show({ message: 'Saved' });
    expect(fireEvent.keyDown(elsewhere, { key: 'F6', ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(elsewhere);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const inDialog = document.activeElement as Element;
    expect(fireEvent.keyDown(inDialog, { key: 'F6' })).toBe(true);
    expect(document.activeElement).toBe(inDialog);
  });

  it('dismissing with focus inside puts focus back where it was before the region', () => {
    renderWithKit(<Screen />);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    act(() => elsewhere.focus());
    show({ message: 'Saved' });
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(region()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('when that element is gone, focus goes to the screen focus target', () => {
    function Gone() {
      const [there, setThere] = useState(true);
      const target = useRef<HTMLButtonElement>(null);
      useScreenFocusTarget(target);
      return (
        <>
          <Probe />
          {there && <Button onClick={() => setThere(false)}>Goes away</Button>}
          <button ref={target} type="button">
            Composer
          </button>
          <ToastRegion />
        </>
      );
    }
    renderWithKit(<Gone />);
    const goes = screen.getByRole('button', { name: 'Goes away' });
    act(() => goes.focus());
    show({ message: 'Saved' });
    act(() => screen.getByRole('button', { name: 'Dismiss' }).focus());
    fireEvent.click(goes);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Composer' }));
  });
});

describe('toast host: under a dialog, and motion', () => {
  it('announces in the dialog, the topmost layer, not in the hidden page slot', () => {
    renderWithKit(<Screen dialog />);
    show({ message: 'Saved' });
    act(() => vi.advanceTimersToNextFrame());
    const slots = document.querySelectorAll<HTMLElement>('[data-kit-live-slot="layer"]');
    const top = slots[slots.length - 1];
    expect(screen.getByRole('dialog').closest('.MuiDialog-root')?.contains(top)).toBe(true);
    expect(polite(top)).toBe('Saved');
    expect(polite()).toBe('');
  });

  it('a toast that leaves fades out quietly and out of reach, then is removed', () => {
    renderWithKit(<Screen />);
    show({ message: 'Saved' });
    advance(SHORT);
    expect(region()).toBeNull();
    const leaving = document.querySelector('[data-leaving]');
    expect(leaving?.textContent).toContain('Saved');
    expect(leaving?.getAttribute('aria-hidden')).toBe('true');
    expect(leaving?.hasAttribute('inert')).toBe(true);
    advance(FADE);
    expect(document.querySelector('[data-leaving]')).toBeNull();
  });

  it('with reduced motion a toast that leaves is removed at once', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      renderWithKit(<Screen />);
      show({ message: 'Saved' });
      advance(SHORT);
      expect(document.querySelector('[data-leaving]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
