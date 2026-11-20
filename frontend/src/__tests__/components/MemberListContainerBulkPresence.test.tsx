/**
 * Design F4: the per-ids presence endpoint reads at most 200 ids, so after
 * "Show more" past the 200th member the rest always showed offline. The
 * classic member list now reads bulk presence (every visible online user).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import MemberListContainer from '../../components/Message/MemberListContainer';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import type { MemberData } from '../../components/Message/MemberList';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE = 'http://localhost:3000';

let latest: { members: MemberData[]; hasMore?: boolean; isLoading?: boolean; onLoadMore?: () => void } = { members: [] };
let loadingHistory: boolean[] = [];
vi.mock('../../components/Message/MemberList', () => ({
  default: (props: typeof latest) => {
    latest = props;
    loadingHistory.push(!!props.isLoading);
    return <div data-testid="member-list-mock">{props.members.length}</div>;
  },
}));

const TOTAL = 250;
const members = Array.from({ length: TOTAL }, (_, i) => ({
  id: `m-${i + 1}`,
  userId: `user-${i + 1}`,
  communityId: 'community-1',
  joinedAt: '2025-01-01T00:00:00Z',
  roles: [],
  user: { id: `user-${i + 1}`, username: `u${i + 1}`, displayName: `U ${i + 1}`, avatarUrl: null, status: null },
}));

describe('MemberListContainer presence past 200 members', () => {
  it('shows the 250th member online after loading every page', async () => {
    loadingHistory = [];
    const presenceRequests: string[] = [];
    server.use(
      http.get(`${BASE}/api/membership/community/community-1`, ({ request }) => {
        const start = Number(new URL(request.url).searchParams.get('continuationToken') || '0');
        const next = start + 100;
        return HttpResponse.json({
          members: members.slice(start, next),
          continuationToken: next < TOTAL ? String(next) : undefined,
        });
      }),
      // Answers both endpoints the way the server does: the per-ids one reads
      // the first 200 ids only; bulk lists every visible online user.
      http.get(`${BASE}/api/presence/users/:userIds`, ({ params }) => {
        const ids = String(params.userIds);
        presenceRequests.push(ids === 'bulk' ? 'bulk' : 'ids');
        if (ids === 'bulk') return HttpResponse.json({ presence: { 'user-250': true } });
        const first200 = ids.split(',').slice(0, 200);
        return HttpResponse.json({ presence: Object.fromEntries(first200.map((id) => [id, id === 'user-250'])) });
      }),
    );

    renderWithProviders(
      <MemberListContainer
        contextType={VoiceSessionType.Channel}
        contextId="channel-1"
        communityId="community-1"
        isPrivate={false}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('member-list-mock')).toHaveTextContent('100'));
    act(() => latest.onLoadMore?.());
    await waitFor(() => expect(screen.getByTestId('member-list-mock')).toHaveTextContent('200'));
    act(() => latest.onLoadMore?.());
    await waitFor(() => expect(screen.getByTestId('member-list-mock')).toHaveTextContent('250'));

    await waitFor(() => expect(latest.members.find((m) => m.id === 'user-250')?.isOnline).toBe(true));
    expect(latest.members.filter((m) => m.isOnline)).toHaveLength(1);
    expect(presenceRequests).not.toContain('ids');
  });

  it('keeps the list on screen across "Show more" (no skeleton flash): visible change from main', async () => {
    loadingHistory = [];
    server.use(
      http.get(`${BASE}/api/membership/community/community-1`, ({ request }) => {
        const start = Number(new URL(request.url).searchParams.get('continuationToken') || '0');
        const next = start + 100;
        return HttpResponse.json({ members: members.slice(start, next), continuationToken: next < TOTAL ? String(next) : undefined });
      }),
      http.get(`${BASE}/api/presence/users/:userIds`, () => HttpResponse.json({ presence: {} })),
    );
    renderWithProviders(
      <MemberListContainer contextType={VoiceSessionType.Channel} contextId="channel-1" communityId="community-1" isPrivate={false} />,
    );
    await waitFor(() => expect(screen.getByTestId('member-list-mock')).toHaveTextContent('100'));
    const firstLoaded = loadingHistory.lastIndexOf(true) + 1;

    act(() => latest.onLoadMore?.());
    await waitFor(() => expect(screen.getByTestId('member-list-mock')).toHaveTextContent('200'));

    // On main the per-ids presence key changed with every page, so the whole
    // list went back to its loading skeleton; with bulk presence it never does.
    expect(loadingHistory.slice(firstLoaded)).not.toContain(true);
  });
});
