/**
 * Regression test for "Maximum update depth exceeded" on long member /
 * friend lists (Task 20 of the mobile UX overhaul).
 *
 * Root cause: every UserAvatar resolves its user through its own
 * `useUser` query. When N of those queries resolve together, TanStack Query
 * notifies each observer from its own `setTimeout(0)`, and each
 * notification re-renders through `useSyncExternalStore` on the Sync lane.
 * `useAuthenticatedFile` used to call `setState` synchronously inside its
 * effect (`error: null`, then `isLoadingBlob: true`) when the avatar's file
 * id appeared, so every one of those N sync commits left a Default-lane
 * update pending. React counts consecutive commits that leave work pending
 * and throws once the streak passes 50 — with 55+ avatars it did, reliably.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderWithProviders } from '../test-utils';
import { createTestQueryClient } from '../test-utils/queryClient';
import { FileCacheProvider } from '../../contexts/AvatarCacheContext';
import UserAvatar from '../../components/Common/UserAvatar';
import { useAuthenticatedFile } from '../../hooks/useAuthenticatedFile';

vi.mock('../../utils/tokenService', () => ({
  getAccessToken: () => 'test-token',
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ openProfile: vi.fn(), closeProfile: vi.fn() }),
}));

// Every user lookup waits on one gate, so releasing it resolves all N
// queries in the same tick — the burst that a big member list produces.
let releaseUsers: () => void = () => {};
let usersGate: Promise<void> = Promise.resolve();
vi.mock('../../api-client/@tanstack/react-query.gen', () => ({
  userControllerGetUserByIdOptions: ({ path }: { path: { id: string } }) => ({
    queryKey: ['userControllerGetUserById', path.id],
    queryFn: async () => {
      await usersGate;
      return {
        id: path.id,
        username: `user_${path.id}`,
        displayName: `User ${path.id}`,
        avatarUrl: `file-${path.id}`,
      };
    },
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  usersGate = new Promise<void>((resolve) => {
    releaseUsers = resolve;
  });
  fetchMock.mockReset();
  // Avatar blobs never arrive during the burst; only the effect's own
  // synchronous state updates matter here.
  fetchMock.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/avatar');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The frontend tsconfig has no Node types; vitest runs in Node regardless.
const nodeProcess = (globalThis as unknown as {
  process: {
    on: (event: 'uncaughtException', fn: (err: unknown) => void) => void;
    off: (event: 'uncaughtException', fn: (err: unknown) => void) => void;
  };
}).process;

function captureUncaughtErrors() {
  const errors: string[] = [];
  const onWindowError = (event: ErrorEvent) => {
    errors.push(String(event.error?.message ?? event.message));
    event.preventDefault();
  };
  // React throws it from a TanStack notify timer, which reaches Node's
  // process as an uncaught exception rather than jsdom's window.
  const onProcessError = (err: unknown) => {
    errors.push(String((err as Error)?.message ?? err));
  };
  window.addEventListener('error', onWindowError);
  nodeProcess.on('uncaughtException', onProcessError);
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (/Maximum update depth/.test(text)) errors.push(text);
  });
  return {
    errors,
    restore: () => {
      window.removeEventListener('error', onWindowError);
      nodeProcess.off('uncaughtException', onProcessError);
      consoleError.mockRestore();
    },
  };
}

describe('long avatar lists (Maximum update depth regression)', () => {
  it('renders 250 members whose users resolve in one burst without the React update-depth error', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `m${i}`);
    const captured = captureUncaughtErrors();
    try {
      renderWithProviders(
        <FileCacheProvider>
          <ul>
            {ids.map((id) => (
              <li key={id}>
                <UserAvatar userId={id} />
              </li>
            ))}
          </ul>
        </FileCacheProvider>,
      );

      releaseUsers();

      // Every avatar has its user and has started loading its blob.
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(250), { timeout: 10000 });
      // Let any trailing timers/renders flush.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(captured.errors.filter((e) => /Maximum update depth/.test(e))).toEqual([]);
    } finally {
      captured.restore();
    }
  });
});

describe('useAuthenticatedFile', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={createTestQueryClient()}>
      <FileCacheProvider>{children}</FileCacheProvider>
    </QueryClientProvider>
  );

  it('reports loading on the very first render for a new file id (no effect-driven update)', () => {
    const { result } = renderHook(() => useAuthenticatedFile('file-1'), { wrapper });
    // The fetch is in flight and never resolves in this test.
    expect(result.current.isLoadingBlob).toBe(true);
    expect(result.current.blobUrl).toBeNull();
  });

  it('is idle with no file id', () => {
    const { result } = renderHook(() => useAuthenticatedFile(null), { wrapper });
    expect(result.current).toMatchObject({ blobUrl: null, isLoading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the blob url and clears loading', async () => {
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    const { result } = renderHook(() => useAuthenticatedFile('file-2'), { wrapper });
    await waitFor(() => expect(result.current.blobUrl).toBe('blob:http://localhost/avatar'));
    expect(result.current.isLoading).toBe(false);
  });

  it('returns an already-cached blob synchronously, without a loading flash', async () => {
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) });
    const { result, rerender } = renderHook(({ id }) => useAuthenticatedFile(id), {
      wrapper,
      initialProps: { id: 'file-3' as string | null },
    });
    await waitFor(() => expect(result.current.blobUrl).toBe('blob:http://localhost/avatar'));

    rerender({ id: null });
    expect(result.current.blobUrl).toBeNull();

    rerender({ id: 'file-3' });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.blobUrl).toBe('blob:http://localhost/avatar');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces fetch errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const { result } = renderHook(() => useAuthenticatedFile('file-4'), { wrapper });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.blobUrl).toBeNull();
  });

  it('ignores a stale response after the file id changes', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    fetchMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ id }) => useAuthenticatedFile(id), {
      wrapper,
      initialProps: { id: 'file-a' },
    });
    rerender({ id: 'file-b' });
    await act(async () => {
      resolveFirst({ ok: true, blob: async () => new Blob(['a']) });
    });
    expect(result.current.blobUrl).toBeNull();
    expect(result.current.isLoadingBlob).toBe(true);
  });
});

