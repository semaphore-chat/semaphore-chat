/**
 * While the new shell is mounted the viewport meta asks for `interactive-widget=resizes-content`; the exact earlier
 * content comes back on unmount, also under React's strict mode (mount, unmount, mount).
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useInteractiveWidgetResizesContent, withResizesContent } from '../../shell/lounge/viewportWidget';

const ORIGINAL = 'initial-scale=1, width=device-width, viewport-fit=cover';

function Probe() {
  useInteractiveWidgetResizesContent();
  return null;
}

let meta: HTMLMetaElement;
beforeEach(() => {
  meta = document.createElement('meta');
  meta.name = 'viewport';
  meta.content = ORIGINAL;
  document.head.appendChild(meta);
});
afterEach(() => meta.remove());

describe('withResizesContent', () => {
  it('adds the setting, and replaces another value of it', () => {
    expect(withResizesContent(ORIGINAL)).toBe(`${ORIGINAL}, interactive-widget=resizes-content`);
    expect(withResizesContent('width=device-width, interactive-widget=overlays-content')).toBe(
      'width=device-width, interactive-widget=resizes-content',
    );
    expect(withResizesContent('')).toBe('interactive-widget=resizes-content');
  });
});

describe('useInteractiveWidgetResizesContent', () => {
  it('sets it while mounted and restores the exact content on unmount, in strict mode', () => {
    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(meta.getAttribute('content')).toBe(`${ORIGINAL}, interactive-widget=resizes-content`);
    unmount();
    expect(meta.getAttribute('content')).toBe(ORIGINAL);
  });

  it('restores a meta that had no content to having none', () => {
    meta.removeAttribute('content');
    const { unmount } = render(<Probe />);
    expect(meta.getAttribute('content')).toBe('interactive-widget=resizes-content');
    unmount();
    expect(meta.hasAttribute('content')).toBe(false);
  });
});
