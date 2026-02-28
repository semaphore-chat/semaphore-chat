import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { FileCacheProvider, useFileCache } from '../../contexts/AvatarCacheContext';

// Mock dependencies
vi.mock('../../config/env', () => ({
  getApiUrl: vi.fn((path: string) => `http://localhost:3000/api${path}`),
}));

// Import so we can reset the mock return value in beforeEach
import { getAccessToken } from '../../utils/tokenService';

vi.mock('../../utils/tokenService', () => ({
  getAccessToken: vi.fn(),
}));

// Mock global fetch and URL.createObjectURL / revokeObjectURL
const mockFetch = vi.fn();
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch;
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;

  // Reset mock return value (vi.clearAllMocks does NOT reset mockReturnValue)
  vi.mocked(getAccessToken).mockReturnValue('mock-jwt-token');

  mockCreateObjectURL.mockImplementation(
    (_blob: Blob) => `blob:${Math.random().toString(36).slice(2)}`,
  );

  mockFetch.mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['data'], { type: 'image/jpeg' })),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <FileCacheProvider>{children}</FileCacheProvider>;
}

function smallCacheWrapper({ children }: { children: React.ReactNode }) {
  return (
    <FileCacheProvider maxCacheSize={3}>{children}</FileCacheProvider>
  );
}

