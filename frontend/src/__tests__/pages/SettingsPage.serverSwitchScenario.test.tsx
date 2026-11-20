/**
 * The server switch in Settings ends the session without the shared teardown (it clears the tokens
 * and reloads), so it calls clearShellSessionState itself. User A had the new design on and banner
 * state; after the switch, user B signing in on the reloaded tab gets the classic shell and none of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { addServer, clearAllServers } from '../../utils/serverStorage';
import { STORAGE_KEY } from '../../theme/constants';
import { takeFirstAnnouncement } from '../../shell/bannerMemory';
import { readDesktopSignInNotice, showDesktopSignInNotice } from '../../data/signInNotice';
import { useConnectionState, useRecordConnectionHistory } from '../../data/connection';
import { SocketContext } from '../../utils/SocketContext';

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

const healthOk = () =>
  HttpResponse.json(
    { status: 'ok', instanceName: 'Instance' },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );

function RecordConnected() {
  useRecordConnectionHistory();
  return null;
}

function ConnectionProbe() {
  return <span data-testid="connection">{useConnectionState()}</span>;
}

describe('user A had the new design on; a switch to another server; user B signs in', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    clearAllServers();
    addServer('A', 'https://a.example');
    setElectronAPIOverride(createFakeElectronAPI({ deleteRefreshToken: vi.fn().mockResolvedValue(undefined) }));
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });
    server.use(
      http.get('https://a.example/api/health', healthOk),
      http.get('https://b.example/api/health', healthOk),
    );
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('B gets the classic shell and none of A\'s banner state', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'dark', newDesign: true }));
    act(() => showDesktopSignInNotice());
    expect(takeFirstAnnouncement('banner:a-heard')).toBe(true);
    render(
      <SocketContext.Provider value={{ socket: null, isConnected: true }}>
        <RecordConnected />
      </SocketContext.Provider>,
    ).unmount();

    const { user, unmount } = renderWithProviders(<SettingsPage />);
    await user.click(await screen.findByRole('button', { name: 'Change Backend URL' }));
    const input = screen.getByLabelText('Backend URL');
    await user.clear(input);
    await user.type(input, 'https://b.example');
    await user.click(screen.getByRole('button', { name: 'Save & Reload' }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled(), { timeout: 4000 });
    unmount();

    // The reloaded tab reads this browser's copy of the setting: off for B
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ newDesign: false });
    expect(readDesktopSignInNotice()).toBe(false);
    expect(takeFirstAnnouncement('banner:a-heard')).toBe(true);
    render(<ConnectionProbe />);
    expect(screen.getByTestId('connection')).toHaveTextContent('connecting');
  });
});
