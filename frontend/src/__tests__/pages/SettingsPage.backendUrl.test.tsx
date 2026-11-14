import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { addServer, clearAllServers, getActiveServer } from '../../utils/serverStorage';

vi.mock('../../hooks/useResponsive', () => ({ useResponsive: () => ({ isDesktop: false }) }));
vi.mock('../../components/Settings/NotificationSettings', () => ({ default: () => null }));
vi.mock('../../components/Settings/InstallAppSettings', () => ({ default: () => null }));
vi.mock('../../components/Settings/VoiceSettings', () => ({ default: () => null }));
vi.mock('../../components/Settings/SessionsSettings', () => ({ default: () => null }));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    settings: { mode: 'dark', accentColor: 'teal', intensity: 'minimal' },
    setAccentColor: vi.fn(),
    setIntensity: vi.fn(),
    toggleMode: vi.fn(),
  }),
}));

import SettingsPage from '../../pages/SettingsPage';

// jsdom applies CORS to the cross-origin health check
const healthOk = () =>
  HttpResponse.json(
    { status: 'ok', instanceName: 'Instance' },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );

/**
 * WEB-1: the refresh token belongs to the server that issued it, so changing
 * the backend URL must sign out before the reload (or the reloaded app sends
 * the old server's token to the new one).
 */
describe('SettingsPage — Change Backend URL', () => {
  const originalLocation = window.location;
  let tokensAtReload: { local: string | null; deleted: boolean } | null;
  let deleteRefreshToken: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    localStorage.clear();
    clearAllServers();
    addServer('A', 'https://a.example');
    localStorage.setItem('refreshToken', 'token-from-a');
    tokensAtReload = null;
    deleteRefreshToken = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    setElectronAPIOverride(createFakeElectronAPI({ deleteRefreshToken }));
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        reload: vi.fn(() => {
          tokensAtReload = {
            local: localStorage.getItem('refreshToken'),
            deleted: deleteRefreshToken.mock.calls.length > 0,
          };
        }),
      },
    });
    server.use(
      http.get('https://a.example/api/health', healthOk),
      http.get('https://b.example/api/health', healthOk),
    );
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  async function saveBackendUrl(url: string) {
    const { user } = renderWithProviders(<SettingsPage />);
    await user.click(await screen.findByRole('button', { name: 'Change Backend URL' }));
    const input = screen.getByLabelText('Backend URL');
    await user.clear(input);
    await user.type(input, url);
    await user.click(screen.getByRole('button', { name: 'Save & Reload' }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled(), { timeout: 4000 });
  }

  it('clears the stored refresh token before reloading onto a different server', async () => {
    await saveBackendUrl('https://b.example');

    expect(getActiveServer()?.url).toBe('https://b.example');
    expect(tokensAtReload).toEqual({ local: null, deleted: true });
  });

  it('keeps the session when the same server is saved again (trailing slash, host case)', async () => {
    await saveBackendUrl('https://A.Example/');

    expect(tokensAtReload).toEqual({ local: 'token-from-a', deleted: false });
  });
});
