import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';
import { setElectronAPIOverride } from '../../utils/electronBridge';

const responsive = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('../../hooks/useResponsive', () => ({ useResponsive: () => responsive }));

// The sections' own behaviour is tested elsewhere.
vi.mock('../../components/Settings/NotificationSettings', () => ({ default: () => <div>notification settings</div> }));
vi.mock('../../components/Settings/InstallAppSettings', () => ({ default: () => null }));
vi.mock('../../components/Settings/VoiceSettings', () => ({ default: () => <div>voice settings</div> }));
vi.mock('../../components/Settings/SessionsSettings', () => ({ default: () => <div>sessions settings</div> }));
vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    settings: { mode: 'dark', accentColor: 'teal', intensity: 'minimal' },
    setAccentColor: vi.fn(),
    setIntensity: vi.fn(),
    toggleMode: vi.fn(),
  }),
}));

import SettingsPage from '../../pages/SettingsPage';

const navItems = () =>
  within(screen.getByRole('navigation', { name: 'Settings sections' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('SettingsPage layout', () => {
  beforeEach(() => {
    responsive.isDesktop = true;
  });

  it('desktop (web): the form shell with a section nav, Notifications first and active', () => {
    renderWithProviders(<SettingsPage />);
    expect(navItems()).toEqual(['Notifications', 'Voice & video', 'Appearance', 'Sessions']);
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-current', 'true');
    for (const id of ['settings-notifications', 'settings-voice', 'settings-appearance', 'settings-sessions']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('clicking a section scrolls to it and marks it active', async () => {
    const { user } = renderWithProviders(<SettingsPage />);
    const target = document.getElementById('settings-sessions')!;
    target.scrollIntoView = vi.fn();
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'true');
  });

  it('Electron: adds the Desktop app section', async () => {
    setElectronAPIOverride(createFakeElectronAPI());
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByRole('button', { name: 'Desktop app' })).toBeInTheDocument();
    expect(document.getElementById('settings-desktop-app')).not.toBeNull();
  });

  it('phone/tablet: no section nav, the page as before', () => {
    responsive.isDesktop = false;
    renderWithProviders(<SettingsPage />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /settings/i })).toBeInTheDocument();
  });
});
