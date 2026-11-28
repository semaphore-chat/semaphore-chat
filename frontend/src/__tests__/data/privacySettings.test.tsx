import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createAppearanceSettings, createTestQueryClient, createTestWrapper } from '../test-utils';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

import { privacyUnsupported, usePrivacySettings } from '../../data/privacySettings';

const URL = 'http://localhost:3000/api/appearance-settings';

function serve(initial: Record<string, unknown>, { failWrites = false } = {}) {
  const state = { stored: initial, patches: [] as unknown[] };
  // Each write is held until `release()`, so the optimistic value can be seen.
  let release: () => void = () => {};
  const held = () => new Promise<void>((resolve) => (release = resolve));
  server.use(
    http.get(URL, () => HttpResponse.json(state.stored)),
    http.patch(URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.patches.push(body);
      await held();
      if (failWrites) return HttpResponse.json({ message: 'nope' }, { status: 500 });
      state.stored = { ...state.stored, ...body };
      return HttpResponse.json(state.stored);
    }),
  );
  return { state, release: () => release() };
}

const render = () => renderHook(() => usePrivacySettings(), { wrapper: createTestWrapper({ queryClient: createTestQueryClient() }) });

describe('privacyUnsupported', () => {
  it('is true only for a loaded row without the boolean', () => {
    expect(privacyUnsupported(undefined, false)).toBe(false);
    expect(privacyUnsupported({}, true)).toBe(false);
    expect(privacyUnsupported({ loadRemoteContent: false }, false)).toBe(false);
    expect(privacyUnsupported({ themeMode: 'dark' }, false)).toBe(true);
  });
});

describe('usePrivacySettings', () => {
  it('is supported (and undecided) while loading', () => {
    serve(createAppearanceSettings());
    const { result } = render();
    expect(result.current.loading).toBe(true);
    expect(result.current.supported).toBe(true);
    expect(result.current.loadRemoteContent).toBeUndefined();
  });

  it("reads the server's value", async () => {
    serve(createAppearanceSettings({ loadRemoteContent: false }));
    const { result } = render();
    await waitFor(() => expect(result.current.loadRemoteContent).toBe(false));
  });

  it('is unsupported on a server without the setting', async () => {
    const { loadRemoteContent: _omit, ...old } = createAppearanceSettings();
    serve(old);
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.supported).toBe(false);
    expect(result.current.loadRemoteContent).toBeUndefined();
  });

  it('moves at once and keeps the value once saved', async () => {
    const { state, release } = serve(createAppearanceSettings({ loadRemoteContent: true }));
    const { result } = render();
    await waitFor(() => expect(result.current.loadRemoteContent).toBe(true));
    act(() => result.current.setLoadRemoteContent(false));
    await waitFor(() => expect(result.current.loadRemoteContent).toBe(false));
    expect(result.current.saving).toBe(true);
    await waitFor(() => expect(state.patches).toEqual([{ loadRemoteContent: false }]));
    act(() => release());
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.loadRemoteContent).toBe(false);
    expect(result.current.saveFailed).toBe(false);
  });

  it('goes back when the save fails', async () => {
    const { state, release } = serve(createAppearanceSettings({ loadRemoteContent: true }), { failWrites: true });
    const { result } = render();
    await waitFor(() => expect(result.current.loadRemoteContent).toBe(true));
    act(() => result.current.setLoadRemoteContent(false));
    await waitFor(() => expect(result.current.loadRemoteContent).toBe(false));
    await waitFor(() => expect(state.patches).toHaveLength(1));
    act(() => release());
    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    expect(result.current.loadRemoteContent).toBe(true);
  });
});
