import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Toast } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Toast', () => {
  it.each([
    [undefined, 'status'],
    ['neutral', 'status'],
    ['positive', 'status'],
    ['danger', 'alert'],
  ] as const)('tone %s has role %s', (tone, role) => {
    renderWithKit(<Toast message="Saved" tone={tone} />);
    expect(screen.getByRole(role)).toHaveTextContent('Saved');
  });

  it('is a quiet note with announce false', () => {
    renderWithKit(<Toast message="Saved" tone="danger" announce={false} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('Saved');
  });

  it('calls the action handler', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<Toast message="Deleted" action={{ label: 'Undo', onClick }} />);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has a Dismiss button only with onClose', async () => {
    const onClose = vi.fn();
    const { user, rerender } = renderWithKit(<Toast message="Hi" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    rerender(<Toast message="Hi" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