describe('FileCacheContext', () => {
  describe('fetchBlob', () => {
    it('should fetch a file and return a blob URL', async () => {
      mockCreateObjectURL.mockReturnValue('blob:file-url');

      const { result } = renderHook(() => useFileCache(), { wrapper });

      let blobUrl: string | undefined;
      await act(async () => {
        blobUrl = await result.current.fetchBlob('file-1');
      });

      expect(blobUrl).toBe('blob:file-url');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/file/file-1',
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-jwt-token' },
        }),
      );
    });

    it('should return cached blob URL on second call', async () => {
      mockCreateObjectURL.mockReturnValue('blob:cached-url');

      const { result } = renderHook(() => useFileCache(), { wrapper });

      await act(async () => {
        await result.current.fetchBlob('file-1');
      });

      let secondUrl: string | undefined;
      await act(async () => {
        secondUrl = await result.current.fetchBlob('file-1');
      });

      expect(secondUrl).toBe('blob:cached-url');
      // Should only fetch once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate concurrent requests for same file', async () => {
      const { result } = renderHook(() => useFileCache(), { wrapper });

      let url1: string | undefined;
      let url2: string | undefined;
      await act(async () => {
        [url1, url2] = await Promise.all([
          result.current.fetchBlob('file-1'),
          result.current.fetchBlob('file-1'),
        ]);
      });

      expect(url1).toBe(url2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw when fetch fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const { result } = renderHook(() => useFileCache(), { wrapper });

      await expect(
        act(async () => {
          await result.current.fetchBlob('missing-file');
        }),
      ).rejects.toThrow('Failed to fetch file: 404');
    });

    it('should throw when no auth token', async () => {
      vi.mocked(getAccessToken).mockReturnValue(null);

      const { result } = renderHook(() => useFileCache(), { wrapper });

      await expect(
        act(async () => {
          await result.current.fetchBlob('file-1');
        }),
      ).rejects.toThrow('No authentication token found');
    });
  });

  describe('fetchThumbnail', () => {
    it('should fetch from /file/:id/thumbnail endpoint', async () => {
      mockCreateObjectURL.mockReturnValue('blob:thumb-url');

      const { result } = renderHook(() => useFileCache(), { wrapper });

      let thumbUrl: string | undefined;
      await act(async () => {
        thumbUrl = await result.current.fetchThumbnail('video-1');
      });

      expect(thumbUrl).toBe('blob:thumb-url');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/file/video-1/thumbnail',
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-jwt-token' },
        }),
      );
    });

    it('should cache thumbnails with thumb: prefix key', async () => {
      mockCreateObjectURL.mockReturnValue('blob:thumb-cached');

      const { result } = renderHook(() => useFileCache(), { wrapper });

      await act(async () => {
        await result.current.fetchThumbnail('video-1');
      });

      // Second call should be cached
      let secondUrl: string | undefined;
      await act(async () => {
        secondUrl = await result.current.fetchThumbnail('video-1');
      });

      expect(secondUrl).toBe('blob:thumb-cached');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should cache thumbnails separately from full blobs', async () => {
      let callCount = 0;
      mockCreateObjectURL.mockImplementation(() => `blob:url-${++callCount}`);

      const { result } = renderHook(() => useFileCache(), { wrapper });

      let blobUrl: string | undefined;
      let thumbUrl: string | undefined;
      await act(async () => {
        blobUrl = await result.current.fetchBlob('file-1');
        thumbUrl = await result.current.fetchThumbnail('file-1');
      });

      // Should be different cache entries (different URLs from different fetches)
      expect(blobUrl).not.toBe(thumbUrl);
      // Should have made two separate fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate concurrent thumbnail requests', async () => {
      const { result } = renderHook(() => useFileCache(), { wrapper });

      let url1: string | undefined;
      let url2: string | undefined;
      await act(async () => {
        [url1, url2] = await Promise.all([
          result.current.fetchThumbnail('video-1'),
          result.current.fetchThumbnail('video-1'),
        ]);
      });

      expect(url1).toBe(url2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw when thumbnail fetch fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const { result } = renderHook(() => useFileCache(), { wrapper });

      await expect(
        act(async () => {
          await result.current.fetchThumbnail('no-thumb');
        }),
      ).rejects.toThrow('Failed to fetch thumbnail: 404');
    });

    it('should throw when no auth token for thumbnail', async () => {
      vi.mocked(getAccessToken).mockReturnValue(null);

      const { result } = renderHook(() => useFileCache(), { wrapper });

      await expect(
        act(async () => {
          await result.current.fetchThumbnail('video-1');
        }),
      ).rejects.toThrow('No authentication token found');
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when cache exceeds max size', async () => {
      let callCount = 0;
      mockCreateObjectURL.mockImplementation(() => `blob:url-${++callCount}`);

      const { result } = renderHook(() => useFileCache(), {
        wrapper: smallCacheWrapper,
      });

      // Fill cache to max (3 entries)
      await act(async () => {
        await result.current.fetchBlob('file-1');
        await result.current.fetchBlob('file-2');
        await result.current.fetchBlob('file-3');
      });

      // Adding a 4th should trigger eviction
      await act(async () => {
        await result.current.fetchBlob('file-4');
      });

      // Eviction should have revoked at least one old URL
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('getBlob / hasBlob / setBlob', () => {
    it('should return null for uncached file', () => {
      const { result } = renderHook(() => useFileCache(), { wrapper });

      expect(result.current.getBlob('nonexistent')).toBeNull();
      expect(result.current.hasBlob('nonexistent')).toBe(false);
    });

    it('should return blob URL after setBlob', () => {
      const { result } = renderHook(() => useFileCache(), { wrapper });

      act(() => {
        result.current.setBlob('file-1', 'blob:manual-url');
      });

      expect(result.current.getBlob('file-1')).toBe('blob:manual-url');
      expect(result.current.hasBlob('file-1')).toBe(true);
    });
  });

  describe('cleanup on unmount', () => {
    it('should revoke all blob URLs when provider unmounts', async () => {
      mockCreateObjectURL.mockReturnValue('blob:will-be-revoked');

      const { result, unmount } = renderHook(() => useFileCache(), {
        wrapper,
      });

      await act(async () => {
        await result.current.fetchBlob('file-1');
      });

      unmount();

      await waitFor(() => {
        expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:will-be-revoked');
      });
    });
  });

  describe('useFileCache outside provider', () => {
    it('should throw when used outside FileCacheProvider', () => {
      // Suppress console.error from React for this expected error
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useFileCache());
      }).toThrow('useFileCache must be used within FileCacheProvider');

      spy.mockRestore();
    });
  });
});
