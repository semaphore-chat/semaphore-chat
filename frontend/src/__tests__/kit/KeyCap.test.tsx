import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { KeyCap } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('KeyCap', () => {
  it('renders a kbd with its text', () => {
    const { container } = renderWithKit(<KeyCap>Esc</KeyCap>);
    const kbd = container.querySelector('kbd');
    expect(kbd).not.toBeNull();
    expect(kbd).toHaveTextContent('Esc');
  });
});
