import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createTestQueryClient, createTestWrapper } from '../../test-utils';
import { useMentionableUserIds } from '../../../data/chat/useMentionableUserIds';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const API = 'http://localhost:3000/api';

function wrapper() {
  return createTestWrapper({ queryClient: createTestQueryClient() });
}

describe('useMentionableUserIds', () => {
  it('unknown channel: no filter, not loading, nothing fetched', async () => {
    const fetched = vi.fn(() => HttpResponse.json([]));
    server.use(http.get(`${API}/channel-membership/channel/:channelId`, fetched));
    const { result } = renderHook(() => useMentionableUserIds(null), { wrapper: wrapper() });
    expect(result.current).toEqual({ ids: null, loading: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetched).not.toHaveBeenCalled();
  });

  it('public channel: no filter, nothing fetched', async () => {
    const fetched = vi.fn(() => HttpResponse.json([]));
    server.use(http.get(`${API}/channel-membership/channel/:channelId`, fetched));
    const { result } = renderHook(() => useMentionableUserIds({ id: 'ch-1', isPrivate: false }), { wrapper: wrapper() });
    expect(result.current).toEqual({ ids: null, loading: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetched).not.toHaveBeenCalled();
  });

  it("private channel: an empty set while loading, then the members' user ids", async () => {
    server.use(
      http.get(`${API}/channel-membership/channel/:channelId`, ({ params }) =>
        HttpResponse.json(
          params.channelId === 'ch-p'
            ? [
                { id: 'm1', userId: 'u1', channelId: 'ch-p', joinedAt: '2026-01-01' },
                { id: 'm2', userId: 'u2', channelId: 'ch-p', joinedAt: '2026-01-01' },
              ]
            : [],
        ),
      ),
    );
    const { result } = renderHook(() => useMentionableUserIds({ id: 'ch-p', isPrivate: true }), { wrapper: wrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.ids).toEqual(new Set());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect([...result.current.ids!]).toEqual(['u1', 'u2']);
  });

  it('private channel whose list fails: an empty set, not loading', async () => {
    server.use(
      http.get(`${API}/channel-membership/channel/:channelId`, () => HttpResponse.json({ message: 'no' }, { status: 403 })),
    );
    const { result } = renderHook(() => useMentionableUserIds({ id: 'ch-p', isPrivate: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ids).toEqual(new Set());
  });
});
