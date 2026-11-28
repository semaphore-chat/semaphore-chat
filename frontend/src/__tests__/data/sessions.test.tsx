import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createTestQueryClient, createTestWrapper } from '../test-utils';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), log: vi.fn() },
}));
const push = vi.hoisted(() => ({ supported: true, permission: true, getCurrentPushSubscription: vi.fn() }));
vi.mock('../../utils/pushSubscription', () => ({
  isPushSupported: () => push.supported,
  hasNotificationPermission: () => push.permission,
  getCurrentPushSubscription: push.getCurrentPushSubscription,
  extractSubscriptionData: (sub: { endpoint: string }) => ({ endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } }),
}));

import { useSessions } from '../../data/sessions';

const BASE = 'http://localhost:3000/api';
const session = (id: string, isCurrent: boolean) => ({
  id,
  deviceName: id,
  ipAddress: null,
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  isCurrent,
});

let list: ReturnType<typeof session>[];
let calls: string[];
let fail: boolean;

beforeEach(() => {
  list = [session('this', true), session('a', false), session('b', false)];
  calls = [];
  fail = false;
  push.supported = true;
  push.permission = true;
  push.getCurrentPushSubscription.mockReset();
  server.use(
    http.get(`${BASE}/auth/sessions`, () => {
      calls.push('GET');
      return HttpResponse.json(list);
    }),
    http.delete(`${BASE}/auth/sessions/:sessionId`, ({ params }) => {
      calls.push(`DELETE ${String(params.sessionId)}`);
      if (fail) return HttpResponse.json({ message: 'nope' }, { status: 500 });
      list = list.filter((entry) => entry.id !== params.sessionId);
      return HttpResponse.json({ message: 'Session revoked' });
    }),
    http.delete(`${BASE}/auth/sessions`, () => {
      calls.push('DELETE others');
      if (fail) return HttpResponse.json({ message: 'nope' }, { status: 500 });
      list = list.filter((entry) => entry.isCurrent);
      return HttpResponse.json({ message: 'Signed out of 2 sessions', revokedCount: 2 });
    }),
    http.post(`${BASE}/push/subscribe`, () => {
      calls.push('subscribe');
      return HttpResponse.json({ success: true, message: 'ok' }, { status: 201 });
    }),
  );
});

const render = () => renderHook(() => useSessions(), { wrapper: createTestWrapper({ queryClient: createTestQueryClient() }) });

describe('useSessions', () => {
  it('lists the sessions and counts the other ones', async () => {
    const { result } = render();
    expect(result.current.loading).toBe(true);
    expect(result.current.sessions).toEqual([]);
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    expect(result.current.otherCount).toBe(2);
  });

  it('revoke signs one out and refreshes the list', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    await act(() => result.current.revoke('a'));
    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toEqual(['this', 'b']));
    expect(calls).toContain('DELETE a');
  });

  it('revoke rejects when the server refuses', async () => {
    fail = true;
    const { result } = render();
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    await act(async () => {
      await expect(result.current.revoke('a')).rejects.toBeDefined();
    });
  });

  it("revokeOthers resolves with the server's message and keeps this device's push", async () => {
    push.getCurrentPushSubscription.mockResolvedValue({ endpoint: 'https://push.example/this' });
    const { result } = render();
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    let message = '';
    await act(async () => {
      message = await result.current.revokeOthers();
    });
    expect(message).toBe('Signed out of 2 sessions');
    expect(calls.filter((call) => call !== 'GET')).toEqual(['DELETE others', 'subscribe']);
    await waitFor(() => expect(result.current.otherCount).toBe(0));
  });

  it('revokeOthers posts no subscription without notification permission', async () => {
    push.permission = false;
    const { result } = render();
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    await act(() => result.current.revokeOthers());
    expect(push.getCurrentPushSubscription).not.toHaveBeenCalled();
    expect(calls).not.toContain('subscribe');
  });

  it('revokeOthers still resolves when keeping push fails', async () => {
    push.getCurrentPushSubscription.mockRejectedValue(new Error('no service worker'));
    const { result } = render();
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    await act(async () => {
      await expect(result.current.revokeOthers()).resolves.toBe('Signed out of 2 sessions');
    });
  });

  it('revokeOthers rejects when the server refuses, and keeps nothing', async () => {
    fail = true;
    push.getCurrentPushSubscription.mockResolvedValue({ endpoint: 'https://push.example/this' });
    const { result } = render();
    await waitFor(() => expect(result.current.sessions).toHaveLength(3));
    await act(async () => {
      await expect(result.current.revokeOthers()).rejects.toBeDefined();
    });
    expect(calls).not.toContain('subscribe');
  });

  it('reports a load error', async () => {
    server.use(http.get(`${BASE}/auth/sessions`, () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
    const { result } = render();
    await waitFor(() => expect(result.current.error).toBe(true));
  });
});
