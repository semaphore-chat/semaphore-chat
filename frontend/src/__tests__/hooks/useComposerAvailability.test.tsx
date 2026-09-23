import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
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

function rolesWith(actions: string[]) {
  return http.get(`${BASE}/api/roles/my/channel/:channelId`, ({ params }) =>
    HttpResponse.json({
      resourceType: 'CHANNEL',
      userId: 'current-user-1',
      resourceId: String(params.channelId),
      roles: [{ id: 'r1', name: 'Role', actions, createdAt: '2025-01-01T00:00:00Z', isDefault: true, position: 1 }],
    }),
  );
}

function timeoutStatus(body: { isTimedOut: boolean; expiresAt?: string }) {
  return http.get(`${BASE}/api/moderation/timeout-status/:communityId/:userId`, () => HttpResponse.json(body));
}

const channelHandler = http.get(`${BASE}/api/channels/:id`, ({ params }) =>
  HttpResponse.json({ id: String(params.id), name: 'announcements', communityId: COMMUNITY, type: 'TEXT', isPrivate: false }),
);

function renderAvailability(contextType = VoiceSessionType.Channel, communityId: string | undefined = COMMUNITY) {
  const queryClient = createTestQueryClient();
  return renderHook(
    () => useComposerAvailability({ contextType, contextId: contextType === VoiceSessionType.Channel ? CHANNEL : 'dm-1', communityId }),
    { wrapper: createTestWrapper({ queryClient }) },
  );
}

describe('useComposerAvailability', () => {
  beforeEach(() => {
    server.use(channelHandler, timeoutStatus({ isTimedOut: false }));
  });

  it('is always ok in a DM', () => {
    const { result } = renderAvailability(VoiceSessionType.Dm, undefined);
    expect(result.current.state).toBe('ok');
  });

  it('is ok while permissions are still loading', () => {
    server.use(rolesWith([]));
    const { result } = renderAvailability();
    expect(result.current.state).toBe('ok');
  });

  it('is ok when the channel roles include CREATE_MESSAGE', async () => {
    server.use(rolesWith(['READ_MESSAGE', 'CREATE_MESSAGE']));
    const { result } = renderAvailability();
    // Give the queries a chance to settle, then confirm it stays ok.
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.state).toBe('ok');
  });

  it('is no-permission when the channel roles lack CREATE_MESSAGE, with the channel name', async () => {
    server.use(rolesWith(['READ_MESSAGE']));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.state).toBe('no-permission'));
    await waitFor(() => expect(result.current.channelName).toBe('announcements'));
  });

  it('lets the instance OWNER through even without roles', async () => {
    server.use(
      rolesWith([]),
      http.get(`${BASE}/api/users/profile`, () =>
        HttpResponse.json({ id: 'current-user-1', username: 'owner', role: 'OWNER' })),
    );
    const { result } = renderAvailability();
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.state).toBe('ok');
  });

  it('fails open when the roles request errors (the server still enforces)', async () => {
    server.use(http.get(`${BASE}/api/roles/my/channel/:channelId`, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderAvailability();
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.state).toBe('ok');
  });

  it('is timed-out with an expiry while a timeout is active', async () => {
    const expiresAt = new Date(Date.now() + 12 * 60_000).toISOString();
    server.use(rolesWith(['CREATE_MESSAGE']), timeoutStatus({ isTimedOut: true, expiresAt }));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.state).toBe('timed-out'));
    expect(result.current.until?.toISOString()).toBe(expiresAt);
    expect(result.current.remainingMs).toBeGreaterThan(11 * 60_000);
    expect(result.current.remainingMs).toBeLessThanOrEqual(12 * 60_000);
  });

  it('goes back to ok once the timeout expires', async () => {
    const expiresAt = new Date(Date.now() + 1200).toISOString();
    server.use(rolesWith(['CREATE_MESSAGE']), timeoutStatus({ isTimedOut: true, expiresAt }));
    const { result } = renderAvailability();
    await waitFor(() => expect(result.current.state).toBe('timed-out'));
    await waitFor(() => expect(result.current.state).toBe('ok'), { timeout: 4000 });
  });

  it('ignores a timeout-status response that already expired', async () => {
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    server.use(rolesWith(['CREATE_MESSAGE']), timeoutStatus({ isTimedOut: true, expiresAt }));
    const { result } = renderAvailability();
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.state).toBe('ok');
  });
});
