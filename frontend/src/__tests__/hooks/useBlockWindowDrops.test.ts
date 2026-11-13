import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBlockWindowDrops } from '../../hooks/useBlockWindowDrops';
import { createElectronWrapper, createFakeElectronAPI } from '../test-utils';

function dispatch(type: 'dragover' | 'drop', target: EventTarget = document.body, preventFirst = false) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  if (preventFirst) event.preventDefault();
  target.dispatchEvent(event);
  return event;
}

/**
 * WEB-3: a file dropped anywhere in the desktop window but the message box
 * must not make the window open it (the dropped page would get the bridge).
 */
describe('useBlockWindowDrops', () => {
  it('Electron: a drop outside a drop zone does not open the file', () => {
    const { unmount } = renderHook(() => useBlockWindowDrops(), {
      wrapper: createElectronWrapper(createFakeElectronAPI()),
    });

    expect(dispatch('dragover').defaultPrevented).toBe(true);
    expect(dispatch('drop').defaultPrevented).toBe(true);

    unmount();
    expect(dispatch('drop').defaultPrevented).toBe(false);
  });

  it('web: leaves drops alone', () => {
    renderHook(() => useBlockWindowDrops(), { wrapper: createElectronWrapper(null) });

    expect(dispatch('dragover').defaultPrevented).toBe(false);
    expect(dispatch('drop').defaultPrevented).toBe(false);
  });
});
