import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { LinearProgress } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('LinearProgress', () => {
  it('is a progressbar named by its label', () => {
    renderWithKit(<LinearProgress label="Uploading" value={40} />);
    const bar = screen.getByRole('progressbar', { name: 'Uploading' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it.each([
    [-5, '0'],
    [250, '100'],
    [Number.NaN, '0'],
    [0, '0'],
    [100, '100'],
  ])('clamps %s to %s', (value, expected) => {
    renderWithKit(<LinearProgress label="p" value={value} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected);
  });

  it('omits aria-valuenow when indeterminate', () => {
    renderWithKit(<LinearProgress label="Working" />);
    expect(screen.getByRole('progressbar', { name: 'Working' })).not.toHaveAttribute('aria-valuenow');
  });
});
