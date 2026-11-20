import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Alert, AppFrame } from '../../../kit';
import { tokens } from '../../../theme/generated/tokens';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { rulesFor } from '../cssRules';
import { fakeVisualViewport } from './visualViewport';

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

  describe('banner', () => {
    it('renders above the content, in the same frame', () => {
      renderWithKit(
        <AppFrame banner={<Alert severity="warning">Reconnecting</Alert>}>
          <p>inside</p>
        </AppFrame>,
      );
      const banner = screen.getByText('Reconnecting');
      const inside = screen.getByText('inside');
      expect(banner.compareDocumentPosition(inside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(banner.closest('[data-slot="banner"]')?.parentElement).toBe(inside.parentElement);
    });

    it.each([undefined, null, false, ''])('leaves no element for %j', (banner) => {
      renderWithKit(
        <AppFrame banner={banner}>
          <p>inside</p>
        </AppFrame>,
      );
      expect(document.querySelector('[data-slot="banner"]')).toBeNull();
    });
  });

  describe('on-screen keyboard', () => {
    const frame = () => screen.getByText('inside').parentElement as HTMLElement;
    const renderFrame = () =>
      renderWithKit(
        <AppFrame>
          <p>inside</p>
        </AppFrame>,
      );

    it('has no inset while the keyboard is down', () => {
      fakeVisualViewport(800);
      renderFrame();
      expect(frame().style.getPropertyValue('--kit-keyboard-inset')).toBe('0px');
      expect(frame()).not.toHaveAttribute('data-keyboard');
    });

    it('takes the height the keyboard covers off the frame, and drops the home-indicator padding', () => {
      const viewport = fakeVisualViewport(800);
      renderFrame();
      viewport.cover(300);
      expect(frame().style.getPropertyValue('--kit-keyboard-inset')).toBe('300px');
      expect(frame()).toHaveAttribute('data-keyboard');
      const css = rulesFor(frame(), '').map((rule) => rule.cssText).join(' ');
      expect(css).toContain('var(--kit-keyboard-inset)');
    });
  });
});
