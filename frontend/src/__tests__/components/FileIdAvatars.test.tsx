/**
 * Avatars stored as file ids (User.avatarUrl, Community.avatar) must be
 * resolved through the authenticated file cache (UserAvatar /
 * AuthenticatedImage -> useAuthenticatedImage), never used as a raw
 * `<img src="<file-id>">`, which is a broken relative URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import type { Notification } from '../../types/notification.type';
import { NotificationType } from '../../types/notification.type';

const AVATAR_FILE_ID = 'file-avatar-123';
const BLOB_URL = `blob:http://localhost/${AVATAR_FILE_ID}`;

const defaultImageImpl = (fileId: string | null | undefined) => ({
  blobUrl: fileId === AVATAR_FILE_ID ? BLOB_URL : null,
  isLoading: false,
  error: null,
});
const mockUseAuthenticatedImage = vi.fn(defaultImageImpl);

vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: (fileId: string | null | undefined) => mockUseAuthenticatedImage(fileId),
}));

const notification: Notification = {
  id: 'notif-1',
  userId: 'me',
  type: NotificationType.USER_MENTION,
  messageId: 'msg-1',
  channelId: 'channel-1',
  directMessageGroupId: null,
  communityId: 'community-1',
  authorId: 'author-1',
  read: false,
  dismissed: false,
  createdAt: new Date().toISOString(),
  author: {
    id: 'author-1',
    username: 'priya',
    displayName: 'Priya Diallo',
    avatarUrl: AVATAR_FILE_ID,
  },
  message: { id: 'msg-1', spans: [{ type: 'PLAINTEXT', text: 'hello' }] },
};

let mockNotifications: Notification[] = [notification];

vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: mockNotifications.filter((n) => !n.read).length,
    hasUnread: mockNotifications.some((n) => !n.read),
    isLoading: false,
    isMarkingAllRead: false,
    error: null,
    refetch: vi.fn(),
    handleMarkAsRead: vi.fn(),
    handleMarkAllAsRead: vi.fn(),
    invalidateNotifications: vi.fn(),
  }),
}));

vi.mock('../../contexts/IncomingCallContext', () => ({
  useIncomingCall: () => ({
    incomingCall: {
      dmGroupId: 'dm-1',
      dmGroupName: 'Priya Diallo',
      callerName: 'Priya Diallo',
      callerAvatar: AVATAR_FILE_ID,
      startedAt: Date.now(),
    },
    showIncomingCall: vi.fn(),
    dismissCall: vi.fn(),
  }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: {}, actions: { joinDmVoice: vi.fn() } }),
}));

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    communityControllerFindAllWithStatsOptions: () => ({
      queryKey: ['admin-communities-test'],
      queryFn: async () => ({
        communities: [
          {
            id: 'community-1',
            name: 'Night Crew',
            description: null,
            avatar: AVATAR_FILE_ID,
            banner: null,
            createdAt: new Date().toISOString(),
            memberCount: 3,
            channelCount: 2,
          },
        ],
      }),
    }),
  };
});

import { NotificationList } from '../../components/Notifications/NotificationList';
import { NotificationCenter } from '../../components/Notifications/NotificationCenter';
import { IncomingCallBanner } from '../../components/DirectMessage/IncomingCallBanner';
import AdminCommunitiesPage from '../../pages/admin/AdminCommunitiesPage';

function expectResolvedAvatar() {
  const imgs = Array.from(document.querySelectorAll('img'));
  // Never a raw file id as src
  expect(imgs.some((img) => img.getAttribute('src') === AVATAR_FILE_ID)).toBe(false);
  // The authenticated blob URL is rendered instead
  expect(imgs.some((img) => img.getAttribute('src') === BLOB_URL)).toBe(true);
  expect(mockUseAuthenticatedImage).toHaveBeenCalledWith(AVATAR_FILE_ID);
}

describe('avatars from file ids', () => {
  beforeEach(() => {
    mockUseAuthenticatedImage.mockReset();
    mockUseAuthenticatedImage.mockImplementation(defaultImageImpl);
    mockNotifications = [notification];
  });

  it('NotificationList resolves the author avatar file id and keeps the type icon', () => {
    renderWithProviders(<NotificationList />);
    expectResolvedAvatar();
    // The notification type is still conveyed alongside the avatar
    expect(screen.getByTestId('AlternateEmailIcon')).toBeInTheDocument();
  });

  it('NotificationList falls back to the type icon when the author has no avatar', () => {
    mockNotifications = [{ ...notification, author: { ...notification.author!, avatarUrl: null } }];
    renderWithProviders(<NotificationList />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByTestId('AlternateEmailIcon')).toBeInTheDocument();
  });

  it('NotificationList hides the type badge when the avatar file fails to resolve', () => {
    mockUseAuthenticatedImage.mockImplementation(() => ({ blobUrl: null, isLoading: false, error: null }));
    renderWithProviders(<NotificationList />);
    expect(document.querySelector('img')).toBeNull();
    // Only the fallback type-icon avatar, no duplicate badge icon
    expect(screen.getAllByTestId('AlternateEmailIcon')).toHaveLength(1);
  });

  it('NotificationCenter resolves the author avatar file id', () => {
    renderWithProviders(<NotificationCenter open onClose={vi.fn()} />);
    expectResolvedAvatar();
  });

  it('IncomingCallBanner resolves the caller avatar file id', () => {
    renderWithProviders(<IncomingCallBanner />);
    expectResolvedAvatar();
  });

  it('IncomingCallBanner shows the caller initial when there is no avatar', () => {
    mockUseAuthenticatedImage.mockImplementation(() => ({ blobUrl: null, isLoading: false, error: null }));
    renderWithProviders(<IncomingCallBanner />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('AdminCommunitiesPage resolves the community avatar file id', async () => {
    renderWithProviders(<AdminCommunitiesPage />);
    await waitFor(() => expect(screen.getByText('Night Crew')).toBeInTheDocument());
    expectResolvedAvatar();
  });
});
