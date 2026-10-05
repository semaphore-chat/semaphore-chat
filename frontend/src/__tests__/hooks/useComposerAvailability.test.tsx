import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../msw/server';
import { createTestQueryClient } from '../test-utils/queryClient';
import { createTestWrapper } from '../test-utils/wrappers';
import { useComposerAvailability } from '../../hooks/useComposerAvailability';
import { VoiceSessionType } from '../../contexts/VoiceContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const BASE = 'http://localhost:3000';
const COMMUNITY = '11111111-1111-4111-8111-111111111111';
const CHANNEL = '22222222-2222-4222-8222-222222222222';

const ALL = {
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
  timedOutUntil: null as string | null,
  postingRoleNames: [] as string[],
};

/** permissions/me for the community; `caps` null = the channel is hidden. */
function capsFor(caps: Partial<typeof ALL> | null) {
  return http.get(`${BASE}/api/channels/community/:communityId/permissions/me`, () =>
    HttpResponse.json({
      communityId: COMMUNITY,
      channels: caps ? [{ channelId: CHANNEL, ...ALL, ...caps }] : [],
    }),
  );
}

function channelWith(preset: string) {
  return http.get(`${BASE}/api/channels/:id`, ({ params }) =>
    HttpResponse.json({
      id: String(params.id),
      name: 'announcements',
      communityId: COMMUNITY,
      type: 'TEXT',
      isPrivate: false,
      preset,
    }),
  );
}

function renderAvailability(
  contextType = VoiceSessionType.Channel,
  communityId: string | undefined = COMMUNITY,
  thread = false,
) {
  const queryClient = createTestQueryClient();
  return renderHook(
    () =>
      useComposerAvailability({
        contextType,
        contextId: contextType === VoiceSessionType.Channel ? CHANNEL : 'dm-1',
        communityId,
        thread,
      }),
    { wrapper: createTestWrapper({ queryClient }) },
  );
}

describe('useComposerAvailability', () => {
  beforeEach(() => {
    server.use(channelWith('NORMAL'));
  });

  it('is always ok in a DM', () => {
    const { result } = renderAvailability(VoiceSessionType.Dm, undefined);
    expect(result.current).toEqual({ state: 'ok', canAttach: true });
  });

  it('fails open while the capabilities load', () => {
    server.use(
      http.get(`${BASE}/api/channels/community/:communityId/permissions/me`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const { result } = renderAvailability();
    expect(result.current.state).toBe('ok');
    expect(result.current.canAttach).toBe(true);
  });

  it('fails open when the capabilities request errors (the server still enforces)', async () => {
    server.use(
      http.get(`${BASE}/api/channels/community/:communityId/permissions/me`, () =>
        new HttpResponse(null, { status: 500 })),
    );
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.channelName).toBe('announcements'));
    expect(result.current.state).toBe('ok');
  });

  it('is ok when the user can post', async () => {
    server.use(capsFor({}));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.channelName).toBe('announcements'));
    expect(result.current).toMatchObject({ state: 'ok', canAttach: true });
  });

  it('reports canAttach false when the user can post but not attach', async () => {
    server.use(capsFor({ attach: false }));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.canAttach).toBe(false));
    expect(result.current.state).toBe('ok');
  });

  it.each(['ANNOUNCEMENT', 'READ_ONLY'])(
    'is read-only in a %s channel, naming who can post',
    async (preset) => {
      server.use(
        channelWith(preset),
        capsFor({ post: false, attach: false, postingRoleNames: ['Moderator', 'Community Admin'] }),
      );
      const { result } = renderAvailability();
      await waitFor(() => expect(result.current.state).toBe('read-only'));
      expect(result.current.postingRoleNames).toEqual(['Moderator', 'Community Admin']);
      expect(result.current.channelName).toBe('announcements');
    },
  );

  it('is no-permission when the user can\'t post in a channel without a read-only preset', async () => {
    server.use(capsFor({ post: false }));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.state).toBe('no-permission'));
    await waitFor(() => expect(result.current.channelName).toBe('announcements'));
  });

  it('is no-permission for a channel the user can\'t see', async () => {
    server.use(channelWith('ANNOUNCEMENT'), capsFor(null));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.state).toBe('no-permission'));
  });

  it('checks threadReply instead of post for thread composers', async () => {
    server.use(capsFor({ post: true, threadReply: false }));
    const thread = renderAvailability(VoiceSessionType.Channel, COMMUNITY, true);
    await waitFor(() => expect(thread.result.current.state).toBe('no-permission'));

    server.use(capsFor({ post: false, threadReply: true }));
    const threadOk = renderAvailability(VoiceSessionType.Channel, COMMUNITY, true);
    await waitFor(() => expect(threadOk.result.current.channelName).toBe('announcements'));
    expect(threadOk.result.current.state).toBe('ok');
  });

  it('is timed-out with a countdown while a timeout is active', async () => {
    const until = new Date(Date.now() + 12 * 60_000).toISOString();
    server.use(capsFor({ post: false, attach: false, react: false, timedOutUntil: until }));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.state).toBe('timed-out'));
    expect(result.current.until?.toISOString()).toBe(until);
    expect(result.current.remainingMs).toBeGreaterThan(11 * 60_000);
    expect(result.current.remainingMs).toBeLessThanOrEqual(12 * 60_000);
    expect(result.current.canAttach).toBe(false);
  });

  it('ignores a timeout that already ended', async () => {
    const until = new Date(Date.now() - 60_000).toISOString();
    server.use(capsFor({ timedOutUntil: until }));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.channelName).toBe('announcements'));
    expect(result.current.state).toBe('ok');
  });
});
