import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Skeleton } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Skeleton', () => {
  it.each([
    ['text', <Skeleton key="t" shape="text" />],
    ['circle', <Skeleton key="c" shape="circle" size="lg" />],
    ['rect', <Skeleton key="r" shape="rect" height="lg" />],
  ])('renders the %s shape hidden from assistive technology', (_name, ui) => {
    const { container } = renderWithKit(ui);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders one bar per line', () => {
    const { container } = renderWithKit(<Skeleton shape="text" lines={3} />);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it.each([[0], [-3], [Number.NaN], [Number.POSITIVE_INFINITY], [1e9], [2.7]])(
    'keeps lines=%s within a sane range',
    (lines) => {
      const { container } = renderWithKit(<Skeleton shape="text" lines={lines} />);
      const count = container.firstElementChild?.children.length ?? 0;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(20);
    },
  );

  it('renders one line by default', () => {
    const { container } = renderWithKit(<Skeleton shape="text" />);
    expect(container.firstElementChild?.children).toHaveLength(1);
  });
});
