/**
 * data/pwa.ts: the browser-app notices both shells show (network gone, a web update waiting, the
 * install offer), headless.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { setUpdateAvailable, setUpdateDeferred, setUpdateSW, _resetSwUpdateForTests } from '../../utils/swUpdate';

const installPrompt = vi.hoisted(() => ({
  value: { isInstallable: false, isIOS: false, install: vi.fn(async () => true), dismiss: vi.fn() },
}));
vi.mock('../../hooks/useInstallPrompt', () => ({ useInstallPrompt: () => installPrompt.value }));

import { useBrowserOnline, useInstallOffer, useWebUpdate } from '../../data/pwa';

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  _resetSwUpdateForTests();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  installPrompt.value = { isInstallable: false, isIOS: false, install: vi.fn(async () => true), dismiss: vi.fn() };
});

describe('useBrowserOnline', () => {
  it('follows the browser going offline and back', () => {
    const { result } = renderHook(() => useBrowserOnline());
    expect(result.current).toBe(true);
    act(() => setOnline(false));
    expect(result.current).toBe(false);
    act(() => setOnline(true));
    expect(result.current).toBe(true);
  });
});

describe('useWebUpdate', () => {
  it('is null until an update waits, and null again while it is deferred (a call)', () => {
    const { result } = renderHook(() => useWebUpdate());
    expect(result.current).toBeNull();
    act(() => setUpdateAvailable(true));
    expect(result.current).not.toBeNull();
    act(() => setUpdateDeferred(true));
    expect(result.current).toBeNull();
  });

  it('reload applies the update once, however often it is pressed; a failure allows another try', async () => {
    const updateSW = vi.fn().mockRejectedValueOnce(new Error('no sw')).mockResolvedValue(undefined);
    setUpdateSW(updateSW);
    setUpdateAvailable(true);
    const { result } = renderHook(() => useWebUpdate());
    await act(async () => {
      result.current!.reload();
    });
    expect(updateSW).toHaveBeenCalledTimes(1);
    expect(result.current!.reloading).toBe(false);
    act(() => result.current!.reload());
    act(() => result.current!.reload());
    expect(updateSW).toHaveBeenCalledTimes(2);
    expect(updateSW).toHaveBeenCalledWith(true);
  });
});

describe('useInstallOffer', () => {
  it('is null when the app is not installable', () => {
    expect(renderHook(() => useInstallOffer()).result.current).toBeNull();
  });

  it('installs through the browser prompt and puts the offer away when accepted', async () => {
    installPrompt.value = { ...installPrompt.value, isInstallable: true };
    const { result } = renderHook(() => useInstallOffer());
    expect(result.current?.ios).toBe(false);
    await act(async () => {
      await result.current!.install();
    });
    expect(installPrompt.value.install).toHaveBeenCalledTimes(1);
    expect(installPrompt.value.dismiss).toHaveBeenCalledTimes(1);
  });

  it('says iOS (manual steps) and keeps the offer when the prompt is declined', async () => {
    installPrompt.value = { ...installPrompt.value, isInstallable: true, isIOS: true, install: vi.fn(async () => false) };
    const { result } = renderHook(() => useInstallOffer());
    expect(result.current?.ios).toBe(true);
    await act(async () => {
      await result.current!.install();
    });
    expect(installPrompt.value.dismiss).not.toHaveBeenCalled();
  });
});
