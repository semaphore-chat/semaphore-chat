import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Spinner } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Spinner', () => {
  it('is hidden from assistive technology without a label', () => {
    const { container } = renderWithKit(<Spinner />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('is a named status with a label', () => {
    renderWithKit(<Spinner label="Loading messages" />);
    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeInTheDocument();
  });
});
