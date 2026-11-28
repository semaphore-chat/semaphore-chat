import { describe, it, expect, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

describe('SettingsPage — /settings/:section', () => {
  const renderAt = (path: string) =>
    renderWithProviders(
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>,
      { routerProps: { initialEntries: [path] } },
    );

  it('opens on the named section (the new shell links to /settings/voice until it has its own)', async () => {
    server.use(http.get(URL, () => HttpResponse.json(createAppearanceSettings({ loadRemoteContent: true }))));
    const scrolled: string[] = [];
    const scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolled.push(this.id);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    renderAt('/settings/voice');
    await waitFor(() => expect(scrolled).toContain('settings-voice'));
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Voice & video' })).toHaveAttribute('aria-current', 'true');
  });

  it('ignores an unknown section and stays on the first', async () => {
    server.use(http.get(URL, () => HttpResponse.json(createAppearanceSettings({ loadRemoteContent: true }))));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderAt('/settings/nope');
    await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls to the section again once the cards above have loaded', async () => {
    let releasePrivacy!: () => void;
    const privacyLoad = new Promise<void>((resolve) => (releasePrivacy = resolve));
    server.use(
      http.get(URL, async () => {
        await privacyLoad;
        return HttpResponse.json(createAppearanceSettings({ loadRemoteContent: true }));
      }),
    );
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolled.push(this.id);
    });
    renderAt('/settings/sessions');
    // The privacy card is still a skeleton: the session section sits higher than it will once it loads.
    expect(screen.getByLabelText('Loading privacy settings')).toBeInTheDocument();
    expect(scrolled).toEqual(['settings-sessions']);
    act(() => releasePrivacy());
    await waitFor(() => expect(scrolled).toEqual(['settings-sessions', 'settings-sessions']));
  });

  it('does not scroll back once the reader has scrolled', async () => {
    let releasePrivacy!: () => void;
    const privacyLoad = new Promise<void>((resolve) => (releasePrivacy = resolve));
    server.use(
      http.get(URL, async () => {
        await privacyLoad;
        return HttpResponse.json(createAppearanceSettings({ loadRemoteContent: true }));
      }),
    );
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderAt('/settings/sessions');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    fireEvent.wheel(window);
    act(() => releasePrivacy());
    await screen.findByRole('switch', { name: PRIVACY_CARD });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
