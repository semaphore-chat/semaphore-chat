import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock platform detection
const mockIsElectron = vi.fn(() => false);
vi.mock('../../utils/platform', () => ({
  isElectron: () => mockIsElectron(),
  isWeb: () => !mockIsElectron(),
}));

// Mock env
vi.mock('../../config/env', () => ({
  getApiUrl: (path: string) => `http://localhost:3000/api${path}`,
}));

// Mock tokenService
vi.mock('../../utils/tokenService', () => ({
  getAccessToken: vi.fn(() => 'mock-access-token'),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useVideoUrl } from '../../hooks/useVideoUrl';
import { getAccessToken } from '../../utils/tokenService';

/** Flush multiple microtask cycles so async effect chains (fetch → json → setState) complete */
const flushPromises = () => act(async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
});

describe('useVideoUrl', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(false);
    vi.mocked(getAccessToken).mockReturnValue('mock-access-token');
    // Stub fetch fresh each test (vi.restoreAllMocks unstubs globals)
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('web platform', () => {
    it('should return a plain URL for web', () => {
      const { result } = renderHook(() => useVideoUrl('file-123'));

      expect(result.current.url).toBe('http://localhost:3000/api/file/file-123');
      expect(result.current.isLoading).toBe(false);
    });

    it('should return null URL when fileId is null', () => {
      const { result } = renderHook(() => useVideoUrl(null));

      expect(result.current.url).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('should not call fetch on web', () => {
      renderHook(() => useVideoUrl('file-123'));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should provide a no-op refresh function on web', () => {
      const { result } = renderHook(() => useVideoUrl('file-123'));

      expect(() => result.current.refresh()).not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should update URL when fileId changes', () => {
      const { result, rerender } = renderHook(
        ({ fileId }) => useVideoUrl(fileId),
        { initialProps: { fileId: 'file-a' as string | null } },
      );

      expect(result.current.url).toBe('http://localhost:3000/api/file/file-a');

      rerender({ fileId: 'file-b' });
      expect(result.current.url).toBe('http://localhost:3000/api/file/file-b');

      rerender({ fileId: null });
      expect(result.current.url).toBeNull();
    });
  });

  describe('Electron platform', () => {
    const mockSignedUrlResponse = (
      url = '/api/file/file-1?sig=abc&exp=123&uid=u1',
      expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(),
    ) => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url, expiresAt }),
      });
    };

    beforeEach(() => {
      mockIsElectron.mockReturnValue(true);
    });

    it('should fetch a signed URL on Electron', async () => {
      mockSignedUrlResponse();

      const { result } = renderHook(() => useVideoUrl('file-1'));

      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.current.url).toBe(
        'http://localhost:3000/api/file/file-1?sig=abc&exp=123&uid=u1',
      );
      expect(result.current.isLoading).toBe(false);
    });

    it('should return null URL when fileId is null on Electron', () => {
      const { result } = renderHook(() => useVideoUrl(null));

      expect(result.current.url).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not fetch when access token is null', async () => {
      vi.mocked(getAccessToken).mockReturnValue(null);

      const { result } = renderHook(() => useVideoUrl('file-1'));

      await flushPromises();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.current.url).toBeNull();
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const { result } = renderHook(() => useVideoUrl('file-1'));

      await flushPromises();

      expect(result.current.url).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useVideoUrl('file-1'));

      await flushPromises();

      expect(result.current.url).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('should handle non-api URL paths', async () => {
      mockSignedUrlResponse('https://cdn.example.com/file/123?sig=x');

      const { result } = renderHook(() => useVideoUrl('file-1'));

      await flushPromises();

      // Non-/api/ URLs are used as-is
      expect(result.current.url).toBe('https://cdn.example.com/file/123?sig=x');
    });

    it('should call refresh to manually refetch', async () => {
      mockSignedUrlResponse();

      const { result } = renderHook(() => useVideoUrl('file-1'));

      await flushPromises();
      expect(result.current.url).not.toBeNull();

      mockFetch.mockClear();
      mockSignedUrlResponse('/api/file/file-1?sig=new&exp=999&uid=u1');

      await act(async () => {
        result.current.refresh();
      });
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.current.url).toBe(
        'http://localhost:3000/api/file/file-1?sig=new&exp=999&uid=u1',
      );
    });
  });
});
