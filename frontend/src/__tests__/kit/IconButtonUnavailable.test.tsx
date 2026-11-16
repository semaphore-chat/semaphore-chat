/**
 * IconButton `aria-disabled` (as Button's): not available, but still a Tab stop with its name, so a keyboard
 * or screen-reader user can find it and hear why; a press does not run `onClick` or start a hold, and calls
 * `onUnavailablePress` instead. `disabled` and `loading` win over it.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { IconButton } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const mute = () => screen.getByRole('button', { name: 'Mute' });

describe('IconButton aria-disabled', () => {
  it('stays focusable and named, reads as unavailable', () => {
    renderWithKit(<IconButton icon="MicOff" label="Mute" selected aria-disabled />);
    const button = mute();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.tabIndex).toBe(0);
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
  });

  it('a press does not run onClick; it calls onUnavailablePress', () => {
    const onClick = vi.fn();
    const onUnavailablePress = vi.fn();
    renderWithKit(<IconButton icon="MicOff" label="Mute" aria-disabled onClick={onClick} onUnavailablePress={onUnavailablePress} />);
    fireEvent.click(mute());
    expect(onClick).not.toHaveBeenCalled();
    expect(onUnavailablePress).toHaveBeenCalledTimes(1);
  });

  it('a held key says why once per press, not on every repeat', () => {
    const onUnavailablePress = vi.fn();
    renderWithKit(<IconButton icon="MicOff" label="Mute" aria-disabled onUnavailablePress={onUnavailablePress} />);
    const button = mute();
    // A native button clicks on each Enter keydown, repeats included.
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter', repeat: true });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter', repeat: true });
    fireEvent.click(button);
    fireEvent.keyUp(button, { key: 'Enter' });
    expect(onUnavailablePress).toHaveBeenCalledTimes(1);
    // The next press says it again.
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    expect(onUnavailablePress).toHaveBeenCalledTimes(2);
  });

  it('available again: a press runs onClick and not onUnavailablePress', () => {
    const onClick = vi.fn();
    const onUnavailablePress = vi.fn();
    const { rerender } = renderWithKit(
      <IconButton icon="MicOff" label="Mute" aria-disabled onClick={onClick} onUnavailablePress={onUnavailablePress} />,
    );
    rerender(<IconButton icon="MicOff" label="Mute" onClick={onClick} onUnavailablePress={onUnavailablePress} />);
    expect(mute()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(mute());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onUnavailablePress).not.toHaveBeenCalled();
  });

  it('does not start a hold, and a press says why', () => {
    const hold = { onStart: vi.fn(), onEnd: vi.fn() };
    const onUnavailablePress = vi.fn();
    renderWithKit(<IconButton icon="Mic" label="Mute" hold={hold} aria-disabled onUnavailablePress={onUnavailablePress} />);
    fireEvent.pointerDown(mute(), { pointerId: 1, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(mute(), { pointerId: 1 });
    fireEvent.click(mute());
    expect(hold.onStart).not.toHaveBeenCalled();
    expect(hold.onEnd).not.toHaveBeenCalled();
    expect(onUnavailablePress).toHaveBeenCalledTimes(1);
  });

  it('ends a running hold when the button becomes unavailable', () => {
    const hold = { onStart: vi.fn(), onEnd: vi.fn() };
    const { rerender } = renderWithKit(<IconButton icon="Mic" label="Mute" hold={hold} />);
    fireEvent.pointerDown(mute(), { pointerId: 1, button: 0, pointerType: 'touch' });
    expect(hold.onStart).toHaveBeenCalledTimes(1);
    rerender(<IconButton icon="Mic" label="Mute" hold={hold} aria-disabled />);
    expect(hold.onEnd).toHaveBeenCalledTimes(1);
  });

  it('disabled wins: out of the Tab order, no aria-disabled, nothing called', () => {
    const onUnavailablePress = vi.fn();
    renderWithKit(<IconButton icon="MicOff" label="Mute" disabled aria-disabled onUnavailablePress={onUnavailablePress} />);
    expect(mute()).toBeDisabled();
    expect(mute()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(mute());
    expect(onUnavailablePress).not.toHaveBeenCalled();
  });

  it('loading wins: busy, and a press calls neither', () => {
    const onClick = vi.fn();
    const onUnavailablePress = vi.fn();
    renderWithKit(
      <IconButton icon="MicOff" label="Mute" loading aria-disabled onClick={onClick} onUnavailablePress={onUnavailablePress} />,
    );
    expect(mute()).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(mute());
    expect(onClick).not.toHaveBeenCalled();
    expect(onUnavailablePress).not.toHaveBeenCalled();
  });
});
