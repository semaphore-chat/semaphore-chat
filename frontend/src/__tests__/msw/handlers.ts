import { http, HttpResponse } from 'msw';
import type { PaginatedMessagesResponseDto, ThreadRepliesResponseDto } from '../../api-client/types.gen';

const BASE_URL = 'http://localhost:3000';

/** Default channel messages response */
const channelMessagesResponse: PaginatedMessagesResponseDto = {
  messages: [
    {
      id: 'msw-msg-1',
      channelId: 'ch-msw',
      directMessageGroupId: null,
      authorId: 'user-1',
      spans: [],
      attachments: [],
      pendingAttachments: 0,
      reactions: [],
      replyCount: 0,
      lastReplyAt: null,
      pinned: false,
      pinnedAt: null,
      pinnedBy: null,
      sentAt: '2025-01-01T00:00:00Z',
      editedAt: null,
      deletedAt: null,
    },
  ],
  continuationToken: undefined,
};

/** Default DM messages response */
const dmMessagesResponse: PaginatedMessagesResponseDto = {
  messages: [
    {
      id: 'msw-dm-1',
      channelId: null,
      directMessageGroupId: 'dm-msw',
      authorId: 'user-2',
      spans: [],
      attachments: [],
      pendingAttachments: 0,
      reactions: [],
      replyCount: 0,
      lastReplyAt: null,
      pinned: false,
      pinnedAt: null,
      pinnedBy: null,
      sentAt: '2025-01-01T00:00:00Z',
      editedAt: null,
      deletedAt: null,
    },
  ],
  continuationToken: undefined,
};

/** Default thread replies response */
const threadRepliesResponse: ThreadRepliesResponseDto = {
  replies: [
    {
      id: 'msw-reply-1',
      channelId: 'ch-msw',
      directMessageGroupId: null,
      authorId: 'user-1',
      spans: [],
      attachments: [],
      pendingAttachments: 0,
      reactions: [],
      replyCount: 0,
      lastReplyAt: null,
      pinned: false,
      pinnedAt: null,
      pinnedBy: null,
      sentAt: '2025-01-01T00:00:00Z',
      editedAt: null,
      deletedAt: null,
      parentMessageId: 'parent-msw',
    } as never,
  ],
  continuationToken: undefined,
};

/** Auth handlers */
const authHandlers = [
  http.post(`${BASE_URL}/api/auth/login`, async ({ request }) => {
    const body = await request.json() as { username: string; password: string };
    if (body.username === 'invalid') {
      return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }
    return HttpResponse.json({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    });
  }),
];

/** User handlers */
const userHandlers = [
  http.post(`${BASE_URL}/api/users`, () => {
    return HttpResponse.json({
      id: 'new-user-1',
      username: 'newuser',
      email: 'newuser@test.com',
    });
  }),

  http.get(`${BASE_URL}/api/users/profile`, () => {
    return HttpResponse.json({
      id: 'current-user-1',
      username: 'testuser',
      displayName: 'Test User',
      email: 'test@test.com',
      avatarUrl: null,
    });
  }),
];

/** Membership handlers */
const membershipHandlers = [
  // Paginated envelope: { members, continuationToken? } — mirrors the
  // messages continuationToken pattern.
  http.get(`${BASE_URL}/api/membership/community/:communityId`, () => {
    return HttpResponse.json({
      members: [
        {
          id: 'membership-1',
          userId: 'current-user-1',
          communityId: 'community-1',
          joinedAt: '2025-01-01T00:00:00Z',
          roles: [],
          user: {
            id: 'current-user-1',
            username: 'testuser',
            displayName: 'Test User',
            avatarUrl: null,
            status: null,
          },
        },
      ],
      continuationToken: undefined,
    });
  }),
];

/**
 * Effective channel permissions (useChannelPermissions). The default answers
 * 503 so the hook fails open (every capability allowed) whatever channel ids
 * a test uses; tests about permissions install their own handler with
 * `server.use(...)` returning the channels' capabilities.
 */
