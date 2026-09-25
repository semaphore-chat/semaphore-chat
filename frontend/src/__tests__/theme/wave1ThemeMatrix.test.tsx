/**
 * Review Focus #2: every component changed in Wave 1 of the mobile UX
 * overhaul must render under all 3 intensities x 2 modes.
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders, createUser } from '../test-utils';
import { THEME_MATRIX, themeLabel, withMatrixTheme } from '../test-utils/themeMatrix';
import type { Notification } from '../../types/notification.type';
import { NotificationType } from '../../types/notification.type';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

const AVATAR_FILE_ID = 'file-avatar-123';
vi.mock('../../hooks/useAuthenticatedImage', () => ({
  useAuthenticatedImage: (fileId: string | null | undefined) => ({
    blobUrl: fileId === 'file-avatar-123' ? 'blob:http://localhost/file-avatar-123' : null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../components/Profile/ClipLibrary', () => ({
  ClipLibrary: () => <div data-testid="clip-library" />,
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

vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [notification],
    unreadCount: 1,
    hasUnread: true,
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
      callerAvatar: 'file-avatar-123',
      startedAt: Date.now(),
    },
    showIncomingCall: vi.fn(),
    dismissCall: vi.fn(),
  }),
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: {}, actions: { joinDmVoice: vi.fn() } }),
}));

import { NotificationList } from '../../components/Notifications/NotificationList';
import { NotificationCenter } from '../../components/Notifications/NotificationCenter';
import { IncomingCallBanner } from '../../components/DirectMessage/IncomingCallBanner';
import { MobileProfilePanel } from '../../components/Mobile/Panels/MobileProfilePanel';
import { MobileNavigationProvider } from '../../components/Mobile/Navigation/MobileNavigationContext';

const otherUser = createUser({
  id: 'other-user-1',
  username: 'other_person',
  displayName: 'Other Person',
  bio: 'I am somebody else',
});

function usersByIdHandler() {
  return http.get('http://localhost:3000/api/users/:id', ({ params }) => {
    if (params.id === 'profile') return undefined;
    if (params.id === otherUser.id) return HttpResponse.json(otherUser);
    return HttpResponse.json({ statusCode: 404, message: 'User not found' }, { status: 404 });
  });
}

function inShell(ui: React.ReactElement) {
  return (
    <Routes>
      <Route path="*" element={<MobileNavigationProvider>{ui}</MobileNavigationProvider>} />
    </Routes>
  );
}

/** Renders with the full provider stack, overriding the theme per matrix entry. */
async function eachTheme(
  ui: () => React.ReactElement,
  assert: () => Promise<void> | void,
): Promise<void> {
  for (const entry of THEME_MATRIX) {
    try {
      renderWithProviders(withMatrixTheme(ui(), entry));
      await assert();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[${themeLabel(entry)}] ${message}`, { cause: error });
    } finally {
      cleanup();
    }
  }
}

describe('Wave 1 components render in every theme', () => {
  it('NotificationList', async () => {
    await eachTheme(
      () => <NotificationList />,
      () => {
        expect(document.querySelector('img')).not.toBeNull();
        expect(screen.getAllByTestId('AlternateEmailIcon').length).toBeGreaterThan(0);
      },
    );
  });

  it('NotificationCenter', async () => {
    await eachTheme(
      () => <NotificationCenter open onClose={vi.fn()} />,
      () => {
        expect(document.querySelector('img')).not.toBeNull();
      },
    );
  });

  it('IncomingCallBanner', async () => {
    await eachTheme(
      () => <IncomingCallBanner />,
      () => {
        expect(screen.getAllByText('Priya Diallo', { exact: false }).length).toBeGreaterThan(0);
      },
    );
  });

  it("MobileProfilePanel: another user's profile", async () => {
    server.use(usersByIdHandler());
    await eachTheme(
      () => inShell(<MobileProfilePanel userId={otherUser.id} />),
      async () => {
        expect(await screen.findByRole('heading', { name: 'Other Person' })).toBeInTheDocument();
      },
    );
  });

  it('MobileProfilePanel: not-found state', async () => {
    server.use(usersByIdHandler());
    await eachTheme(
      () => inShell(<MobileProfilePanel userId="user-deleted-0000" />),
      async () => {
        expect(await screen.findByText('User not found')).toBeInTheDocument();
      },
    );
  });
});
