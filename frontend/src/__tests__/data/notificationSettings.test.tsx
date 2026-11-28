import { describe, it, expect, vi } from 'vitest';
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

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  useNotificationSettingsForm,
  useTestPush,
  valuesFromServer,
} from '../../data/notificationSettings';
import { notificationsControllerGetSettingsQueryKey } from '../../api-client/@tanstack/react-query.gen';

const BASE = 'http://localhost:3000';
const SETTINGS = `${BASE}/api/notifications/settings`;
const TEST_PUSH = `${BASE}/api/push/test`;

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 's-1',
  userId: 'u-1',
  desktopEnabled: false,
  playSound: true,
  soundType: 'mention',
  doNotDisturb: true,
  dndStartTime: '23:00',
  dndEndTime: '07:30',
  defaultChannelLevel: 'all',
  dmNotifications: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function serve({ failWrites = false, initial = row() }: { failWrites?: boolean; initial?: Record<string, unknown> } = {}) {
  const state = { row: initial, puts: [] as Record<string, unknown>[] };
  server.use(
    http.get(SETTINGS, () => HttpResponse.json(state.row)),
    http.put(SETTINGS, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.puts.push(body);
      if (failWrites) return HttpResponse.json({ message: 'nope' }, { status: 500 });
      state.row = { ...state.row, ...body };
      return HttpResponse.json(state.row);
    }),
  );
  return state;
}

const renderForm = () => {
  const queryClient = createTestQueryClient();
  return { queryClient, ...renderHook(() => useNotificationSettingsForm(), { wrapper: createTestWrapper({ queryClient }) }) };
};

describe('valuesFromServer', () => {
  it('keeps the defaults for unknown unions and empty DND times', () => {
    const values = valuesFromServer(
      row({ soundType: 'klaxon', defaultChannelLevel: 'some', dndStartTime: null, dndEndTime: '' }) as never,
    );
    expect(values.soundType).toBe('default');
    expect(values.defaultChannelLevel).toBe('mentions');
    expect(values.dndStartTime).toBe('22:00');
    expect(values.dndEndTime).toBe('08:00');
  });
});

describe('useNotificationSettingsForm', () => {
  it('shows the defaults and is not dirty while loading', () => {
    serve();
    const { result } = renderForm();
    expect(result.current.loading).toBe(true);
    expect(result.current.values).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(result.current.saved).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(result.current.changes).toBe(0);
  });

  it('loads the server values into the draft', async () => {
    serve();
    const { result } = renderForm();
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    expect(result.current.values).toEqual({
      desktopEnabled: false,
      playSound: true,
      soundType: 'mention',
      doNotDisturb: true,
      dndStartTime: '23:00',
      dndEndTime: '07:30',
      defaultChannelLevel: 'all',
      dmNotifications: false,
    });
    expect(result.current.dirty).toBe(false);
  });

  it('counts changes, and a change back to the saved value is not one', async () => {
    serve();
    const { result } = renderForm();
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    act(() => result.current.change('playSound', false));
    act(() => result.current.change('defaultChannelLevel', 'none'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.changes).toBe(2);
    act(() => result.current.change('playSound', true));
    expect(result.current.changes).toBe(1);
  });

  it('reset goes back to the saved values', async () => {
    serve();
    const { result } = renderForm();
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    act(() => result.current.change('dmNotifications', true));
    act(() => result.current.reset());
    expect(result.current.values.dmNotifications).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('save sends the draft with the time zone, and the draft becomes the saved values', async () => {
    const state = serve();
    const { result } = renderForm();
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    act(() => result.current.change('dndStartTime', '21:15'));
    await act(() => result.current.save());
    expect(state.puts).toHaveLength(1);
    expect(state.puts[0]).toMatchObject({ dndStartTime: '21:15', defaultChannelLevel: 'all' });
    expect(state.puts[0].dndTimezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(result.current.values.dndStartTime).toBe('21:15');
  });

  it('a failed save rejects and keeps the draft dirty', async () => {
    serve({ failWrites: true });
    const { result } = renderForm();
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    act(() => result.current.change('desktopEnabled', true));
    await act(async () => {
      await expect(result.current.save()).rejects.toBeDefined();
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.values.desktopEnabled).toBe(true);
  });

  it('reports a load error', async () => {
    server.use(http.get(SETTINGS, () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
    const { result } = renderForm();
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.loading).toBe(false);
  });

  it('uses the generated cache key (shared with the chat header)', async () => {
    serve();
    const { result, queryClient } = renderForm();
    await waitFor(() => expect(result.current.saved).not.toBeNull());
    expect(queryClient.getQueryData(notificationsControllerGetSettingsQueryKey())).toMatchObject({ soundType: 'mention' });
  });
});

describe('useTestPush', () => {
  const renderPush = () => renderHook(() => useTestPush(), { wrapper: createTestWrapper({ queryClient: createTestQueryClient() }) });

  it("returns the server's result", async () => {
    server.use(http.post(TEST_PUSH, () => HttpResponse.json({ success: true, message: 'Sent to 2 devices' })));
    const { result } = renderPush();
    let answer: unknown;
    await act(async () => {
      answer = await result.current.send();
    });
    expect(answer).toEqual({ success: true, message: 'Sent to 2 devices' });
  });

  it('turns a failed request into a failed result', async () => {
    server.use(http.post(TEST_PUSH, () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
    const { result } = renderPush();
    let answer: unknown;
    await act(async () => {
      answer = await result.current.send();
    });
    expect(answer).toEqual({ success: false, message: 'Failed to send test push notification' });
  });
});
