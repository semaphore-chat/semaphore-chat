/**
 * The install offer's dismissal is one piece of state per browser (review I2): the old shell's snackbar
 * and the new shell's banner each call useInstallPrompt; dismissing in one holds in the other at once,
 * and a stored dismissal is known on the first render (no flash of the banner on entry).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../utils/platform', () => ({ isElectron: () => false, isDesktopBrowser: () => false }));

import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { _resetInstallPromptForTests } from '../../utils/installPrompt';

beforeEach(() => {
  _resetInstallPromptForTests();
  localStorage.clear();
  // iOS: installable without a captured prompt (the case that flashed).
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });
});

describe('the shared install dismissal', () => {
  it('dismissing in one caller hides the offer in the other at once', () => {
    const classic = renderHook(() => useInstallPrompt());
    const lounge = renderHook(() => useInstallPrompt());
    expect(classic.result.current.isInstallable).toBe(true);
    expect(lounge.result.current.isInstallable).toBe(true);
    act(() => lounge.result.current.dismiss());
    expect(lounge.result.current.isInstallable).toBe(false);
    expect(classic.result.current.isInstallable).toBe(false);
  });

  it('a stored dismissal is known on the first render', () => {
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    const renders: boolean[] = [];
    renderHook(() => {
      const { isInstallable } = useInstallPrompt();
      renders.push(isInstallable);
    });
    expect(renders[0]).toBe(false);
    expect(renders.every((value) => value === false)).toBe(true);
  });

  it('an expired dismissal offers again', () => {
    localStorage.setItem('pwa-install-dismissed', String(Date.now() - 8 * 24 * 60 * 60 * 1000));
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstallable).toBe(true);
  });
});
