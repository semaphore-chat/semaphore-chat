import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Alert } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Alert', () => {
  it.each([
    ['info', 'status'],
    ['success', 'status'],
    ['warning', 'alert'],
    ['danger', 'alert'],
  ] as const)('%s has role %s', (severity, role) => {
    renderWithKit(<Alert severity={severity}>Something happened</Alert>);
    expect(screen.getByRole(role)).toHaveTextContent('Something happened');
  });

  it.each([['info'], ['success'], ['warning'], ['danger']] as const)(
    'a %s alert present at page load (announce false) is a quiet note',
    (severity) => {
      renderWithKit(
        <Alert severity={severity} announce={false}>
          Static
        </Alert>,
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('note')).toHaveTextContent('Static');
    },
  );

  it('renders the title and the body', () => {
    renderWithKit(
      <Alert severity="info" title="Heads up">
        Body text
      </Alert>,
    );
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('calls the action handler', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(
      <Alert severity="warning" action={{ label: 'Retry', onClick }}>
        Failed
      </Alert>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has a Dismiss button only with onClose', async () => {
    const onClose = vi.fn();
    const { user, rerender } = renderWithKit(<Alert severity="info">Hi</Alert>);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    rerender(
      <Alert severity="info" onClose={onClose}>
        Hi
      </Alert>,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Alert secondaryAction (K5)', () => {
  it('shows both actions, in order, and each runs its own handler', async () => {
    const join = vi.fn();
    const decline = vi.fn();
    const { user } = renderWithKit(
      <Alert severity="info" action={{ label: 'Join', onClick: join }} secondaryAction={{ label: 'Decline', onClick: decline }}>
        dropbear is calling you in Squad Up.
      </Alert>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Join', 'Decline']);
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(decline).toHaveBeenCalledTimes(1);
    expect(join).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(join).toHaveBeenCalledTimes(1);
  });

  it('works without a primary action, and the row wraps instead of overflowing', () => {
    renderWithKit(
      <Alert severity="info" secondaryAction={{ label: 'Not now', onClick: () => undefined }}>
        text
      </Alert>,
    );
    const button = screen.getByRole('button', { name: 'Not now' });
    expect(getComputedStyle(button.parentElement as HTMLElement).flexWrap).toBe('wrap');
  });
});
