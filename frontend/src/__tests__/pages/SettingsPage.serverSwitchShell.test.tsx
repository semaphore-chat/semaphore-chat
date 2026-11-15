import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { addServer, clearAllServers } from '../../utils/serverStorage';

vi.mock('../../hooks/useResponsive', () => ({ useResponsive: () => ({ isDesktop: false }) }));
vi.mock('../../components/Settings/NotificationSettings', () => ({ default: () => null }));
vi.mock('../../components/Settings/InstallAppSettings', () => ({ default: () => null }));
vi.mock('../../components/Settings/VoiceSettings', () => ({ default: () => null }));
vi.mock('../../components/Settings/SessionsSettings', () => ({ default: () => null }));
const teardown = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock('../../shell/sessionState', () => ({ clearShellSessionState: teardown.clear }));
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
 * Review I5: switching to another server ends the session, so the new design's session state goes too
 * (clearShellSessionState); saving the same server keeps it.
 */
describe('SettingsPage — Change Backend URL ends the new design session state', () => {
  const originalLocation = window.location;
  let deleteRefreshToken: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    localStorage.clear();
    clearAllServers();
    addServer('A', 'https://a.example');
    localStorage.setItem('refreshToken', 'token-from-a');
    deleteRefreshToken = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    setElectronAPIOverride(createFakeElectronAPI({ deleteRefreshToken }));
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        reload: vi.fn(),
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

  it('a different server: clearShellSessionState runs before the reload', async () => {
    teardown.clear.mockClear();
    await saveBackendUrl('https://b.example');
    expect(teardown.clear).toHaveBeenCalledTimes(1);
  });

  it('the same server: it does not', async () => {
    teardown.clear.mockClear();
    await saveBackendUrl('https://A.Example/');
    expect(teardown.clear).not.toHaveBeenCalled();
  });
});
