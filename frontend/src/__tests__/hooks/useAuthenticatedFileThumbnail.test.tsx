import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { FileCacheProvider } from '../../contexts/AvatarCacheContext';
import { useAuthenticatedFile } from '../../hooks/useAuthenticatedFile';
import { getAccessToken } from '../../utils/tokenService';

vi.mock('../../config/env', () => ({
  getApiUrl: (path: string) => `http://localhost:3000/api${path}`,
}));

vi.mock('../../utils/tokenService', () => ({
  getAccessToken: vi.fn(),
}));

const mockFetch = vi.fn();
const mockCreateObjectURL = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  globalThis.URL.createObjectURL = mockCreateObjectURL as unknown as typeof URL.createObjectURL;
  globalThis.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  mockCreateObjectURL.mockReturnValue('blob:resolved');
  vi.mocked(getAccessToken).mockReturnValue('test-token');
  mockFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <FileCacheProvider>{children}</FileCacheProvider>
);

const blobResponse = () => ({
  ok: true,
  blob: () => Promise.resolve(new Blob(['image'], { type: 'image/jpeg' })),
});

describe('useAuthenticatedFile with fetchThumbnail', () => {
  it('loads the thumbnail endpoint instead of the original', async () => {
    mockFetch.mockResolvedValue(blobResponse());

    const { result } = renderHook(
      () =>
        useAuthenticatedFile('file-1', {
          fetchBlob: false,
          fetchThumbnail: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoadingBlob).toBe(false));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'http://localhost:3000/api/file/file-1/thumbnail',
    );
    expect(result.current.blobUrl).toBe('blob:resolved');
    expect(result.current.error).toBeNull();
  });

  it('shows an already-cached thumbnail at once, without a loading state', async () => {
    mockFetch.mockResolvedValue(blobResponse());

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useAuthenticatedFile(id, { fetchBlob: false, fetchThumbnail: true }),
      { wrapper, initialProps: { id: 'file-1' } },
    );
    await waitFor(() => expect(result.current.isLoadingBlob).toBe(false));
    rerender({ id: 'file-2' });
    await waitFor(() => expect(result.current.isLoadingBlob).toBe(false));
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Back to the first file: its thumbnail is in the cache.
    rerender({ id: 'file-1' });

    expect(result.current.isLoadingBlob).toBe(false);
    expect(result.current.blobUrl).toBe('blob:resolved');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to the original when the thumbnail request fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(blobResponse());

    const { result } = renderHook(
      () =>
        useAuthenticatedFile('file-2', {
          fetchBlob: true,
          fetchThumbnail: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoadingBlob).toBe(false));

    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:3000/api/file/file-2/thumbnail',
      'http://localhost:3000/api/file/file-2',
    ]);
    expect(result.current.blobUrl).toBe('blob:resolved');
    expect(result.current.error).toBeNull();
  });

  it('reports an error when both the thumbnail and the original fail', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(
      () =>
        useAuthenticatedFile('file-3', {
          fetchBlob: false,
          fetchThumbnail: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoadingBlob).toBe(false));

    expect(result.current.blobUrl).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
