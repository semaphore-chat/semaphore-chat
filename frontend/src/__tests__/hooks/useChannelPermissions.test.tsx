import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../msw/server';
import { createTestQueryClient } from '../test-utils/queryClient';
import { createTestWrapper } from '../test-utils/wrappers';
import { useChannelPermissions } from '../../hooks/useChannelPermissions';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE = 'http://localhost:3000';
const COMMUNITY = 'community-1';

const caps = (channelId: string, over: Record<string, unknown> = {}) => ({
  channelId,
  view: true,
  post: true,
  attach: true,
  react: true,
  threadReply: true,
  connect: true,
  speak: true,
  video: true,
  share: true,
  managePermissions: false,
  timedOutUntil: null,
  postingRoleNames: [],
  ...over,
});

function serve(channels: ReturnType<typeof caps>[]) {
  let calls = 0;
  server.use(
    http.get(`${BASE}/api/channels/community/:communityId/permissions/me`, () => {
      calls += 1;
      return HttpResponse.json({ communityId: COMMUNITY, channels });
    }),
  );
  return { calls: () => calls };
}

function render(channelId: string | undefined, communityId: string | null = COMMUNITY) {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    ...renderHook(() => useChannelPermissions(communityId ?? undefined, channelId), {
      wrapper: createTestWrapper({ queryClient }),
    }),
  };
}

describe('useChannelPermissions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('picks the channel out of the community response', async () => {
    serve([caps('a', { post: false }), caps('b', { attach: false, postingRoleNames: ['Moderator'] })]);
    const { result } = render('b');
    await waitFor(() => expect(result.current.caps?.channelId).toBe('b'));
    expect(result.current.can('post')).toBe(true);
    expect(result.current.can('attach')).toBe(false);
    expect(result.current.postingRoleNames).toEqual(['Moderator']);
  });

  it('allows everything while loading (fails open)', () => {
    server.use(
      http.get(`${BASE}/api/channels/community/:communityId/permissions/me`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const { result } = render('a');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.caps).toBeUndefined();
    expect(result.current.can('post')).toBe(true);
    expect(result.current.can('speak')).toBe(true);
  });

  it('allows everything when the request errors', async () => {
    server.use(
      http.get(`${BASE}/api/channels/community/:communityId/permissions/me`, () =>
        new HttpResponse(null, { status: 500 })),
    );
    const { result } = render('a');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.can('post')).toBe(true);
  });

  it('a channel missing from the list is hidden: nothing is allowed', async () => {
    serve([caps('a')]);
    const { result } = render('hidden');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.caps).toBeUndefined();
    expect(result.current.can('view')).toBe(false);
    expect(result.current.can('post')).toBe(false);
  });

  it('does not query without a community (DMs)', () => {
    const served = serve([caps('a')]);
    const { result } = render('a', null);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.can('post')).toBe(true);
    expect(served.calls()).toBe(0);
  });

  it('refetches when the timeout ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const until = new Date(Date.now() + 5_000).toISOString();
    serve([caps('a', { post: false, timedOutUntil: until })]);
    const { result, queryClient } = render('a');
    await waitFor(() => expect(result.current.timedOutUntil?.toISOString()).toBe(until));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    vi.advanceTimersByTime(4_000);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('waits out a timeout longer than the 32-bit setTimeout limit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const DAY = 24 * 60 * 60 * 1000;
    const until = new Date(Date.now() + 28 * DAY).toISOString();
    serve([caps('a', { post: false, timedOutUntil: until })]);
    const { result, queryClient } = render('a');
    await waitFor(() => expect(result.current.timedOutUntil?.toISOString()).toBe(until));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    vi.advanceTimersByTime(25 * DAY);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3 * DAY - 1_000);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
