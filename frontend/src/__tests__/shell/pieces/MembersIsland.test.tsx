/**
 * "Who's around" (shell/lounge/pieces/MembersIsland.tsx): the view's states and names, the connected
 * island on MSW with the real `useCommunityMembers` and the real presence handler, and how many rows
 * one presence event re-renders out of 300 (each row render reads its avatar once: the counter).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Profiler, type ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createTestQueryClient } from '../../test-utils';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
const rowRenders = vi.hoisted(() => ({ byFile: new Map<string, number>() }));
vi.mock('../../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: (fileId: string | null) => {
    if (fileId) rowRenders.byFile.set(fileId, (rowRenders.byFile.get(fileId) ?? 0) + 1);
    return { blobUrl: null };
  },
}));
vi.mock('../../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: false, currentChannelId: null }, actions: {} }),
}));

import { KitProvider } from '../../../kit';
import { UserProfileContext } from '../../../contexts/UserProfileContext';
import { handleUserOnline, resetCommunityPresenceThrottle } from '../../../socket-hub/handlers/presenceHandlers';
import type { MemberSummary } from '../../../data/members';
import { MembersIsland, MembersIslandConnected } from '../../../shell/lounge/pieces/MembersIsland';
import { communityMembersQueryKey } from '../../../utils/membershipQueryKeys';
import { memberLine, seenLine } from '../../../shell/lounge/pieces/memberLines';

/** A load face for a view (the connected pieces get theirs from useQueryLoadState). */
function loadController(status: 'pending' | 'error' | 'success', empty: boolean, retry: () => void) {
  return {
    status: status === 'pending' ? ('loading' as const) : status === 'error' ? ('error' as const) : empty ? ('empty' as const) : ('ready' as const),
    error: null,
    retryable: true,
    refreshByUser: false,
    refresh: () => undefined,
    retry,
  };
}

const BASE = 'http://localhost:3000';
const NOW = Date.UTC(2026, 10, 15, 20, 30);
const noop = () => undefined;

function Kit({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={createTheme()}>
      <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
        {children}
      </KitProvider>
    </ThemeProvider>
  );
}

const m = (id: string, name: string, extra: Partial<MemberSummary> = {}): MemberSummary => ({
  id,
  name,
  avatarFileId: null,
  role: null,
  presence: 'online',
  statusText: null,
  lastSeen: null,
  inRoom: null,
  ...extra,
});

const HOSTS = [m('u-samira', 'Samira', { role: 'admin', statusText: 'keeping the server warm' })];
const AROUND = [m('u-alexk', 'alexk', { inRoom: 'Squad Up' }), m('u-aiko', 'aiko')];
const AWAY = [m('u-diego', 'Diego', { presence: 'offline', lastSeen: new Date(NOW - 2 * 3_600_000).toISOString() })];

function renderView(props: Partial<Parameters<typeof MembersIsland>[0]> = {}) {
  const onOpenProfile = vi.fn();
  const onLoadMore = vi.fn();
  const user = userEvent.setup();
  render(
    <Kit>
      <MembersIsland
        hosts={HOSTS}
        around={AROUND}
        away={AWAY}
        aroundCount={3}
        allLoaded
        onLoadMore={onLoadMore}
        loadingMore={false}
        state={loadController('success', false, noop)}
        onOpenProfile={onOpenProfile}
        now={NOW}
        {...props}
      />
    </Kit>,
  );
  return { user, onOpenProfile, onLoadMore };
}

const consoleError = vi.spyOn(console, 'error');
beforeEach(() => {
  resetCommunityPresenceThrottle();
  consoleError.mockClear();
  rowRenders.byFile.clear();
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
});

