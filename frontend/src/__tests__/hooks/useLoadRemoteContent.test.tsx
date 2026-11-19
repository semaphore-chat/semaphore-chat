import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createAppearanceSettings, createTestQueryClient, seedAppearanceSettings } from '../test-utils';
import { useLoadRemoteContent } from '../../hooks/useLoadRemoteContent';
import { appearanceSettingsControllerGetSettingsQueryKey } from '../../api-client/@tanstack/react-query.gen';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const URL = 'http://localhost:3000/api/appearance-settings';

function setup(queryClient = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useLoadRemoteContent(), { wrapper }) };
}

describe('useLoadRemoteContent', () => {
  it('answers false until the settings load, then the setting (on)', async () => {
    server.use(http.get(URL, () => HttpResponse.json(createAppearanceSettings({ loadRemoteContent: true }))));
    const { result } = setup();
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('answers false when the reader turned it off', async () => {
    let requests = 0;
    server.use(
      http.get(URL, () => {
        requests += 1;
        return HttpResponse.json(createAppearanceSettings({ loadRemoteContent: false }));
      }),
    );
    const { result } = setup();
    await waitFor(() => expect(requests).toBe(1));
    expect(result.current).toBe(false);
  });

  it('answers true when an older server sends settings without the field', async () => {
    server.use(
      http.get(URL, () => {
        const { loadRemoteContent: _omit, ...old } = createAppearanceSettings();
        return HttpResponse.json(old);
      }),
    );
    const { result } = setup();
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays false when the settings request failed, and a mounting row does not refetch it', async () => {
    let requests = 0;
    server.use(
      http.get(URL, () => {
        requests += 1;
        return HttpResponse.json({ message: 'nope' }, { status: 500 });
      }),
    );
    const { queryClient, result } = setup();
    await waitFor(() => expect(requests).toBeGreaterThan(0));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    const before = requests;
    const second = renderHook(() => useLoadRemoteContent(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(second.result.current).toBe(false);
    expect(requests).toBe(before);
  });

  it('reads the settings already in the cache without a request of its own, even when they are old', async () => {
    let requests = 0;
    server.use(
      http.get(URL, () => {
        requests += 1;
        return HttpResponse.json(createAppearanceSettings());
      }),
    );
    const queryClient = createTestQueryClient();
    seedAppearanceSettings(queryClient, { loadRemoteContent: true });
    // Settings the shell loaded long ago: a row mounting now must not refetch them.
    queryClient.getQueryCache().find({ queryKey: appearanceSettingsControllerGetSettingsQueryKey() })!.state.dataUpdatedAt = 1;
    const { result } = setup(queryClient);
    expect(result.current).toBe(true);
    await act(async () => {});
    expect(requests).toBe(0);
  });

  it('follows a change of the setting in the cache', async () => {
    const queryClient = createTestQueryClient();
    seedAppearanceSettings(queryClient, { loadRemoteContent: true });
    const { result } = setup(queryClient);
    expect(result.current).toBe(true);
    act(() => seedAppearanceSettings(queryClient, { loadRemoteContent: false }));
    await waitFor(() => expect(result.current).toBe(false));
  });
});
