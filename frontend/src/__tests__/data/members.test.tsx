import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createTestQueryClient, createTestWrapper, createChannel } from '../test-utils';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const voice = vi.hoisted(() => ({ state: { isConnected: false, currentChannelId: null as string | null } }));
vi.mock('../../hooks/useVoiceConnection', () => ({ useVoiceConnection: () => ({ state: voice.state, actions: {} }) }));

import { useCommunityMembers, useChannelMembers, computeDisplayRole, keepIdentity, groupMembers } from '../../data/members';
import { handleUserOnline, resetCommunityPresenceThrottle } from '../../socket-hub/handlers/presenceHandlers';
import { handleReconnect } from '../../socket-hub/handlers/reconnectHandlers';
import { presenceControllerGetCommunityPresenceQueryKey } from '../../api-client/@tanstack/react-query.gen';

const BASE = 'http://localhost:3000';

const memberRole = { id: 'r-member', name: 'Member', position: 100, isDefault: true };
const admin = { id: 'r-admin', name: 'admin', position: 1, isDefault: false };
const mod = { id: 'r-mod', name: 'mod', position: 5, isDefault: false };

function membership(n: number, roles: unknown[] = [memberRole], extra: Record<string, unknown> = {}) {
  const id = `user-${n}`;
  return {
    id: `m-${n}`,
    userId: id,
    communityId: 'c-1',
    joinedAt: '2026-01-01T00:00:00Z',
    roles,
    user: {
      id,
      username: `user${n}`,
      displayName: `User ${n}`,
      avatarUrl: `file-${n}`,
      status: null,
      lastSeen: '2026-11-15T10:00:00Z',
      ...extra,
    },
  };
}

/** `total` members in pages of 100 (the classic page size), with continuation tokens. */
function memberPages(total: number, rolesFor: (n: number) => unknown[] = () => [memberRole]) {
  const all = Array.from({ length: total }, (_, i) => membership(i + 1, rolesFor(i + 1)));
  return http.get(`${BASE}/api/membership/community/c-1`, ({ request }) => {
    const token = new URL(request.url).searchParams.get('continuationToken') || '0';
    const start = Number(token);
    const next = start + 100;
    return HttpResponse.json({
      members: all.slice(start, next),
      continuationToken: next < total ? String(next) : undefined,
    });
  });
}

function bulkPresence(online: Record<string, boolean>) {
  return http.get(`${BASE}/api/presence/users/bulk`, () => HttpResponse.json({ presence: online }));
}

function communityPresence(presence: { onlineUserIds: string[]; onlineCount: number; memberCount: number }) {
  return http.get(`${BASE}/api/presence/community/c-1`, () => HttpResponse.json(presence));
}

function noRooms() {
  return http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json([]));
}

function renderMembers() {
  const queryClient = createTestQueryClient();
  const hook = renderHook(() => useCommunityMembers('c-1'), { wrapper: createTestWrapper({ queryClient }) });
  return { queryClient, ...hook };
}

