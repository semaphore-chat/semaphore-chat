import { describe, it, expect, vi } from 'vitest';
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

import { useCommunityMembers, computeDisplayRole, keepIdentity, groupMembers } from '../../data/members';
import { handleUserOnline } from '../../socket-hub/handlers/presenceHandlers';

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

function noRooms() {
  return http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json([]));
}

function renderMembers() {
  const queryClient = createTestQueryClient();
  const hook = renderHook(() => useCommunityMembers('c-1'), { wrapper: createTestWrapper({ queryClient }) });
  return { queryClient, ...hook };
}

describe('useCommunityMembers', () => {
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
    expect(result.current.aroundCount).toBe(2);
    expect(result.current.allLoaded).toBe(true);
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

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.away.length + result.current.around.length).toBe(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.around.map((m) => m.id)).toEqual(['user-250']));
    expect(result.current.allLoaded).toBe(true);
    expect(result.current.aroundCount).toBe(1);
    // One bulk request, never a list of ids
    expect(new Set(presenceRequests)).toEqual(new Set(['bulk']));
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

  it('groupMembers counts online hosts in "around"', () => {
    const summary = (id: string, presence: 'online' | 'offline') => ({
      id, name: id, avatarFileId: null, role: null, presence, statusText: null, lastSeen: null, inRoom: null,
    });
    const grouped = groupMembers([
      { summary: summary('h', 'online'), rolePosition: 1 },
      { summary: summary('x', 'offline'), rolePosition: null },
    ]);
    expect(grouped.aroundCount).toBe(1);
    expect(grouped.hosts.map((m) => m.id)).toEqual(['h']);
    expect(grouped.away.map((m) => m.id)).toEqual(['x']);
  });
});
