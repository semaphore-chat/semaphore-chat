import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { FormPageShell } from '../../components/Common/PageShell';
import NotificationSettings from '../../components/Settings/NotificationSettings';

const SAVED = {
  desktopEnabled: true,
  playSound: true,
  soundType: 'default',
  doNotDisturb: false,
  dndStartTime: '22:00',
  dndEndTime: '08:00',
  defaultChannelLevel: 'mentions',
  dmNotifications: true,
};

const mockUpdate = vi.fn();
vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-client/@tanstack/react-query.gen')>()),
  notificationsControllerGetSettingsOptions: () => ({ queryKey: ['test-notification-settings'], queryFn: async () => SAVED }),
  notificationsControllerUpdateSettingsMutation: () => ({ mutationFn: mockUpdate }),
  pushNotificationsControllerSendTestPushToSelfMutation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock('../../hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({ isEnabled: true, isDenied: false, isSupported: true, requestPermission: vi.fn(), isRequesting: false }),
}));
vi.mock('../../hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({ isSupported: false, isServerEnabled: false, isSubscribed: false, isLoading: false, error: null, toggle: vi.fn() }),
}));

const soundSwitch = () => screen.getByRole('switch', { name: /notification sounds/i });

describe('NotificationSettings save', () => {
  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue({});
  });

  it('in a desktop form shell: no Save button until something changes, then a sticky save bar', async () => {
    const { user } = renderWithProviders(
      <FormPageShell>
        <NotificationSettings />
      </FormPageShell>,
    );
    await screen.findByText('Notification Sounds');
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();

    await user.click(soundSwitch());
    const bar = await screen.findByRole('region', { name: 'Unsaved changes' });
    expect(screen.getByTestId('save-bar-slot')).toContainElement(bar);

    // Reset puts the saved values back and hides the bar.
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(soundSwitch()).toBeChecked();
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument();

    // Save sends the edit (explicit save, never automatic) and hides the bar.
    await user.click(soundSwitch());
    expect(mockUpdate).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0].body).toMatchObject({ playSound: false });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument());
  });

  it('outside a form shell (phone, tablet): the inline Save button, as before', async () => {
    renderWithProviders(<NotificationSettings />);
    await screen.findByText('Notification Sounds');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument();
  });
});
