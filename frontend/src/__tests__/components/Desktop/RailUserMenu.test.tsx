import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils';
import { RailUserMenu } from '../../../components/Desktop/RailUserMenu';
import type { User } from '../../../types/auth.type';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockHandleLogout = vi.fn();
vi.mock('../../../hooks/useLogout', () => ({
  useLogout: () => ({ handleLogout: mockHandleLogout, logoutLoading: false }),
}));

let mockCanViewInvites = false;
vi.mock('../../../features/roles/useUserPermissions', () => ({
  useUserPermissions: () => ({ hasPermissions: mockCanViewInvites }),
}));

const mockToggleMode = vi.fn();
let mockMode: 'dark' | 'light' = 'dark';
vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ settings: { mode: mockMode }, toggleMode: mockToggleMode }),
}));

vi.mock('../../../components/Common/UserAvatar', () => ({
  default: ({ isOnline }: { isOnline?: boolean }) => <div data-testid="user-avatar" data-online={String(isOnline)} />,
}));

const alice = { id: 'user-1', username: 'alice', displayName: 'Alice Liddell', role: 'USER', status: 'Reviewing UX' } as User;

async function openMenu(user: User = alice, expanded = false) {
  const utils = renderWithProviders(<RailUserMenu user={user} isExpanded={expanded} />);
  await utils.user.click(screen.getByRole('button', { name: 'Account menu' }));
  return utils;
}

describe('RailUserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanViewInvites = false;
    mockMode = 'dark';
  });

  it('shows your avatar with a presence dot', () => {
    renderWithProviders(<RailUserMenu user={alice} isExpanded={false} />);
    // No socket in the test wrapper: offline.
    expect(screen.getByTestId('user-avatar')).toHaveAttribute('data-online', 'false');
  });

  it('labels the expanded rail row with your name and status', () => {
    renderWithProviders(<RailUserMenu user={alice} isExpanded />);
    const button = screen.getByRole('button', { name: 'Account menu' });
    expect(button).toHaveTextContent('Alice Liddell');
    expect(button).toHaveTextContent('Reviewing UX');
  });

  it('opens a menu headed by your name and status, with Profile, Settings, theme and log out', async () => {
    await openMenu();
    const header = screen.getByTestId('rail-user-menu-header');
    expect(header).toHaveTextContent('Alice Liddell');
    expect(header).toHaveTextContent('Reviewing UX');
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['Profile', 'Settings', 'Light theme', 'Log out…']);
  });

  it('falls back to the username and online state when there is no display name or status', async () => {
    await openMenu({ ...alice, displayName: null, status: null });
    const header = screen.getByTestId('rail-user-menu-header');
    expect(header).toHaveTextContent('alice');
    expect(header).toHaveTextContent('Offline');
  });

  it.each([
    ['the owner', { role: 'OWNER' }, false],
    ['someone who can read instance invites', {}, true],
  ])('shows Admin to %s', async (_label, overrides, canViewInvites) => {
    mockCanViewInvites = canViewInvites;
    const { user } = await openMenu({ ...alice, ...overrides } as User);
    await user.click(screen.getByRole('menuitem', { name: 'Admin' }));
    expect(mockNavigate).toHaveBeenCalledWith('/admin');
  });

  it('navigates to your profile and to settings', async () => {
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(mockNavigate).toHaveBeenCalledWith('/profile/user-1');
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('switches the theme', async () => {
    mockMode = 'light';
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Dark theme' }));
    expect(mockToggleMode).toHaveBeenCalledTimes(1);
  });

  it('asks before logging out', async () => {
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: /log out/i }));
    expect(mockHandleLogout).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Log out?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockHandleLogout).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: /log out/i }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Log out' }));
    expect(mockHandleLogout).toHaveBeenCalledTimes(1);
  });
});
