import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { transientProps } from '../../kit/theme/transientProps';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('transientProps', () => {
  it('stops $-prefixed props and forwards the rest', () => {
    expect(transientProps('$selected')).toBe(false);
    expect(transientProps('disabled')).toBe(true);
    expect(transientProps('aria-label')).toBe(true);
  });
});
