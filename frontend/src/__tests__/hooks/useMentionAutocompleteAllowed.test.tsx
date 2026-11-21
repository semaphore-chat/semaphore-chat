import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createTestQueryClient, createTestWrapper } from '../test-utils';
import { useMentionAutocomplete } from '../../hooks/useMentionAutocomplete';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const members = [
  { user: { id: 'u-alice', username: 'alice', displayName: 'Alice' } },
  { user: { id: 'u-bob', username: 'bob', displayName: 'Bob' } },
  { user: { id: 'u-carol', username: 'carol', displayName: null } },
];
vi.mock('../../hooks/useAllCommunityMembers', () => ({
  useAllCommunityMembers: () => ({ data: members, isLoading: false }),
}));

const API = 'http://localhost:3000/api';

beforeEach(() => {
  server.use(http.get(`${API}/alias-groups/community/:communityId`, () => HttpResponse.json([])));
});

function render(props: { allowedUserIds?: ReadonlySet<string> | null; allowedLoading?: boolean }) {
  return renderHook(
    () => useMentionAutocomplete({ communityId: 'c-1', text: '@', cursorPosition: 1, ...props }),
    { wrapper: createTestWrapper({ queryClient: createTestQueryClient() }) },
  );
}

const userIds = (s: { suggestions: { type: string; id: string }[] }) =>
  s.suggestions.filter((x) => x.type === 'user').map((x) => x.id);

describe('useMentionAutocomplete allowedUserIds', () => {
  it('no allowed set: every member is suggested (classic default)', async () => {
    const { result } = render({});
    await waitFor(() => expect(userIds(result.current.state)).toEqual(['u-alice', 'u-bob', 'u-carol']));
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));
  });

  it('null: no filter either', async () => {
    const { result } = render({ allowedUserIds: null });
    await waitFor(() => expect(userIds(result.current.state)).toHaveLength(3));
  });

  it('a Set: only those members; special mentions stay', async () => {
    const { result } = render({ allowedUserIds: new Set(['u-bob']) });
    await waitFor(() => expect(userIds(result.current.state)).toEqual(['u-bob']));
    expect(result.current.state.suggestions.some((s) => s.type === 'special')).toBe(true);
  });

  it('an empty Set: no users; allowedLoading shows as loading', async () => {
    const { result } = render({ allowedUserIds: new Set(), allowedLoading: true });
    await waitFor(() => expect(result.current.state.suggestions.length).toBeGreaterThan(0));
    expect(userIds(result.current.state)).toEqual([]);
    expect(result.current.state.isLoading).toBe(true);
  });
});
