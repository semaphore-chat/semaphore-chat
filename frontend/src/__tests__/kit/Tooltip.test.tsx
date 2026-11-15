import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { IconButton, Tooltip } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function Subject() {
  return (
    <>
      <Tooltip label="Mute microphone">
        <IconButton icon="Mic" label="Mute" />
      </Tooltip>
      <button>other</button>
    </>
  );
}

const button = () => screen.getByRole('button', { name: 'Mute' });

describe('Tooltip', () => {
  it('is hidden at first', () => {
    renderWithKit(<Subject />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button()).not.toHaveAttribute('aria-describedby');
  });

  it('shows on keyboard focus and describes the child', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.tab();
    expect(button()).toHaveFocus();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Mute microphone');
    expect(button()).toHaveAttribute('aria-describedby', tip.id);
    expect(button()).toHaveAccessibleDescription('Mute microphone');
  });

  it('hides on blur and removes the description', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.tab();
    await screen.findByRole('tooltip');
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(button()).not.toHaveAttribute('aria-describedby');
  });

  it('hides on Escape without closing anything around it', async () => {
    const outer = vi.fn();
    const { user } = renderWithKit(
      <div role="presentation" onKeyDown={outer}>
        <Subject />
      </div>,
    );
    await user.tab();
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(outer).not.toHaveBeenCalled();
  });

  it('shows after a delay on mouse hover and hides when the pointer leaves', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.hover(button());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Mute microphone');
    await user.unhover(button());
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('a pointer that leaves before the delay never shows it', async () => {
    vi.useFakeTimers();
    try {
      renderWithKit(<Subject />);
      fireEvent.pointerEnter(button(), { pointerType: 'mouse' });
      fireEvent.pointerLeave(button(), { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a touch pointer never shows it', () => {
    vi.useFakeTimers();
    try {
      renderWithKit(<Subject />);
      fireEvent.pointerEnter(button(), { pointerType: 'touch' });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds text only', async () => {
    const { user } = renderWithKit(<Subject />);
    await user.tab();
    const tip = await screen.findByRole('tooltip');
    expect(tip.querySelector('button, a, input, [tabindex]')).toBeNull();
  });
});
