import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { AppFrame } from '../../../kit';
import { tokens } from '../../../theme/generated/tokens';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { rulesFor } from '../cssRules';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('AppFrame', () => {
  it('renders its children and adds no landmark of its own', () => {
    renderWithKit(
      <AppFrame>
        <p>inside</p>
      </AppFrame>,
    );
    expect(screen.getByText('inside')).toBeInTheDocument();
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  // A guard on the mechanism: jsdom does not lay out, so the declarations are read from the rule.
  it('fills the viewport without a page scroll, inset by the gutter and the safe areas', () => {
    renderWithKit(
      <AppFrame>
        <p>inside</p>
      </AppFrame>,
    );
    const frame = screen.getByText('inside').parentElement as HTMLElement;
    const css = rulesFor(frame, '')
      .map((rule) => rule.cssText)
      .join(' ');
    expect(css).toContain('100dvh');
    expect(css).toContain('100vh');
    expect(css).toContain('overflow: hidden');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`env(safe-area-inset-${side})`);
    }
    expect(css).toContain(`${tokens.layout.gutter}px`);
  });
});
