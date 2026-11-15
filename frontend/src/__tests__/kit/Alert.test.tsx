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
