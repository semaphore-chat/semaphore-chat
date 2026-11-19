import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { createAppearanceSettings, renderWithProviders } from '../test-utils';

vi.mock('../../hooks/useResponsive', () => ({ useResponsive: () => ({ isDesktop: true }) }));
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
vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

import SettingsPage from '../../pages/SettingsPage';

const URL = 'http://localhost:3000/api/appearance-settings';
const PRIVACY_CARD = 'Load pictures and previews from other sites';

describe('SettingsPage — Privacy section follows the server', () => {
  it('has no Privacy nav item and no Privacy card on a server without the setting', async () => {
    server.use(
      http.get(URL, () => {
        const { loadRemoteContent: _omit, ...old } = createAppearanceSettings();
        return HttpResponse.json(old);
      }),
    );
    renderWithProviders(<SettingsPage />);
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    await within(nav).findByText('Sessions');
    await waitFor(() => expect(screen.queryByLabelText('Loading privacy settings')).not.toBeInTheDocument());
    expect(within(nav).queryByText('Privacy')).not.toBeInTheDocument();
    expect(screen.queryByText(PRIVACY_CARD)).not.toBeInTheDocument();
  });

  it('has both on a server that has it', async () => {
    server.use(http.get(URL, () => HttpResponse.json(createAppearanceSettings({ loadRemoteContent: true }))));
    renderWithProviders(<SettingsPage />);
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(await within(nav).findByText('Privacy')).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: PRIVACY_CARD })).toBeInTheDocument();
  });
});
