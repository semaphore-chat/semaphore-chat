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

import { useChannelNotifications } from '../../data/channelNotifications';

const BASE = 'http://localhost:3000';
const OVERRIDE = `${BASE}/api/notifications/channels/ch-1/override`;
const SETTINGS = `${BASE}/api/notifications/settings`;

/** The server's state and every request it saw, for one test. */
function serve({ override, defaultChannelLevel = 'mentions', failWrites = false }: { override?: string; defaultChannelLevel?: string; failWrites?: boolean } = {}) {
  const state = { override, requests: [] as string[], body: undefined as unknown };
  server.use(
    http.get(SETTINGS, () => {
      state.requests.push('GET settings');
      return HttpResponse.json({ defaultChannelLevel });
    }),
    http.get(OVERRIDE, () => {
      state.requests.push('GET override');
      return state.override === undefined ? new HttpResponse(null, { status: 200 }) : HttpResponse.json({ level: state.override });
    }),
    http.put(OVERRIDE, async ({ request }) => {
      state.requests.push('PUT override');
      if (failWrites) return HttpResponse.json({ message: 'nope' }, { status: 500 });
      state.body = await request.json();
      state.override = (state.body as { level: string }).level;
      return HttpResponse.json({ level: state.override });
    }),
    http.delete(OVERRIDE, () => {
      state.requests.push('DELETE override');
      if (failWrites) return HttpResponse.json({ message: 'nope' }, { status: 500 });
      state.override = undefined;
      return new HttpResponse(null, { status: 200 });
    }),
  );
  return state;
}

const render = (enabled?: boolean) =>
  renderHook(() => useChannelNotifications('ch-1', enabled), { wrapper: createTestWrapper({ queryClient: createTestQueryClient() }) });

describe('useChannelNotifications', () => {
  it('with no override follows the default channel level', async () => {
    serve({ defaultChannelLevel: 'all' });
    const { result } = render();
    await waitFor(() => expect(result.current.defaultLevel).toBe('all'));
    expect(result.current.choice).toBe('default');
    expect(result.current.effective).toBe('all');
    expect(result.current.loading).toBe(false);
  });

  it('falls back to mentions while the settings have not come', () => {
    serve();
    const { result } = render();
    expect(result.current.defaultLevel).toBe('mentions');
    expect(result.current.effective).toBe('mentions');
  });

  it('an existing override is the choice and what applies', async () => {
    serve({ override: 'none', defaultChannelLevel: 'all' });
    const { result } = render();
    await waitFor(() => expect(result.current.choice).toBe('none'));
    expect(result.current.effective).toBe('none');
  });

  it('setting a level PUTs it and then shows it', async () => {
    const server_ = serve();
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.setChoice('all'));
    expect(server_.requests).toContain('PUT override');
    expect(server_.body).toEqual({ level: 'all' });
    await waitFor(() => expect(result.current.choice).toBe('all'));
  });

  it('choosing "default" DELETEs the override and goes back to following the default', async () => {
    const server_ = serve({ override: 'none' });
    const { result } = render();
    await waitFor(() => expect(result.current.choice).toBe('none'));
    await act(() => result.current.setChoice('default'));
    expect(server_.requests).toContain('DELETE override');
    expect(server_.requests).not.toContain('PUT override');
    await waitFor(() => expect(result.current.choice).toBe('default'));
  });

  it('a refused change rejects, and the choice stays what it was', async () => {
    serve({ override: 'mentions', failWrites: true });
    const { result } = render();
    await waitFor(() => expect(result.current.choice).toBe('mentions'));
    await act(async () => {
      await expect(result.current.setChoice('all')).rejects.toBeTruthy();
      await expect(result.current.setChoice('default')).rejects.toBeTruthy();
    });
    expect(result.current.choice).toBe('mentions');
    expect(result.current.busy).toBe(false);
  });

  it('enabled=false sends no requests', async () => {
    const server_ = serve({ override: 'all' });
    const { result } = render(false);
    await act(async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server_.requests).toEqual([]);
    expect(result.current.choice).toBe('default');
  });
});