describe('useCommunityMembers', () => {
  beforeEach(() => {
    resetCommunityPresenceThrottle();
  });

  it('groups Hosts (by role priority) / Around / Away from members and bulk presence', async () => {
    server.use(
      memberPages(5, (n) => (n === 2 ? [memberRole, mod] : n === 4 ? [admin] : [memberRole])),
      bulkPresence({ 'user-1': true, 'user-2': true }),
      noRooms(),
    );
    const { result } = renderMembers();

    await waitFor(() => expect(result.current.status).toBe('success'));
    await waitFor(() => expect(result.current.around).toHaveLength(1));
    expect(result.current.hosts.map((m) => [m.id, m.role, m.presence])).toEqual([
      ['user-4', 'admin', 'offline'],
      ['user-2', 'mod', 'online'],
    ]);
    expect(result.current.around.map((m) => m.id)).toEqual(['user-1']);
    expect(result.current.away.map((m) => m.id)).toEqual(['user-3', 'user-5']);
    expect(result.current.loadedAroundCount).toBe(2);
    expect(result.current.allLoaded).toBe(true);
    // Every page is loaded, so the count is the community's
    expect(result.current.aroundCount).toBe(2);
    expect(result.current.around[0]).toEqual({
      id: 'user-1',
      name: 'User 1',
      avatarFileId: 'file-1',
      role: null,
      presence: 'online',
      statusText: null,
      lastSeen: '2026-11-15T10:00:00Z',
      inRoom: null,
    });
  });

  it('shows the 250th member online after "Show more" (no 200-id presence cap)', async () => {
    const presenceRequests: string[] = [];
    server.use(
      memberPages(250),
      http.get(`${BASE}/api/presence/users/:userIds`, ({ params }) => {
        presenceRequests.push(String(params.userIds));
        return HttpResponse.json({ presence: { 'user-250': true } });
      }),
      noRooms(),
    );
    const { result } = renderMembers();
    await waitFor(() => expect(result.current.away.length + result.current.around.length).toBe(100));
    expect(result.current.allLoaded).toBe(false);
    // One page of three: what is loaded is not the community, so no community-wide count
    expect(result.current.loadedAroundCount).toBe(0);
    expect(result.current.aroundCount).toBeNull();

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.away.length + result.current.around.length).toBe(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.around.map((m) => m.id)).toEqual(['user-250']));
    expect(result.current.allLoaded).toBe(true);
    expect(result.current.aroundCount).toBe(1);
    expect(result.current.loadedAroundCount).toBe(1);
    // One bulk request, never a list of ids
    expect(new Set(presenceRequests)).toEqual(new Set(['bulk']));
  });

  it('takes aroundCount from the community presence endpoint before every page is loaded', async () => {
    server.use(
      memberPages(250),
      bulkPresence({ 'user-1': true }),
      communityPresence({ onlineUserIds: ['user-1', 'user-250'], onlineCount: 2, memberCount: 250 }),
      noRooms(),
    );
    const { result } = renderMembers();

    await waitFor(() => expect(result.current.aroundCount).toBe(2));
    // One page of three: the community-wide count is right anyway...
    expect(result.current.allLoaded).toBe(false);
    expect(result.current.loadedAroundCount).toBe(1);
    // ...while the rows still read the bulk presence they always did.
    expect(result.current.around.map((m) => m.id)).toEqual(['user-1']);
  });

  it('falls back to the loaded pages when the endpoint is missing (404)', async () => {
    // The shared handler answers 404: an older backend, no community count.
    server.use(memberPages(120), bulkPresence({ 'user-1': true }), noRooms());
    const { result } = renderMembers();

    await waitFor(() => expect(result.current.away.length + result.current.around.length).toBe(100));
    expect(result.current.aroundCount).toBeNull();

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.allLoaded).toBe(true));
    expect(result.current.aroundCount).toBe(1);
    expect(result.current.loadedAroundCount).toBe(1);
  });

  it('asks the community presence endpoint once when an older backend answers 404', async () => {
    let requests = 0;
    server.use(
      memberPages(3),
      bulkPresence({}),
      http.get(`${BASE}/api/presence/community/c-1`, () => {
        requests += 1;
        return HttpResponse.json({ statusCode: 404, message: 'Not Found', error: 'Not Found' }, { status: 404 });
      }),
      noRooms(),
    );
    const queryClient = createTestQueryClient();
    // Production retries once; no retry delay, so a retry would land at once.
    queryClient.setDefaultOptions({ queries: { retry: 1, retryDelay: 0 } });
    renderHook(() => useCommunityMembers('c-1'), { wrapper: createTestWrapper({ queryClient }) });

    const key = presenceControllerGetCommunityPresenceQueryKey({ path: { communityId: 'c-1' } });
    await waitFor(() => {
      const state = queryClient.getQueryState(key);
      expect(state?.status).toBe('error');
      expect(state?.fetchStatus).toBe('idle');
    });
    // A 404 never comes back: retrying only delays the page-based fallback.
    expect(requests).toBe(1);
  });

  it('falls back to the loaded pages and keeps the list working when the request fails', async () => {
    server.use(
      memberPages(3),
      bulkPresence({ 'user-1': true }),
      http.get(`${BASE}/api/presence/community/c-1`, () => HttpResponse.json({ message: 'down' }, { status: 500 })),
      noRooms(),
    );
    const { result } = renderMembers();

    await waitFor(() => expect(result.current.aroundCount).toBe(1));
    expect(result.current.allLoaded).toBe(true);
    expect(result.current.status).toBe('success');
  });

  it('refreshes the community count when a presence socket event arrives', async () => {
    let onlineCount = 1;
    server.use(
      memberPages(250),
      bulkPresence({ 'user-1': true }),
      http.get(`${BASE}/api/presence/community/c-1`, () =>
        HttpResponse.json({
          onlineUserIds: Array.from({ length: onlineCount }, (_, i) => `user-${i + 1}`),
          onlineCount,
          memberCount: 250,
        }),
      ),
      noRooms(),
    );
    const { result, queryClient } = renderMembers();
    await waitFor(() => expect(result.current.aroundCount).toBe(1));

    onlineCount = 2;
    act(() => {
      handleUserOnline({ userId: 'user-250' } as never, queryClient);
    });

    await waitFor(() => expect(result.current.aroundCount).toBe(2));
  });

  it('refreshes the community count after a socket reconnect', async () => {
    let onlineCount = 1;
    server.use(
      memberPages(250),
      bulkPresence({ 'user-1': true }),
      http.get(`${BASE}/api/presence/community/c-1`, () =>
        HttpResponse.json({
          onlineUserIds: Array.from({ length: onlineCount }, (_, i) => `user-${i + 1}`),
          onlineCount,
          memberCount: 250,
        }),
      ),
      noRooms(),
    );
    const { result, queryClient } = renderMembers();
    await waitFor(() => expect(result.current.aroundCount).toBe(1));

    onlineCount = 3;
    act(() => {
      handleReconnect(queryClient);
    });

    await waitFor(() => expect(result.current.aroundCount).toBe(3));
  });

  it('keeps every untouched row object across a presence event (memo’d rows skip it)', async () => {
    server.use(memberPages(3), bulkPresence({}), noRooms());
    const { result, queryClient } = renderMembers();
    await waitFor(() => expect(result.current.away).toHaveLength(3));
    const [one, two, three] = result.current.away;

    act(() => {
      handleUserOnline({ userId: 'user-2' } as never, queryClient);
    });

    await waitFor(() => expect(result.current.around.map((m) => m.id)).toEqual(['user-2']));
    expect(result.current.around[0]).not.toBe(two);
    expect(result.current.away[0]).toBe(one);
    expect(result.current.away[1]).toBe(three);
  });

  it('says which of this community’s rooms a member is in', async () => {
    const squad = createChannel({ id: 'vc-1', name: 'Squad Up', type: 'VOICE', communityId: 'c-1' });
    server.use(
      memberPages(2),
      bulkPresence({ 'user-1': true }),
      http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json([squad])),
      http.get(`${BASE}/api/channels/vc-1/voice-presence`, () =>
        HttpResponse.json({
          channelId: 'vc-1',
          count: 1,
          users: [{ id: 'user-1', username: 'user1', joinedAt: '2026-01-01T00:00:00Z', isDeafened: false, isServerMuted: false }],
        }),
      ),
    );
    const { result } = renderMembers();
    await waitFor(() => expect(result.current.around[0]?.inRoom).toBe('Squad Up'));
    expect(result.current.away[0].inRoom).toBeNull();
  });

  it('reports an error and retries the request that failed', async () => {
    let fail = true;
    server.use(
      http.get(`${BASE}/api/membership/community/c-1`, () =>
        fail ? HttpResponse.json({ message: 'down' }, { status: 500 }) : HttpResponse.json({ members: [membership(1)] }),
      ),
      bulkPresence({}),
      noRooms(),
    );
    const { result } = renderMembers();
    await waitFor(() => expect(result.current.status).toBe('error'));
    fail = false;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.away).toHaveLength(1));
    expect(result.current.status).toBe('success');
  });
});

