import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import NotificationSettings from '../../components/Settings/NotificationSettings';
import SettingsCardSkeleton from '../../components/Settings/SettingsCardSkeleton';

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-client/@tanstack/react-query.gen')>()),
  // Never resolves: the card stays in its loading state.
  notificationsControllerGetSettingsOptions: () => ({
    queryKey: ['test-notification-settings-loading'],
    queryFn: () => new Promise(() => {}),
  }),
  notificationsControllerUpdateSettingsMutation: () => ({ mutationFn: vi.fn() }),
  pushNotificationsControllerSendTestPushToSelfMutation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock('../../hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({ isEnabled: true, isDenied: false, isSupported: true, requestPermission: vi.fn(), isRequesting: false }),
}));
vi.mock('../../hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({ isSupported: false, isServerEnabled: false, isSubscribed: false, isLoading: false, error: null, toggle: vi.fn() }),
}));

describe('NotificationSettings loading', () => {
  it('shows the settings-card skeleton instead of a spinner while loading', () => {
    renderWithProviders(<NotificationSettings />);
    const skeleton = screen.getByRole('progressbar', { name: 'Loading notification settings' });
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByTestId('settings-card-skeleton-row').length).toBeGreaterThan(0);
    // The only progressbar is the skeleton: no CircularProgress spinner.
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.queryByText('Notification Sounds')).not.toBeInTheDocument();
  });
});

describe('SettingsCardSkeleton', () => {
  it('renders the requested number of rows', () => {
    renderWithProviders(<SettingsCardSkeleton rows={6} />);
    expect(screen.getAllByTestId('settings-card-skeleton-row')).toHaveLength(6);
  });
});