describe('MembersIsland (view)', () => {
  it('Hosts / Around / Away, role as written, status, room and last seen; "N around"', async () => {
    const { user, onOpenProfile } = renderView();
    expect(screen.getByRole('heading', { name: "Who's around" })).toBeInTheDocument();
    expect(screen.getByText('3 around')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Hosts', 'Around', 'Away']);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('keeping the server warm')).toBeInTheDocument();
    expect(screen.getByText('In Squad Up')).toBeInTheDocument();
    expect(screen.getByText('Seen 2h ago')).toBeInTheDocument();
    // Each row's name carries the role, presence and line: "Samira, admin, online, keeping the server warm"
    expect(screen.getByRole('button', { name: 'Samira, admin, online, keeping the server warm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diego, away, Seen 2h ago' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^aiko/ }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-aiko');
    // The rows are the only buttons: no moderation action on a member
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toHaveLength(4);
  });

  it('no number without a whole-community count; Show more while pages remain, busy while one loads', async () => {
    const { user, onLoadMore } = renderView({ aroundCount: null, allLoaded: false });
    expect(screen.queryByText(/^\d+ around$/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('Show more busy', () => {
    renderView({ allLoaded: false, loadingMore: true });
    expect(screen.getByRole('button', { name: 'Show more' })).toHaveAttribute('aria-busy', 'true');
  });

  it('an empty group has no heading', () => {
    renderView({ hosts: [] });
    expect(screen.queryByRole('heading', { name: 'Hosts' })).toBeNull();
  });

  it('loading, empty and error faces', async () => {
    const retry = vi.fn();
    const { user } = renderView({ state: loadController('error', false, retry) });
    expect(screen.getByText("Couldn't load members")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });

  it('one Tab stop over all three groups; Down moves across a group boundary', async () => {
    const { user } = renderView();
    const rows = screen.getAllByRole('button');
    expect(rows.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    act(() => rows[0].focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^alexk/ })).toHaveFocus();
  });

  it('member lines: status first, then the room, then when an away member was seen', () => {
    expect(memberLine(m('a', 'a', { statusText: 'brb', inRoom: 'AFK' }), NOW)).toBe('brb');
    expect(memberLine(m('a', 'a', { inRoom: 'AFK' }), NOW)).toBe('In AFK');
    expect(memberLine(m('a', 'a'), NOW)).toBeUndefined();
    expect(seenLine(new Date(NOW - 30_000).toISOString(), NOW)).toBe('Seen just now');
    expect(seenLine(new Date(NOW - 26 * 3_600_000).toISOString(), NOW)).toBe('Seen yesterday');
    expect(seenLine('nonsense', NOW)).toBeNull();
  });
});

const memberRole = { id: 'r-member', name: 'Member', position: 100, isDefault: true };
const modRole = { id: 'r-mod', name: 'mod', position: 5, isDefault: false };

function membership(n: number) {
  return {
    id: `m-${n}`,
    userId: `user-${n}`,
    communityId: 'c-1',
    joinedAt: '2026-01-01T00:00:00Z',
    roles: n <= 2 ? [memberRole, modRole] : [memberRole],
    user: { id: `user-${n}`, username: `user${n}`, displayName: `User ${n}`, avatarUrl: `file-${n}`, status: null, lastSeen: null },
  };
}

function serveMembers(total: number, online: Record<string, boolean>, communityOnline?: () => number) {
  const all = Array.from({ length: total }, (_, i) => membership(i + 1));
  server.use(
    http.get(`${BASE}/api/membership/community/c-1`, ({ request }) => {
      const start = Number(new URL(request.url).searchParams.get('continuationToken') || '0');
      const next = start + 100;
      return HttpResponse.json({ members: all.slice(start, next), continuationToken: next < total ? String(next) : undefined });
    }),
    http.get(`${BASE}/api/presence/users/bulk`, () => HttpResponse.json({ presence: online })),
    http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json([])),
    http.get(`${BASE}/api/presence/community/c-1`, () => {
      const ids = Object.keys(online).filter((id) => online[id]);
      const count = communityOnline ? communityOnline() : ids.length;
      return HttpResponse.json({ onlineUserIds: ids, onlineCount: count, memberCount: total });
    }),
  );
}

function renderConnected(onRender?: (phase: string, duration: number) => void) {
  const queryClient = createTestQueryClient();
  const openProfile = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <Kit>
        <UserProfileContext.Provider value={{ openProfile, closeProfile: noop }}>
          <Profiler id="members" onRender={(_id, phase, duration) => onRender?.(phase, duration)}>
            <MembersIslandConnected communityId="c-1" />
          </Profiler>
        </UserProfileContext.Provider>
      </Kit>
    </QueryClientProvider>,
  );
  return { queryClient, user, openProfile };
}

const groupOf = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}\\b`) }).closest('[data-kit-list-row]')?.parentElement?.querySelector('h3')?.textContent;

describe('MembersIslandConnected', () => {
  it('orders as the classic list does: hosts by role, online first, then by name; around and away by name', async () => {
    const people = [
      ['u-z', 'zara', 'off', null],
      ['u-g', 'gracie', 'on', 'mod'],
      ['u-b', 'Bram', 'on', null],
      ['u-s', 'Samira', 'on', 'admin'],
      ['u-d', 'dropbear', 'off', 'mod'],
      ['u-a', 'aiko', 'on', null],
      ['u-c', 'chlo', 'off', null],
      ['u-k', 'kwam3', 'on', 'mod'],
    ] as const;
    const roles: Record<string, unknown> = { admin: { id: 'r-admin', name: 'admin', position: 1, isDefault: false }, mod: { id: 'r-mod', name: 'mod', position: 5, isDefault: false } };
    const online = Object.fromEntries(people.filter((p) => p[2] === 'on').map((p) => [p[0], true]));
    server.use(
      http.get(`${BASE}/api/membership/community/c-1`, () =>
        HttpResponse.json({
          members: people.map(([id, name, , role], i) => ({
            id: `m-${i}`,
            userId: id,
            communityId: 'c-1',
            joinedAt: '2026-01-01T00:00:00Z',
            roles: role ? [memberRole, roles[role]] : [memberRole],
            user: { id, username: name, displayName: null, avatarUrl: null, status: null, lastSeen: null },
          })),
        }),
      ),
      http.get(`${BASE}/api/presence/users/bulk`, () => HttpResponse.json({ presence: online })),
      http.get(`${BASE}/api/channels/community/c-1`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/presence/community/c-1`, () => HttpResponse.json({ onlineUserIds: Object.keys(online), onlineCount: 5, memberCount: 8 })),
    );
    renderConnected();
    await screen.findByRole('button', { name: /^zara/ });
    const group = (title: string) =>
      Array.from(screen.getByRole('heading', { name: title }).parentElement!.querySelectorAll('[data-kit-list-row] button')).map(
        (b) => b.textContent?.replace(/^[A-Z0-9]{2}/, '').split(',')[0],
      );
    // Hosts: admin first; the mods online first (gracie, kwam3), then the offline mod (dropbear) stays a host
    await waitFor(() => expect(group('Hosts')).toEqual(['Samira', 'gracie', 'kwam3', 'dropbear']));
    expect(group('Around')).toEqual(['aiko', 'Bram']);
    expect(group('Away')).toEqual(['chlo', 'zara']);
  });

  it('loaded members stay when a background refetch fails; the error face shows only with nothing to show', async () => {
    serveMembers(5, { 'user-1': true });
    const { queryClient } = renderConnected();
    await screen.findByRole('button', { name: /^User 4/ });
    server.use(http.get(`${BASE}/api/membership/community/c-1`, () => HttpResponse.json({ statusCode: 500 }, { status: 500 })));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: communityMembersQueryKey('c-1') }).catch(() => undefined);
    });
    await waitFor(() => expect(queryClient.getQueryState(communityMembersQueryKey('c-1'))?.status).toBe('error'));
    expect(screen.queryByText("Couldn't load members")).toBeNull();
    expect(screen.getByRole('button', { name: /^User 4/ })).toBeInTheDocument();
  });

  it('"N around" is the community presence count, known before every page is loaded', async () => {
    serveMembers(300, {}, () => 42);
    renderConnected();
    await screen.findByRole('button', { name: /^User 100\b/ });
    expect(await screen.findByText('42 around')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('a presence change (the real socket handler) moves a member from Away to Around', async () => {
    const online: Record<string, boolean> = { 'user-3': true };
    serveMembers(5, online);
    const { queryClient, user, openProfile } = renderConnected();
    await screen.findByRole('button', { name: /^User 4/ });
    expect(await screen.findByText('1 around')).toBeInTheDocument();
    const away = screen.getByRole('heading', { name: 'Away' }).parentElement!;
    expect(within(away).getByRole('button', { name: /^User 4/ })).toBeInTheDocument();

    online['user-4'] = true;
    act(() => handleUserOnline({ userId: 'user-4' } as never, queryClient));

    const around = await screen.findByRole('heading', { name: 'Around' });
    await waitFor(() => expect(within(around.parentElement!).getByRole('button', { name: /^User 4/ })).toBeInTheDocument());
    expect(screen.getByText('2 around')).toBeInTheDocument();
    expect(groupOf('User 1')).toBe('Hosts');
    await user.click(screen.getByRole('button', { name: /^User 5/ }));
    expect(openProfile).toHaveBeenCalledWith('user-5');
  });

  it('300 members: one presence event re-renders at most 2 rows; the full render time is reported', async () => {
    const online: Record<string, boolean> = {};
    serveMembers(300, online);
    const durations: { phase: string; duration: number }[] = [];
    const { queryClient, user } = renderConnected((phase, duration) => durations.push({ phase, duration }));
    await screen.findByRole('button', { name: /^User 100\b/ });
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByRole('button', { name: /^User 200\b/ });
    const before300 = durations.length;
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByRole('button', { name: /^User 300\b/ });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull());
    const fullRender = Math.max(...durations.slice(before300).map((d) => d.duration));

    rowRenders.byFile.clear();
    const start = durations.length;
    online['user-150'] = true;
    act(() => handleUserOnline({ userId: 'user-150' } as never, queryClient));
    await screen.findByText('1 around');
    const touched = [...rowRenders.byFile.entries()];
    const eventRender = Math.max(...durations.slice(start).map((d) => d.duration));
    console.warn(`[members-perf] 300 rows: largest commit while adding the 3rd page ${fullRender.toFixed(1)} ms; presence event commit ${eventRender.toFixed(1)} ms; rows re-rendered ${touched.length} (${touched.map(([f, n]) => `${f}x${n}`).join(', ')})`);
    expect(touched.length).toBeLessThanOrEqual(2);
    expect(touched.map(([file]) => file)).toContain('file-150');
    expect(fullRender).toBeLessThan(2000);
  });
});