export const channelPermissionsUnavailableHandler = http.get(
  `${BASE_URL}/api/channels/community/:communityId/permissions/me`,
  () => new HttpResponse(null, { status: 503 }),
);

/** Channel handlers */
const channelHandlers = [
  channelPermissionsUnavailableHandler,
  http.get(`${BASE_URL}/api/channels/community/:communityId`, () => {
    return HttpResponse.json([
      {
        id: 'ch-1',
        name: 'general',
        communityId: 'community-1',
        type: 'TEXT',
        isPrivate: false,
        createdAt: '2025-01-01T00:00:00Z',
        position: 0,
      },
      {
        id: 'ch-2',
        name: 'voice-chat',
        communityId: 'community-1',
        type: 'VOICE',
        isPrivate: false,
        createdAt: '2025-01-01T00:00:00Z',
        position: 1,
      },
    ]);
  }),
];

/** DM handlers */
const dmHandlers = [
  http.get(`${BASE_URL}/api/direct-messages`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/api/direct-messages`, () => {
    return HttpResponse.json({
      id: 'new-dm-1',
      name: null,
      isGroup: false,
      createdAt: new Date().toISOString(),
      members: [],
    });
  }),

  http.get(`${BASE_URL}/api/direct-messages/:id`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      name: null,
      isGroup: false,
      createdAt: '2025-01-01T00:00:00Z',
      members: [
        {
          id: 'member-1',
          userId: 'current-user-1',
          joinedAt: '2025-01-01T00:00:00Z',
          user: { id: 'current-user-1', username: 'testuser', displayName: 'Test User', avatarUrl: null },
        },
        {
          id: 'member-2',
          userId: 'other-user-1',
          joinedAt: '2025-01-01T00:00:00Z',
          user: { id: 'other-user-1', username: 'otheruser', displayName: 'Other User', avatarUrl: null },
        },
      ],
    });
  }),

  http.get(`${BASE_URL}/api/livekit/connection-info`, () => {
    return HttpResponse.json({ url: 'ws://localhost:7880' });
  }),
];

/** Instance handlers */
const instanceHandlers = [
  http.get(`${BASE_URL}/api/instance/settings/public`, () => {
    return HttpResponse.json({
      name: 'Semaphore Chat',
      registrationMode: 'OPEN',
      maxFileSizeBytes: 524288000,
      passwordResetEnabled: false,
    });
  }),
];

/** Moderation handlers */
const moderationHandlers = [
  http.post(`${BASE_URL}/api/moderation/ban/:communityId/:userId`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${BASE_URL}/api/moderation/timeout/:communityId/:userId`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${BASE_URL}/api/moderation/kick/:communityId/:userId`, () => {
    return HttpResponse.json({ success: true });
  }),
];

/**
 * Background queries most screens fire (unread badges, presence dots). Without
 * handlers they fell through to the real network, which fails in CI; under
 * msw 3 those failed passthrough requests broke unrelated queries in the same
 * test (DirectMessageList). Empty results: no unread counts, nobody online.
 */
const backgroundHandlers = [
  http.get(`${BASE_URL}/api/read-receipts/unread-counts`, () => {
    return HttpResponse.json([]);
  }),

  http.get(`${BASE_URL}/api/presence/users/:userIds`, () => {
    return HttpResponse.json({ presence: {} });
  }),
];

export const handlers = [
  http.get(`${BASE_URL}/api/messages/channel/:channelId`, () => {
    return HttpResponse.json(channelMessagesResponse);
  }),

  http.get(`${BASE_URL}/api/direct-messages/:id/messages`, () => {
    return HttpResponse.json(dmMessagesResponse);
  }),

  http.get(`${BASE_URL}/api/messages/group/:groupId`, () => {
    return HttpResponse.json(dmMessagesResponse);
  }),

  http.get(`${BASE_URL}/api/threads/:parentMessageId/replies`, () => {
    return HttpResponse.json(threadRepliesResponse);
  }),

  ...authHandlers,
  ...userHandlers,
  ...membershipHandlers,
  ...channelHandlers,
  ...dmHandlers,
  ...instanceHandlers,
  ...moderationHandlers,
  ...backgroundHandlers,
];
