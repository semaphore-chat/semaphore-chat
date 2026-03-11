import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useDmPeerReads } from '../../hooks/useDmPeerReads';
import { readReceiptsControllerGetDmPeerReadsQueryKey } from '../../api-client/@tanstack/react-query.gen';

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api-client/@tanstack/react-query.gen')>();
  return {
    ...actual,
    readReceiptsControllerGetDmPeerReadsOptions: (opts: { path: { directMessageGroupId: string } }) => ({
      queryKey: actual.readReceiptsControllerGetDmPeerReadsQueryKey(opts),
      queryFn: () => Promise.resolve([]),
      staleTime: 60_000,
    }),
  };
});

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('useDmPeerReads', () => {
  const dmGroupId = 'dm-group-1';

  it('getReadByCount returns correct count of peers who have read past sentAt', () => {
    const queryClient = new QueryClient();
    const key = readReceiptsControllerGetDmPeerReadsQueryKey({
      path: { directMessageGroupId: dmGroupId },
    });
    queryClient.setQueryData(key, [
      { userId: 'peer-1', lastReadAt: '2024-01-15T00:00:00Z' },
      { userId: 'peer-2', lastReadAt: '2024-01-10T00:00:00Z' },
    ]);

    const { result } = renderHook(() => useDmPeerReads(dmGroupId), {
      wrapper: createWrapper(queryClient),
    });

    // Message sent on Jan 12 — only peer-1 (Jan 15) has read past it
    expect(result.current.getReadByCount('2024-01-12T00:00:00Z')).toBe(1);
    // Message sent on Jan 5 — both peers have read past it
    expect(result.current.getReadByCount('2024-01-05T00:00:00Z')).toBe(2);
    // Message sent on Jan 20 — neither peer has read past it
    expect(result.current.getReadByCount('2024-01-20T00:00:00Z')).toBe(0);
  });

  it('getReaderIds returns correct user IDs', () => {
    const queryClient = new QueryClient();
    const key = readReceiptsControllerGetDmPeerReadsQueryKey({
      path: { directMessageGroupId: dmGroupId },
    });
    queryClient.setQueryData(key, [
      { userId: 'peer-1', lastReadAt: '2024-01-15T00:00:00Z' },
      { userId: 'peer-2', lastReadAt: '2024-01-10T00:00:00Z' },
    ]);

    const { result } = renderHook(() => useDmPeerReads(dmGroupId), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.getReaderIds('2024-01-12T00:00:00Z')).toEqual(['peer-1']);
    expect(result.current.getReaderIds('2024-01-05T00:00:00Z')).toEqual(['peer-1', 'peer-2']);
  });

  it('returns 0/empty when no peer watermarks exist', () => {
    const queryClient = new QueryClient();
    const key = readReceiptsControllerGetDmPeerReadsQueryKey({
      path: { directMessageGroupId: dmGroupId },
    });
    queryClient.setQueryData(key, []);

    const { result } = renderHook(() => useDmPeerReads(dmGroupId), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.getReadByCount('2024-01-01T00:00:00Z')).toBe(0);
    expect(result.current.getReaderIds('2024-01-01T00:00:00Z')).toEqual([]);
  });

  it('sentAt === lastReadAt counts as read (>= comparison)', () => {
    const queryClient = new QueryClient();
    const key = readReceiptsControllerGetDmPeerReadsQueryKey({
      path: { directMessageGroupId: dmGroupId },
    });
    const exactTime = '2024-01-15T12:00:00Z';
    queryClient.setQueryData(key, [
      { userId: 'peer-1', lastReadAt: exactTime },
    ]);

    const { result } = renderHook(() => useDmPeerReads(dmGroupId), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.getReadByCount(exactTime)).toBe(1);
    expect(result.current.getReaderIds(exactTime)).toEqual(['peer-1']);
  });
});
