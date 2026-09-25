import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useElectronAPI } from '../../contexts/ElectronContext';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createElectronWrapper } from '../test-utils';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

describe('useElectronAPI', () => {
  it('without a provider, returns null in a web browser', () => {
    const { result } = renderHook(() => useElectronAPI());
    expect(result.current).toBeNull();
  });

  it('without a provider, returns the global bridge (getElectronAPI)', () => {
    const fake = createFakeElectronAPI();
    setElectronAPIOverride(fake);
    const { result } = renderHook(() => useElectronAPI());
    expect(result.current).toBe(fake);
  });

  it('returns the API an ElectronProvider gives it', () => {
    const fake = createFakeElectronAPI();
    const { result } = renderHook(() => useElectronAPI(), { wrapper: createElectronWrapper(fake) });
    expect(result.current).toBe(fake);
  });

  it('an ElectronProvider with null means a web browser, even over a global bridge', () => {
    setElectronAPIOverride(createFakeElectronAPI());
    const { result } = renderHook(() => useElectronAPI(), { wrapper: createElectronWrapper(null) });
    expect(result.current).toBeNull();
  });

  it('an ElectronProvider treats an object without isElectron: true as no bridge', () => {
    const { result } = renderHook(() => useElectronAPI(), {
      wrapper: createElectronWrapper({ platform: 'linux' }),
    });
    expect(result.current).toBeNull();
  });
});
