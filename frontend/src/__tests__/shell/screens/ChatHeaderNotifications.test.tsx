/** The chat header's Notifications (PR 10e): the channel's level in the More menu, and a menu of the levels. */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { KitProvider } from '../../../kit';
import { ChatHeader } from '../../../shell/lounge/screens/chat/ChatHeader';
import type { ChannelNotifications } from '../../../data/channelNotifications';
import { renderWithProviders } from '../../test-utils';

function setup(overrides: Partial<ChannelNotifications> = {}) {
  const notifications: ChannelNotifications = {
    choice: 'default',
    defaultLevel: 'mentions',
    effective: 'mentions',
    loading: false,
    busy: false,
    setChoice: vi.fn(async () => undefined),
    ...overrides,
  };
  const view = renderWithProviders(
    <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
      <ChatHeader title="# lobby" isPrivate={false} onSearch={() => undefined} notifications={notifications} />
    </KitProvider>,
  );
  return { ...view, notifications };
}

describe('ChatHeader notifications', () => {
  it('More says the level; choosing it opens the levels with the current one checked; a pick sets it; focus back on More', async () => {
    const { user, notifications } = setup();
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Notifications: Only @mentions (default)' }));
    const levels = await screen.findByRole('menu', { name: 'Notifications for # lobby' });
    expect(levels).toBeInTheDocument();
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((r) => r.textContent)).toEqual(['All messages', 'Only @mentions', 'Nothing', 'Default (Only @mentions)']);
    expect(screen.getByRole('menuitemradio', { name: 'Default (Only @mentions)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Nothing' })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('menuitemradio', { name: 'Nothing' }));
    expect(notifications.setChoice).toHaveBeenCalledWith('none');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
  });

  it('a channel with its own level says so without "(default)"', async () => {
    const { user } = setup({ choice: 'all', effective: 'all' });
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Notifications: All messages' })).toBeInTheDocument();
  });

  it('a refused change says so', async () => {
    const { user } = setup({ setChoice: vi.fn(async () => Promise.reject(new Error('no'))) });
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: /Notifications:/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'All messages' }));
    expect(await screen.findByText("Couldn't change the notification level")).toBeInTheDocument();
  });
});
