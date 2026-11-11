import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import SessionsSettings from '../../components/Settings/SessionsSettings';

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

const { getCurrentPushSubscription } = vi.hoisted(() => ({ getCurrentPushSubscription: vi.fn() }));
vi.mock('../../utils/pushSubscription', () => ({
  isPushSupported: () => true,
  hasNotificationPermission: () => true,
  getCurrentPushSubscription,
  extractSubscriptionData: (sub: { endpoint: string }) => ({
    endpoint: sub.endpoint,
    keys: { p256dh: 'p', auth: 'a' },
    userAgent: 'test',
  }),
}));

const session = (id: string, isCurrent: boolean) => ({
  id,
  deviceName: id,
  ipAddress: null,
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  isCurrent,
});

describe('SessionsSettings: signing out everywhere else', () => {
  let order: string[];
  let posted: { endpoint: string }[];

  beforeEach(() => {
    order = [];
    posted = [];
    getCurrentPushSubscription.mockReset();
    server.use(
      http.get('http://localhost:3000/api/auth/sessions', () =>
        HttpResponse.json([session('this', true), session('other', false)]),
      ),
      http.delete('http://localhost:3000/api/auth/sessions', () => {
        order.push('revoke');
        return HttpResponse.json({ message: 'Signed out', revokedCount: 1 });
      }),
      http.post('http://localhost:3000/api/push/subscribe', async ({ request }) => {
        order.push('subscribe');
        posted.push((await request.json()) as { endpoint: string });
        return HttpResponse.json({ success: true, message: 'ok' }, { status: 201 });
      }),
    );
  });

  const signOutOthers = async (user: ReturnType<typeof renderWithProviders>['user']) => {
    await user.click(await screen.findByRole('button', { name: /Sign Out All Other Sessions/ }));
    await user.click(await screen.findByRole('button', { name: 'Sign Out All' }));
    await waitFor(() => expect(order).toContain('revoke'));
  };

  it("gives the server this device's push subscription back afterwards", async () => {
    getCurrentPushSubscription.mockResolvedValue({ endpoint: 'https://push.example/this-device' });
    const { user } = renderWithProviders(<SessionsSettings />);

    await signOutOthers(user);

    await waitFor(() => expect(order).toEqual(['revoke', 'subscribe']));
    expect(posted[0].endpoint).toBe('https://push.example/this-device');
  });

  it('posts nothing for a device without push', async () => {
    getCurrentPushSubscription.mockResolvedValue(null);
    const { user } = renderWithProviders(<SessionsSettings />);

    await signOutOthers(user);

    await waitFor(() => expect(getCurrentPushSubscription).toHaveBeenCalled());
    expect(posted).toEqual([]);
  });
});
