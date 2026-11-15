/**
 * The design preview (`?design=` links): a per-tab override kept in
 * sessionStorage, removed from the URL, never sent to the server.
 * (Cleared on logout: hooks/useLogout.test.ts.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { ACCENT_PRIMARY } from '@semaphore-chat/shared';
import { server } from '../msw/server';
import { createTestQueryClient } from '../test-utils';
import { ThemeProvider, useTheme } from '../../contexts/ThemeContext';
import { useThemeSync } from '../../hooks/useThemeSync';
import { STORAGE_KEY } from '../../theme/constants';
import {
  DESIGN_PREVIEW_KEY,
  clearDesignPreview,
  readDesignPreview,
  setDesignPreview,
  useDesignPreview,
  useDesignPreviewParam,
} from '../../shell/designPreview';

const BASE_URL = 'http://localhost:3000';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

let location: { pathname: string; search: string; state: unknown };
let newDesign: boolean;
let navigate: ReturnType<typeof useNavigate>;

function Probe() {
  useDesignPreviewParam();
  navigate = useNavigate();
  useThemeSync();
  newDesign = useTheme().newDesign;
  const current = useLocation();
  location = { pathname: current.pathname, search: current.search, state: current.state };
  return null;
}

function renderAt(entry: string | { pathname: string; search: string; state: unknown }) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Probe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

let appearanceRequests: string[];

/** Lets queries, effects and any PATCH they would send run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  appearanceRequests = [];
  const appearance = {
    id: 'appearance-1',
    userId: 'user-1',
    themeMode: 'dark',
    accentColor: 'teal',
    intensity: 'minimal',
    baseColor: ACCENT_PRIMARY.teal,
    matchSystem: false,
    newDesign: false,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
  server.use(
    http.all(`${BASE_URL}/api/appearance-settings`, ({ request }) => {
      appearanceRequests.push(request.method);
      return HttpResponse.json(appearance);
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  clearDesignPreview();
});

describe('?design= in the URL', () => {
  it('lounge: turns the preview on for this tab and removes the parameter, keeping the rest of the URL', async () => {
    renderAt({ pathname: '/__lounge', search: '?design=lounge&tab=2', state: { from: 'x' } });
    await waitFor(() => expect(location.search).toBe('?tab=2'));
    expect(location.pathname).toBe('/__lounge');
    expect(location.state).toEqual({ from: 'x' });
    expect(sessionStorage.getItem(DESIGN_PREVIEW_KEY)).toBe('lounge');
  });

  it('classic: turns the preview off for this tab', async () => {
    renderAt('/settings?design=classic');
    await waitFor(() => expect(location.search).toBe(''));
    expect(location.pathname).toBe('/settings');
    expect(readDesignPreview()).toBe('classic');
  });

  it('reset: drops the override', async () => {
    setDesignPreview('lounge');
    renderAt('/?design=reset');
    await waitFor(() => expect(location.search).toBe(''));
    expect(readDesignPreview()).toBeNull();
    expect(sessionStorage.getItem(DESIGN_PREVIEW_KEY)).toBeNull();
  });

  it('an unknown value changes nothing but is still removed from the URL', async () => {
    setDesignPreview('classic');
    renderAt('/?design=purple');
    await waitFor(() => expect(location.search).toBe(''));
    expect(readDesignPreview()).toBe('classic');
  });

  it('a URL without the parameter is left alone', async () => {
    renderAt('/settings?tab=2');
    await act(async () => {});
    expect(location.search).toBe('?tab=2');
    expect(readDesignPreview()).toBeNull();
  });

  it('never changes the account setting or sends anything to the server', async () => {
    renderAt('/settings');
    // The account's settings are read and applied first (the server wins on load)...
    await waitFor(() => expect(appearanceRequests).toContain('GET'));
    await settle();
    // ...then a preview link is followed inside the app.
    act(() => navigate('/__lounge?design=lounge'));
    await waitFor(() => expect(readDesignPreview()).toBe('lounge'));
    await settle();
    expect(appearanceRequests.filter((method) => method !== 'GET')).toEqual([]);
    expect(newDesign).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').newDesign ?? false).toBe(false);
  });
});

describe('the preview store', () => {
  it('notifies readers when the override changes', () => {
    const { result } = renderHook(() => useDesignPreview());
    expect(result.current).toBeNull();
    act(() => setDesignPreview('lounge'));
    expect(result.current).toBe('lounge');
    act(() => clearDesignPreview());
    expect(result.current).toBeNull();
  });

  it('tolerates storage that throws: the override then lives in memory for the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useDesignPreview());
    expect(() => act(() => setDesignPreview('lounge'))).not.toThrow();
    expect(result.current).toBe('lounge');
    expect(() => act(() => clearDesignPreview())).not.toThrow();
    expect(result.current).toBeNull();
  });
});