describe('useChannelMembers (the chat screen’s members)', () => {
  beforeEach(() => {
    resetCommunityPresenceThrottle();
  });

  function renderChannelMembers(channel: { id: string; isPrivate: boolean } | null) {
    const queryClient = createTestQueryClient();
    return renderHook(() => useChannelMembers('c-1', channel), { wrapper: createTestWrapper({ queryClient }) });
  }

  it('a public channel lists the community’s members', async () => {
    server.use(memberPages(3), bulkPresence({ 'user-1': true }), noRooms());
    const { result } = renderChannelMembers({ id: 'ch-1', isPrivate: false });
    await waitFor(() => expect(result.current.status).toBe('success'));
    await waitFor(() => expect(result.current.around).toHaveLength(1));
    expect([...result.current.around, ...result.current.away].map((m) => m.id).sort()).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('a private channel lists only the people in it, never the rest of the community', async () => {
    const channelMembers = vi.fn();
    const communityMembers = vi.fn();
    server.use(
      http.get(`${BASE}/api/membership/community/c-1`, () => {
        communityMembers();
        return HttpResponse.json({ members: [] });
      }),
      bulkPresence({ 'user-2': true }),
      noRooms(),
      http.get(`${BASE}/api/channel-membership/channel/ch-staff`, () => {
        channelMembers();
        return HttpResponse.json([
          { id: 'cm-1', userId: 'user-2', channelId: 'ch-staff', joinedAt: '2026-01-01T00:00:00Z', user: membership(2).user },
          { id: 'cm-2', userId: 'user-4', channelId: 'ch-staff', joinedAt: '2026-01-01T00:00:00Z', user: membership(4).user },
        ]);
      }),
    );
    const { result } = renderChannelMembers({ id: 'ch-staff', isPrivate: true });
    await waitFor(() => expect(result.current.status).toBe('success'));
    await waitFor(() => expect(result.current.around).toHaveLength(1));
    expect(channelMembers).toHaveBeenCalled();
    expect(result.current.around.map((m) => m.id)).toEqual(['user-2']);
    expect(result.current.away.map((m) => m.id)).toEqual(['user-4']);
    // No display roles in a private channel's list (as the old member list): nobody is a host.
    expect(result.current.hosts).toEqual([]);
    expect(result.current.allLoaded).toBe(true);
    expect(result.current.aroundCount).toBe(1);
    // A cold link to a private channel never asks for the community's roster.
    expect(communityMembers).not.toHaveBeenCalled();
  });

  it('a private channel whose list fails reports an error', async () => {
    server.use(
      memberPages(2),
      bulkPresence({}),
      noRooms(),
      http.get(`${BASE}/api/channel-membership/channel/ch-staff`, () => HttpResponse.json({ message: 'no' }, { status: 500 })),
    );
    const { result } = renderChannelMembers({ id: 'ch-staff', isPrivate: true });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('while the channel is not known (loading, or not in the reader’s list) it fetches and lists nobody', async () => {
    const communityMembers = vi.fn();
    const channelMembers = vi.fn();
    server.use(
      http.get(`${BASE}/api/membership/community/c-1`, () => {
        communityMembers();
        return HttpResponse.json({ members: [membership(1)] });
      }),
      http.get(`${BASE}/api/channel-membership/channel/:id`, () => {
        channelMembers();
        return HttpResponse.json([]);
      }),
      bulkPresence({}),
      noRooms(),
    );
    const { result } = renderChannelMembers(null);
    // Give any request the chance to go out.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBe('pending');
    expect([...result.current.hosts, ...result.current.around, ...result.current.away]).toEqual([]);
    expect(result.current.aroundCount).toBeNull();
    expect(communityMembers).not.toHaveBeenCalled();
    expect(channelMembers).not.toHaveBeenCalled();
  });
});

describe('member helpers', () => {
  it('computeDisplayRole skips the default Member role and picks the lowest position', () => {
    expect(computeDisplayRole([memberRole] as never)).toBeUndefined();
    expect(computeDisplayRole([memberRole, mod, admin] as never)).toEqual({ id: 'r-admin', name: 'admin', position: 1 });
    expect(computeDisplayRole(undefined)).toBeUndefined();
  });

  it('keepIdentity reuses unchanged items and evicts the ones that left', () => {
    const a = { id: 'a', v: 1 };
    const b = { id: 'b', v: 1 };
    const first = keepIdentity([a, b], new Map(), (x, y) => x.v === y.v);
    const second = keepIdentity([{ id: 'a', v: 1 }, { id: 'c', v: 1 }], first.cache, (x, y) => x.v === y.v);
    expect(second.items[0]).toBe(a);
    expect([...second.cache.keys()]).toEqual(['a', 'c']);
  });

  it('groupMembers counts online hosts in the loaded count', () => {
    const summary = (id: string, presence: 'online' | 'offline') => ({
      id, name: id, avatarFileId: null, role: null, presence, statusText: null, lastSeen: null, inRoom: null,
    });
    const grouped = groupMembers([
      { summary: summary('h', 'online'), rolePosition: 1 },
      { summary: summary('x', 'offline'), rolePosition: null },
    ]);
    expect(grouped.loadedAroundCount).toBe(1);
    expect(grouped.hosts.map((m) => m.id)).toEqual(['h']);
    expect(grouped.away.map((m) => m.id)).toEqual(['x']);
  });
});
