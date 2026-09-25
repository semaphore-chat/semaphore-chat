import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard } from '../../utils/clipboard';

// Mock platform utilities
vi.mock('../../utils/platform', () => ({
  isElectron: vi.fn(() => false),
  getElectronAPI: vi.fn(() => null),
}));

import { isElectron, getElectronAPI } from '../../utils/platform';
import type { ElectronAPI } from '../../types/electron-api';

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: browser environment
    vi.mocked(isElectron).mockReturnValue(false);
    vi.mocked(getElectronAPI).mockReturnValue(null);

    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('uses navigator.clipboard.writeText in browser environment', async () => {
    await copyToClipboard('hello world');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
  });

  it('uses Electron writeClipboard API when running in Electron', async () => {
    vi.mocked(isElectron).mockReturnValue(true);
    const mockWriteClipboard = vi.fn();
    vi.mocked(getElectronAPI).mockReturnValue({ writeClipboard: mockWriteClipboard } as unknown as ElectronAPI);

    await copyToClipboard('electron text');

    expect(mockWriteClipboard).toHaveBeenCalledWith('electron text');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('falls back to navigator.clipboard when Electron API is unavailable', async () => {
    vi.mocked(isElectron).mockReturnValue(true);
    vi.mocked(getElectronAPI).mockReturnValue(null);

    await copyToClipboard('fallback text');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('fallback text');
  });

  it('falls back to navigator.clipboard when Electron API lacks writeClipboard', async () => {
    vi.mocked(isElectron).mockReturnValue(true);
    vi.mocked(getElectronAPI).mockReturnValue({} as unknown as ElectronAPI);

    await copyToClipboard('no method');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('no method');
  });

  it('handles empty string', async () => {
    await copyToClipboard('');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
  });
});
