import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { IconButton } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('IconButton', () => {
  it('takes its accessible name from label', () => {
    renderWithKit(<IconButton icon="Settings" label="Settings" />);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('type', 'button');
  });

  it('requires a label', () => {
    renderWithKit(
      // @ts-expect-error -- label is the accessible name and is required.
      <IconButton icon="Settings" />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('sets aria-pressed only when selected is given', () => {
    renderWithKit(
      <>
        <IconButton icon="Mic" label="On" selected />
        <IconButton icon="Mic" label="Off" selected={false} />
        <IconButton icon="Mic" label="None" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'None' })).not.toHaveAttribute('aria-pressed');
  });

  it('calls onClick for a click and for Enter', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<IconButton icon="Settings" label="Settings" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Settings' });
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('while loading keeps focus, shows a spinner and blocks activation', async () => {
    const onClick = vi.fn();
    const { user, rerender } = renderWithKit(
      <IconButton icon="Settings" label="Settings" onClick={onClick} />,
    );
    const button = screen.getByRole('button', { name: 'Settings' });
    button.focus();
    rerender(<IconButton icon="Settings" label="Settings" onClick={onClick} loading />);

    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
    expect(screen.getByRole('progressbar', { hidden: true })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is natively disabled when disabled', () => {
    renderWithKit(<IconButton icon="Settings" label="Settings" disabled />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDisabled();
  });

  it('is a square of the control token for each size', () => {
    renderWithKit(
      <>
        <IconButton icon="Mic" label="S" size="sm" />
        <IconButton icon="Mic" label="M" />
        <IconButton icon="Mic" label="L" size="lg" />
      </>,
    );
    const style = (name: string) => getComputedStyle(screen.getByRole('button', { name }));
    expect(style('S').width).toBe(`${tokens.control.sm}px`);
    expect(style('S').height).toBe(`${tokens.control.sm}px`);
    expect(style('M').width).toBe('40px');
    expect(style('M').height).toBe('40px');
    expect(style('L').width).toBe(`${tokens.control.lg}px`);
  });

  it('forwards ref and id and passes the aria props through', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithKit(
      <IconButton
        ref={ref}
        id="more"
        icon="Copy"
        label="More"
        aria-haspopup="menu"
        aria-expanded={false}
        aria-controls="menu-1"
        title="More actions"
      />,
    );
    const button = screen.getByRole('button', { name: 'More' });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute('id', 'more');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'menu-1');
    expect(button).toHaveAttribute('title', 'More actions');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <IconButton icon="Settings" label="Settings" className="x" />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('while loading, Space is blocked as well as Enter', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<IconButton icon="Settings" label="Settings" onClick={onClick} loading />);
    screen.getByRole('button', { name: 'Settings' }).focus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled wins over loading: disabled, not busy, the icon stays and no spinner shows', () => {
    const { container } = renderWithKit(<IconButton icon="Settings" label="Settings" disabled loading />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
