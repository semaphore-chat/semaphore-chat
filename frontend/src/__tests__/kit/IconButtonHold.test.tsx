import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { IconButton } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function setup(props: { disabled?: boolean } = {}) {
  const hold = { onStart: vi.fn(), onEnd: vi.fn() };
  const view = renderWithKit(<IconButton icon="Mic" label="Hold to talk" hold={hold} {...props} />);
  return { hold, button: screen.getByRole('button', { name: 'Hold to talk' }), ...view };
}

describe('IconButton hold', () => {
  it('starts on pointer down with capture and ends once on pointer up', () => {
    const { hold, button } = setup();
    fireEvent.pointerDown(button, { pointerId: 3, button: 0, pointerType: 'touch' });
    expect(hold.onStart).toHaveBeenCalledTimes(1);
    expect(button.setPointerCapture).toHaveBeenCalledWith(3);
    expect(hold.onEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(button, { pointerId: 3 });
    // The lost capture that follows a pointer up ends nothing more.
    fireEvent.lostPointerCapture(button, { pointerId: 3 });
    expect(hold.onEnd).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pointer cancel', (b: HTMLElement) => fireEvent.pointerCancel(b, { pointerId: 1 })],
    ['lost pointer capture', (b: HTMLElement) => fireEvent.lostPointerCapture(b, { pointerId: 1 })],
  ])('ends on %s', (_name, end) => {
    const { hold, button } = setup();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'mouse' });
    end(button);
    expect(hold.onEnd).toHaveBeenCalledTimes(1);
  });

  it('keeps holding while the pointer leaves the button (it is captured)', () => {
    const { hold, button } = setup();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch' });
    fireEvent.pointerLeave(button, { pointerId: 1 });
    fireEvent.pointerOut(button, { pointerId: 1 });
    expect(hold.onEnd).not.toHaveBeenCalled();
  });

  it('ends a running hold when it unmounts', () => {
    const { hold, button, unmount } = setup();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch' });
    unmount();
    expect(hold.onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not end anything on unmount when no hold runs', () => {
    const { hold, unmount } = setup();
    unmount();
    expect(hold.onEnd).not.toHaveBeenCalled();
  });

  it('ends a running hold when the button becomes disabled, with the callbacks of that moment', () => {
    const { hold, button, rerender } = setup();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch' });
    const later = { onStart: vi.fn(), onEnd: vi.fn() };
    rerender(<IconButton icon="Mic" label="Hold to talk" hold={later} disabled />);
    expect(hold.onEnd).not.toHaveBeenCalled();
    expect(later.onEnd).toHaveBeenCalledTimes(1);
  });

  it('a disabled button never starts', () => {
    const { hold, button } = setup({ disabled: true });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch' });
    expect(hold.onStart).not.toHaveBeenCalled();
  });

  it('ignores a secondary mouse button and a second pointer while holding', () => {
    const { hold, button } = setup();
    fireEvent.pointerDown(button, { pointerId: 1, button: 2, pointerType: 'mouse' });
    expect(hold.onStart).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch' });
    fireEvent.pointerDown(button, { pointerId: 2, button: 0, pointerType: 'touch' });
    expect(hold.onStart).toHaveBeenCalledTimes(1);
  });

  it("only the holding pointer ends the hold: a second finger's tap on the button does not", () => {
    const { hold, button } = setup();
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch' });
    // Finger 2 taps the button: not a new hold, and its lift, cancel or lost capture ends nothing.
    fireEvent.pointerDown(button, { pointerId: 2, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(button, { pointerId: 2 });
    fireEvent.pointerCancel(button, { pointerId: 2 });
    fireEvent.lostPointerCapture(button, { pointerId: 2 });
    expect(hold.onEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(hold.onEnd).toHaveBeenCalledTimes(1);
    expect(hold.onStart).toHaveBeenCalledTimes(1);
  });

  it('blocks the long-press menu and has no pressed state', () => {
    const { button } = setup();
    // fireEvent returns false when a handler prevented the default.
    expect(fireEvent.contextMenu(button)).toBe(false);
    expect(button).not.toHaveAttribute('aria-pressed');
  });

  it('a plain IconButton keeps the long-press menu', () => {
    renderWithKit(<IconButton icon="Mic" label="Mute" />);
    expect(fireEvent.contextMenu(screen.getByRole('button', { name: 'Mute' }))).toBe(true);
  });
});

describe('IconButton hold, when the button stops being a hold control mid-hold', () => {
  it('ends the hold with the callbacks it had', () => {
    const hold = { onStart: vi.fn(), onEnd: vi.fn() };
    const { rerender } = renderWithKit(<IconButton icon="Mic" label="Mic" hold={hold} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mic' }), { pointerId: 1, button: 0, pointerType: 'touch' });
    rerender(<IconButton icon="Mic" label="Mic" onClick={() => {}} />);
    expect(hold.onEnd).toHaveBeenCalledTimes(1);
  });
});
