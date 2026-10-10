import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders, createDmGroup, createDmGroupMember, createFakeElectronAPI } from '../test-utils';
import HomePage from '../../pages/HomePage';
import { INVITE_CARD_DISMISSED_KEY } from '../../components/Home/HomeInviteCard';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import type { HomeSummary } from '../../hooks/useHomeSummary';

const baseSummary = (): HomeSummary => ({
  communities: [{ id: 'c1', name: 'Gaming', description: null, avatar: null, banner: null, createdAt: '' }],
  mentions: [],
  unreadDms: [],
  voice: [],
  isLoading: false,
  isChannelsLoading: false,
  isDmsLoading: false,
  communitiesError: null,
  unreadError: null,
  dmsError: null,
  refetchCommunities: vi.fn(),
  refetchUnread: vi.fn(),
  refetchDms: vi.fn(),
});

let mockSummary: HomeSummary = baseSummary();
vi.mock('../../hooks/useHomeSummary', () => ({ useHomeSummary: () => mockSummary }));
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'me', username: 'me' }, isLoading: false, isError: false }),
}));
vi.mock('../../components/Common/UserAvatar', () => ({
  default: ({ displayName }: { displayName?: string }) => <span>{displayName}</span>,
}));

let mockPerms: Record<string, boolean> = {};
vi.mock('../../features/roles/useUserPermissions', () => ({
  useUserPermissions: ({ actions }: { actions: string[] }) => ({
    hasPermissions: actions.every((a) => mockPerms[a]),
    isLoading: false,
  }),
  useCanPerformAction: (_t: string, _id: string | undefined, action: string) => !!mockPerms[action],
}));

describe('HomePage', () => {
  beforeEach(() => {
    mockSummary = baseSummary();
    mockPerms = {};
    localStorage.clear();
  });

  it('shows mentions, unread DMs and voice, each linking to its place', () => {
    mockSummary.mentions = [
      { channelId: 'ch1', channelName: 'general', communityId: 'c1', communityName: 'Gaming', mentionCount: 3 },
    ];
    mockSummary.unreadDms = [
      {
        group: createDmGroup({
          id: 'dm1',
          members: [
            createDmGroupMember({ userId: 'me', user: { id: 'me', username: 'me' } }),
            createDmGroupMember({ userId: 'u2', user: { id: 'u2', username: 'alice', displayName: 'Alice' } }),
          ],
          lastMessage: { id: 'm', authorId: 'u2', sentAt: '2026-01-01T00:00:00Z', spans: [{ type: 'PLAINTEXT', text: 'see you at 8', userId: null, specialKind: null, communityId: null, aliasId: null }] },
        }),
        unreadCount: 4,
        mentionCount: 0,
      },
    ];
    mockSummary.voice = [
      {
        channelId: 'v1',
        channelName: 'Lounge',
        communityId: 'c1',
        communityName: 'Gaming',
        users: [{ id: 'u3', username: 'bob', joinedAt: '', isDeafened: false, isServerMuted: false }],
      },
    ];
    renderWithProviders(<HomePage />);

    const mentions = screen.getByRole('region', { name: 'Mentions' });
    expect(within(mentions).getByRole('link', { name: /# general/ })).toHaveAttribute('href', '/community/c1/channel/ch1');
    expect(within(mentions).getByLabelText('3 unread mentions')).toBeInTheDocument();

    const dms = screen.getByRole('region', { name: 'Unread messages' });
    const dmLink = within(dms).getByRole('link', { name: /Alice.*see you at 8/ });
    expect(dmLink).toHaveAttribute('href', '/direct-messages/dm1');

    const voice = screen.getByRole('region', { name: 'In voice now' });
    expect(within(voice).getByRole('link', { name: /Lounge/ })).toHaveAttribute('href', '/community/c1/channel/v1');
    expect(screen.queryByTestId('home-caught-up')).not.toBeInTheDocument();
  });

  it('says "all caught up" when nothing is new', () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('shows skeletons while loading, not the caught-up card', () => {
    mockSummary.isLoading = true;
    renderWithProviders(<HomePage />);
    expect(screen.getByRole('progressbar', { name: 'Loading mentions' })).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
  });

  it('shows a retryable error when unread counts fail', async () => {
    mockSummary.unreadError = new Error('boom');
    const { user } = renderWithProviders(<HomePage />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockSummary.refetchUnread).toHaveBeenCalled();
  });

  describe('brand-new user (no communities)', () => {
    beforeEach(() => {
      mockSummary.communities = [];
    });

    it('offers "Create a community" with the permission', () => {
      mockPerms = { CREATE_COMMUNITY: true };
      renderWithProviders(<HomePage />);
      expect(screen.getByRole('link', { name: /create a community/i })).toHaveAttribute('href', '/community/create');
      expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    });

    it('says to ask an admin without it', () => {
      renderWithProviders(<HomePage />);
      expect(screen.queryByRole('link', { name: /create a community/i })).not.toBeInTheDocument();
      expect(screen.getByText(/ask an admin/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /message someone/i })).toHaveAttribute('href', '/direct-messages');
    });
  });

  describe('invite card', () => {
    it('is hidden from users who cannot invite', () => {
      renderWithProviders(<HomePage />);
      expect(screen.queryByTestId('home-invite-card')).not.toBeInTheDocument();
    });

    it('can be dismissed, and stays dismissed', async () => {
      mockPerms = { CREATE_INSTANCE_INVITE: true };
      const { user, unmount } = renderWithProviders(<HomePage />);
      await user.click(screen.getByRole('button', { name: 'Dismiss invite card' }));
      expect(screen.queryByTestId('home-invite-card')).not.toBeInTheDocument();
      expect(localStorage.getItem(INVITE_CARD_DISMISSED_KEY)).toBe('1');
      unmount();
      renderWithProviders(<HomePage />);
      expect(screen.queryByTestId('home-invite-card')).not.toBeInTheDocument();
    });

    it('still renders and dismisses when storage throws', async () => {
      mockPerms = { CREATE_INSTANCE_INVITE: true };
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      try {
        const { user } = renderWithProviders(<HomePage />);
        expect(screen.getByTestId('home-invite-card')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Dismiss invite card' }));
        expect(screen.queryByTestId('home-invite-card')).not.toBeInTheDocument();
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
    });
  });

  describe('desktop app card', () => {
    it('shows in a browser', () => {
      renderWithProviders(<HomePage />);
      expect(screen.getByTestId('home-download-card')).toBeInTheDocument();
    });

    it('is hidden inside Electron', () => {
      setElectronAPIOverride(createFakeElectronAPI());
      renderWithProviders(<HomePage />);
      expect(screen.queryByTestId('home-download-card')).not.toBeInTheDocument();
    });
  });
});
