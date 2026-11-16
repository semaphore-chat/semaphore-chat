/**
 * The user card's account menu: Settings, Your profile and Sign out… (view), and the connected card's
 * sign-out, asked first through the kit's confirm host: confirming signs out once, Cancel does nothing
 * and gives focus back to the menu's button. The sign-out sequence itself is useLogout's (its own tests).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { renderWithKit } from '../../test-utils/renderWithKit';
import { UserCard, UserCardConnected } from '../../../shell/lounge/pieces/community/UserCard';

const signOut = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../data/session', () => ({ useSignOut: () => ({ signOut: signOut.fn, signingOut: false }) }));
vi.mock('../../../data/callBar', () => ({ useCallBarModel: () => null }));
vi.mock('../../../data/connection', () => ({ useConnectionState: () => 'connected' }));
vi.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'alexk', displayName: 'Alex K', status: null, avatarUrl: null } }),
}));
vi.mock('../../../hooks/useAuthenticatedImage', () => ({ useAuthenticatedImage: () => ({ blobUrl: null }) }));

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  signOut.fn.mockClear();
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const path = { current: '' };
function Path() {
  path.current = useLocation().pathname;
  return null;
}

function renderConnected() {
  return renderWithKit(
    <MemoryRouter initialEntries={['/__lounge/community/c-1']}>
      <Path />
      <UserCardConnected />
    </MemoryRouter>,
  );
}

describe('UserCard account menu (view)', () => {
  it('offers Settings, Your profile and Sign out…, each calling its own callback once', async () => {
    const calls = { settings: vi.fn(), profile: vi.fn(), signOut: vi.fn() };
    const { user } = renderWithKit(
      <UserCard name="alexk" online line={null} call={null} onSettings={calls.settings} onProfile={calls.profile} onSignOut={calls.signOut} />,
    );
    const button = screen.getByRole('button', { name: 'Account menu' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(button);
    const menu = await screen.findByRole('menu', { name: 'Account menu' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Settings', 'Your profile', 'Sign out…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out…' }));
    expect(calls.signOut).toHaveBeenCalledTimes(1);
    expect(calls.settings).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await user.click(button);
    await user.click(await screen.findByRole('menuitem', { name: 'Your profile' }));
    expect(calls.profile).toHaveBeenCalledTimes(1);
  });

  it('while the profile loads the menu is there too', async () => {
    const onSignOut = vi.fn();
    const { user } = renderWithKit(
      <UserCard name={null} online={false} line={null} call={null} onSettings={vi.fn()} onProfile={vi.fn()} onSignOut={onSignOut} />,
    );
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out…' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('UserCardConnected sign-out', () => {
  it('asks first; confirming signs out once', async () => {
    const { user } = renderConnected();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out…' }));
    const question = await screen.findByRole('dialog', { name: 'Sign out?' });
    expect(question).toHaveTextContent("You'll leave any call you're in");
    expect(signOut.fn).not.toHaveBeenCalled();
    await user.click(within(question).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut.fn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out?' })).toBeNull());
  });

  it('Cancel does nothing and gives focus back to the account menu button', async () => {
    const { user } = renderConnected();
    const button = screen.getByRole('button', { name: 'Account menu' });
    await user.click(button);
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out…' }));
    const question = await screen.findByRole('dialog', { name: 'Sign out?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign out?' })).toBeNull());
    expect(signOut.fn).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('Settings and Your profile go to the classic screens', async () => {
    const { user } = renderConnected();
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Your profile' }));
    await waitFor(() => expect(path.current).toBe('/profile'));
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await waitFor(() => expect(path.current).toBe('/settings'));
    expect(signOut.fn).not.toHaveBeenCalled();
  });
});
