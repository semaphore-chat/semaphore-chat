import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../utils/platform', () => ({
  isElectron: vi.fn(() => false),
  isWeb: vi.fn(() => true),
}));

vi.mock('../../utils/serverStorage', () => ({
  getActiveServer: vi.fn(() => null),
}));

import { getInstanceUrl } from '../../config/env';
import { isElectron } from '../../utils/platform';
import { getActiveServer } from '../../utils/serverStorage';

describe('getInstanceUrl', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to web defaults
    vi.mocked(isElectron).mockReturnValue(false);
    vi.mocked(getActiveServer).mockReturnValue(null);
  });

  afterEach(() => {
    // Restore original location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('returns window.location.origin in web browser', () => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://kraken.example.com' },
      writable: true,
      configurable: true,
    });

    expect(getInstanceUrl()).toBe('https://kraken.example.com');
  });

  it('returns active server URL in Electron', () => {
    vi.mocked(isElectron).mockReturnValue(true);
    vi.mocked(getActiveServer).mockReturnValue({
      id: 'server-1',
      name: 'My Server',
      url: 'https://my-kraken-instance.com',
    });

    expect(getInstanceUrl()).toBe('https://my-kraken-instance.com');
  });

  it('returns empty string in Electron when no server is configured', () => {
    vi.mocked(isElectron).mockReturnValue(true);
    vi.mocked(getActiveServer).mockReturnValue(null);

    expect(getInstanceUrl()).toBe('');
  });

  it('does not return file:// protocol in Electron', () => {
    vi.mocked(isElectron).mockReturnValue(true);
    vi.mocked(getActiveServer).mockReturnValue({
      id: 'server-1',
      name: 'My Server',
      url: 'https://my-server.com',
    });

    // Even if window.location.origin is file://, we should get the server URL
    Object.defineProperty(window, 'location', {
      value: { origin: 'file://' },
      writable: true,
      configurable: true,
    });

    const url = getInstanceUrl();
    expect(url).not.toContain('file://');
    expect(url).toBe('https://my-server.com');
  });
});
