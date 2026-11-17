import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';
import { createTestQueryClient, createTestWrapper } from '../../test-utils';
import { REACTION_PEOPLE_SHOWN, useReactionPeople } from '../../../data/chat/useReactionPeople';

vi.mock('../../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

function users() {
  server.use(
    http.get('http://localhost:3000/api/users/:id', ({ params }) => {
      if (params.id === 'gone-1234') return new HttpResponse(null, { status: 404 });
      if (params.id === 'plain') return HttpResponse.json({ id: 'plain', username: 'plainname', displayName: null });
      return HttpResponse.json({ id: params.id, username: `u-${params.id}`, displayName: `Name ${params.id}` });
    }),
  );
}

const render = (ids: string[] | null) =>
  renderHook(() => useReactionPeople(ids), { wrapper: createTestWrapper({ queryClient: createTestQueryClient() }) });

describe('useReactionPeople', () => {
  it('names each person: display name, else username, else "User" and the id end; null while loading', async () => {
    users();
    const { result } = render(['a', 'plain', 'gone-1234']);
    expect(result.current.people.map((p) => p.name)).toEqual([null, null, null]);
    await waitFor(() =>
      expect(result.current.people).toEqual([
        { id: 'a', name: 'Name a' },
        { id: 'plain', name: 'plainname' },
        { id: 'gone-1234', name: 'User 1234' },
      ]),
    );
    expect(result.current.more).toBe(0);
  });

  it(`names the first ${REACTION_PEOPLE_SHOWN} and counts the rest; a missing list is nobody`, async () => {
    users();
    const ids = Array.from({ length: 18 }, (_, i) => `p${i}`);
    const { result } = render(ids);
    expect(result.current.people).toHaveLength(REACTION_PEOPLE_SHOWN);
    expect(result.current.more).toBe(3);
    expect(render(null).result.current).toEqual({ people: [], more: 0 });
  });
});
