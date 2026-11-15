import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { ACCENT_PRIMARY } from '@semaphore-chat/shared';
import { server } from '../msw/server';
import { createTestQueryClient } from '../test-utils';
import { ThemeProvider, useTheme, type ThemeContextValue } from '../../contexts/ThemeContext';
import { useThemeSync } from '../../hooks/useThemeSync';
import { STORAGE_KEY } from '../../theme/constants';
import type {
  AppearanceSettingsResponseDto,
  UpdateAppearanceSettingsDto,
} from '../../api-client/types.gen';

const BASE_URL = 'http://localhost:3000';

// The generated client talks to a relative URL; point it at the MSW origin.
vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

let latest: ThemeContextValue;
let patches: UpdateAppearanceSettingsDto[];

function Probe() {
  useThemeSync();
  latest = useTheme();
  return null;
}

/** Serve `GET /api/appearance-settings` and record every PATCH body. */
function serverAppearance(overrides: Partial<AppearanceSettingsResponseDto> = {}) {
  const appearance: AppearanceSettingsResponseDto = {
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
    ...overrides,
  };
  server.use(
    http.get(`${BASE_URL}/api/appearance-settings`, () => HttpResponse.json(appearance)),
    http.patch(`${BASE_URL}/api/appearance-settings`, async ({ request }) => {
      patches.push((await request.json()) as UpdateAppearanceSettingsDto);
      return HttpResponse.json(appearance);
    }),
  );
  return appearance;
}

function renderSync() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The server wins on load: make the local settings differ so application is observable. */
async function renderWithServer() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ mode: 'light', accentColor: 'rose', intensity: 'vibrant', baseColor: ACCENT_PRIMARY.rose }),
  );
  serverAppearance();
  const view = renderSync();
  await waitFor(() => expect(latest.settings.mode).toBe('dark'));
  return view;
}

describe('useThemeSync with the appearance fields', () => {
  beforeEach(() => {
    localStorage.clear();
    patches = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies baseColor, matchSystem and newDesign from the server on load', async () => {
    const matchMedia = vi.fn(() => ({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);

    serverAppearance({
      themeMode: 'light',
      accentColor: 'purple',
      intensity: 'balanced',
      baseColor: ACCENT_PRIMARY.purple,
      matchSystem: true,
      newDesign: true,
    });
    renderSync();

    await waitFor(() => expect(latest.baseColor).toBe(ACCENT_PRIMARY.purple));
    expect(latest.settings.accentColor).toBe('purple');
    expect(latest.settings.intensity).toBe('balanced');
    expect(latest.matchSystem).toBe(true);
    expect(latest.newDesign).toBe(true);
    // match-system is on, so the OS preference (dark) beats the server's own mode.
    expect(latest.effectiveMode).toBe('dark');
  });

  it('leaves the local value for every field the server sends malformed', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mode: 'light', accentColor: 'rose', intensity: 'vibrant', baseColor: ACCENT_PRIMARY.rose }),
    );
    serverAppearance({
      // Valid, so the application is observable...
      themeMode: 'dark',
      // ...and malformed, so each must keep the local value.
      accentColor: 'chartreuse',
      intensity: 'bold',
      baseColor: 'pink',
      matchSystem: 'yes' as unknown as boolean,
      newDesign: 1 as unknown as boolean,
    });
    renderSync();

    await waitFor(() => expect(latest.settings.mode).toBe('dark'));
    expect(latest.settings.accentColor).toBe('rose');
    expect(latest.settings.intensity).toBe('vibrant');
    expect(latest.baseColor).toBe(ACCENT_PRIMARY.rose);
    expect(latest.matchSystem).toBe(false);
    expect(latest.newDesign).toBe(false);
  });

  it('PATCHes only the fields that changed', async () => {
    await renderWithServer();

    act(() => latest.setMode('light'));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ themeMode: 'light' });

    act(() => latest.setIntensity('vibrant'));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ intensity: 'vibrant' });

    act(() => latest.setMatchSystem(true));
    await waitFor(() => expect(patches).toHaveLength(3));
    expect(patches[2]).toEqual({ matchSystem: true });

    act(() => latest.setNewDesign(true));
    await waitFor(() => expect(patches).toHaveLength(4));
    expect(patches[3]).toEqual({ newDesign: true });

    // A named accent sends its primary as `baseColor` only; the server derives the accent.
    act(() => latest.setAccentColor('purple'));
    await waitFor(() => expect(patches).toHaveLength(5));
    expect(patches[4]).toEqual({ baseColor: ACCENT_PRIMARY.purple });

    act(() => latest.setBaseColor('#FF9A6B'));
    await waitFor(() => expect(patches).toHaveLength(6));
    expect(patches[5]).toEqual({ baseColor: '#ff9a6b' });

    act(() => latest.toggleMode());
    await waitFor(() => expect(patches).toHaveLength(7));
    expect(patches[6]).toEqual({ themeMode: 'dark' });
  });
});
