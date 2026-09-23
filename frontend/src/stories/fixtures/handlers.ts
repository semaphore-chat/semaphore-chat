/**
 * `makeHandlers(scenario)` — turns a `Scenario` into the full set of MSW
 * request handlers the real app needs to render every screen/component
 * story without touching a real backend. Ladle starts these automatically
 * per-story (see `screenStory.tsx` / `.ladle/components.tsx`) via its
 * built-in `msw` addon — nothing here calls `setupWorker()` directly.
 *
 * Endpoints not covered here fall through to Ladle's MSW `onUnhandledRequest:
 * 'warn'` setting (see `.ladle/config.mjs`) and show up as console warnings —
 * that's intentional, it's how gaps get noticed (see design doc).
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  FriendListItemDto,
  PendingRequestsDto,
  EnrichedThreadReplyDto,
  ThreadMetadataDto,
  PublicSettingsResponseDto,
  InstanceSettingsResponseDto,
  InstanceStatsResponseDto,
  OnboardingStatusDto,
  AppearanceSettingsResponseDto,
  ChannelVoicePresenceResponseDto,
  DmVoicePresenceResponseDto,
  UnreadCountDto,
  UserPresenceResponseDto,
  BulkPresenceResponseDto,
  NotificationListResponseDto,
  UserNotificationSettingsDto,
} from '../../api-client/types.gen';
import type { Message } from '../../types/message.type';
import { allScenarioUsers, findChannel, findScenarioUser, type Scenario } from './types';
import { resolveFileSvg } from './avatars';

/**
 * Deterministic "is this user online" for the sandbox — `me` is always
 * online, everyone else is online iff they have a status message set
 * (`buildScenario`'s `STATUSES` pool), giving a realistic-looking mix
 * instead of everyone online or everyone offline.
 */
function isFixtureUserOnline(scenario: Scenario, userId: string): boolean {
  if (userId === scenario.me.id) return true;
  return !!findScenarioUser(scenario, userId)?.status;
}

/** Plain-text match against a message's spans — good enough to exercise the search UI. */
function messageMatches(message: Message, query: string): boolean {
  const text = (message.spans ?? [])
    .map((s) => (s as { text?: string }).text ?? '')
    .join(' ')
    .toLowerCase();
  return text.includes(query);
}

function toThreadReply(message: Message): EnrichedThreadReplyDto {
  return {
    id: message.id,
    channelId: message.channelId ?? null,
    directMessageGroupId: message.directMessageGroupId ?? null,
    authorId: message.authorId,
    spans: message.spans as never,
    attachments: (message.attachments ?? []) as never,
    pendingAttachments: 0,
    reactions: (message.reactions ?? []) as never,
    sentAt: message.sentAt,
    editedAt: message.editedAt ?? null,
    deletedAt: message.deletedAt ?? null,
    pinned: !!message.pinned,
    pinnedAt: message.pinnedAt ?? null,
    pinnedBy: message.pinnedBy ?? null,
    replyCount: 0,
    lastReplyAt: null,
    searchText: null,
    deletedBy: null,
    deletedByReason: null,
    parentMessageId: message.parentMessageId ?? '',
  } as unknown as EnrichedThreadReplyDto;
}

export interface MakeHandlersOptions {
  /** Extra handlers to try first — see `handlerHelpers.ts` (`withErrors`, `withSlowEndpoint`). */
  extraHandlers?: HttpHandler[];
}

export function makeHandlers(scenario: Scenario, options: MakeHandlersOptions = {}): HttpHandler[] {
  const base: HttpHandler[] = [
    // ── Onboarding / instance ─────────────────────────────────────────
    http.get('/api/onboarding/status', () =>
      HttpResponse.json({ needsSetup: false, hasUsers: true } satisfies OnboardingStatusDto)),

    http.get('/api/instance/settings/public', () =>
      HttpResponse.json({
        name: scenario.instanceName,
        registrationMode: 'INVITE_ONLY',
        maxFileSizeBytes: 25 * 1024 * 1024,
        gifSearchEnabled: false,
        passwordResetEnabled: true,
      } satisfies PublicSettingsResponseDto)),

    http.get('/api/instance/settings', () =>
      HttpResponse.json({
        id: 'instance-1',
        registrationMode: 'INVITE_ONLY',
        name: scenario.instanceName,
        description: 'A self-hosted Semaphore Chat instance (Ladle sandbox).',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        defaultStorageQuotaBytes: 5 * 1024 * 1024 * 1024,
        maxFileSizeBytes: 25 * 1024 * 1024,
        vapidPublicKey: null,
        vapidPrivateKey: null,
        vapidSubject: null,
      } satisfies InstanceSettingsResponseDto)),

    http.get('/api/instance/stats', () =>
      HttpResponse.json({
        totalUsers: allScenarioUsers(scenario).length,
        totalCommunities: scenario.communities.length,
        totalChannels: scenario.communities.reduce((n, c) => n + c.channels.length, 0),
        totalMessages: Object.values(scenario.messagesByChannel).reduce((n, m) => n + m.length, 0),
        activeInvites: 1,
        bannedUsers: 0,
      } satisfies InstanceStatsResponseDto)),

    // ── Users ────────────────────────────────────────────────────────
    http.get('/api/users/profile', () => HttpResponse.json(scenario.me)),

    http.patch('/api/users/profile', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...scenario.me, ...body });
    }),

    http.get('/api/users/search', ({ request }) => {
      const q = new URL(request.url).searchParams.get('query')?.toLowerCase() ?? '';
      const results = allScenarioUsers(scenario).filter(
        (u) => u.username.toLowerCase().includes(q) || (u.displayName ?? '').toLowerCase().includes(q),
      );
      return HttpResponse.json(results.slice(0, 10));
    }),

    http.get('/api/users/admin/list', () => HttpResponse.json(allScenarioUsers(scenario))),
    http.get('/api/users', () => HttpResponse.json(allScenarioUsers(scenario))),

    http.get('/api/users/username/:name', ({ params }) => {
      const user = allScenarioUsers(scenario).find((u) => u.username === params.name);
      return user ? HttpResponse.json(user) : HttpResponse.json({ message: 'Not found' }, { status: 404 });
    }),

    http.get('/api/users/:id', ({ params }) => {
      const user = findScenarioUser(scenario, String(params.id));
      return user ? HttpResponse.json(user) : HttpResponse.json({ message: 'Not found' }, { status: 404 });
    }),

    // ── Communities ──────────────────────────────────────────────────
    http.get('/api/community/mine', () =>
      HttpResponse.json(scenario.communities.map(({ channels: _channels, memberIds: _memberIds, ownerId: _ownerId, ...c }) => c))),

    http.get('/api/community/admin/list', () =>
      HttpResponse.json({
        communities: scenario.communities.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          avatar: c.avatar,
          banner: c.banner,
          createdAt: c.createdAt,
          memberCount: c.memberIds.length,
          channelCount: c.channels.length,
        })),
      })),

    http.get('/api/community/:id', ({ params }) => {
      const community = scenario.communities.find((c) => c.id === params.id);
      if (!community) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
      const { channels: _channels, memberIds: _memberIds, ownerId: _ownerId, ...rest } = community;
      return HttpResponse.json(rest);
    }),

    http.patch('/api/community/:id', async ({ params, request }) => {
      const community = scenario.communities.find((c) => c.id === params.id);
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...community, ...body });
    }),

    // ── Channels ─────────────────────────────────────────────────────
    http.get('/api/channels/community/:communityId', ({ params }) => {
      const community = scenario.communities.find((c) => c.id === params.communityId);
      return HttpResponse.json(community?.channels ?? []);
    }),

    http.get('/api/channels/community/:communityId/mentionable', ({ params }) => {
      const community = scenario.communities.find((c) => c.id === params.communityId);
      return HttpResponse.json(
        (community?.channels ?? []).filter((c) => c.type === 'TEXT').map((c) => ({ id: c.id, name: c.name })),
      );
    }),

    http.get('/api/channels/:id', ({ params }) => {
      const found = findChannel(scenario, String(params.id));
      return found ? HttpResponse.json(found.channel) : HttpResponse.json({ message: 'Not found' }, { status: 404 });
    }),

    // ── Messages ─────────────────────────────────────────────────────
    // Scenario arrays are built oldest→newest (ascending, see builder.ts).
    // The real backend's list/around/search endpoints all return
    // newest-first (`orderBy sentAt desc` — messages.service.ts ~527, 610,
    // 634/679/745) and `MessageContainer.tsx:102` reverses that back to
    // ascending for rendering. Serving ascending here double-reverses and
    // puts the newest message at the top of the screen, so every one of
    // these must reverse to match.
    http.get('/api/messages/channel/:channelId', ({ params }) => {
      const messages = [...(scenario.messagesByChannel[String(params.channelId)] ?? [])].reverse();
      return HttpResponse.json({ messages, continuationToken: undefined });
    }),

    http.get('/api/messages/channel/:channelId/around/:messageId', ({ params }) => {
      const messages = [...(scenario.messagesByChannel[String(params.channelId)] ?? [])].reverse();
      return HttpResponse.json({ messages, continuationToken: undefined });
    }),

    http.get('/api/messages/group/:groupId', ({ params }) => {
      const messages = [...(scenario.messagesByDmGroup[String(params.groupId)] ?? [])].reverse();
      return HttpResponse.json({ messages, continuationToken: undefined });
    }),

    http.get('/api/messages/group/:groupId/around/:messageId', ({ params }) => {
      const messages = [...(scenario.messagesByDmGroup[String(params.groupId)] ?? [])].reverse();
      return HttpResponse.json({ messages, continuationToken: undefined });
    }),

    // Search endpoints return a bare `EnrichedMessageDto[]` (not the
    // `{messages, continuationToken}` envelope the paginated list endpoints
    // use — see messages.controller.ts `search/*` routes), newest-first.
    // `/api/messages/search/group/:groupId` (DM search) was previously
    // missing entirely — the SDK calls `search/group/{groupId}`, not
    // `search/channel`, for DM message search.
    http.get('/api/messages/search/channel/:channelId', ({ request, params }) => {
      const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
      const messages = [...(scenario.messagesByChannel[String(params.channelId)] ?? [])].reverse();
      return HttpResponse.json(q ? messages.filter((m) => messageMatches(m, q)) : []);
    }),
    http.get('/api/messages/search/group/:groupId', ({ request, params }) => {
      const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
      const messages = [...(scenario.messagesByDmGroup[String(params.groupId)] ?? [])].reverse();
      return HttpResponse.json(q ? messages.filter((m) => messageMatches(m, q)) : []);
    }),
    http.get('/api/messages/search/community/:communityId', ({ request, params }) => {
      const q = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? '';
      if (!q) return HttpResponse.json([]);
      const community = scenario.communities.find((c) => c.id === params.communityId);
      const channelNameById = new Map((community?.channels ?? []).map((c) => [c.id, c.name]));
      const messages = (community?.channels ?? [])
        .flatMap((c) => scenario.messagesByChannel[c.id] ?? [])
        .filter((m) => messageMatches(m, q))
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .map((m) => ({ ...m, channelName: channelNameById.get(m.channelId ?? '') ?? 'Unknown' }));
      return HttpResponse.json(messages);
    }),

    http.post('/api/messages/reactions', () => HttpResponse.json({ success: true })),
    http.delete('/api/messages/reactions', () => HttpResponse.json({ success: true })),
    http.patch('/api/messages/:id', async ({ request }) => HttpResponse.json(await request.json())),
    http.delete('/api/messages/:id', () => HttpResponse.json({ success: true })),

    // ── Threads ──────────────────────────────────────────────────────
    http.get('/api/threads/:parentMessageId/metadata', ({ params }) => {
      const replies = scenario.threadRepliesByParent[String(params.parentMessageId)] ?? [];
      const metadata: ThreadMetadataDto = {
        parentMessageId: String(params.parentMessageId),
        replyCount: replies.length,
        lastReplyAt: replies.length ? replies[replies.length - 1].sentAt : null,
        isSubscribed: replies.length > 0,
      };
      return HttpResponse.json(metadata);
    }),

    http.get('/api/threads/:parentMessageId/replies', ({ params }) => {
      const replies = (scenario.threadRepliesByParent[String(params.parentMessageId)] ?? []).map(toThreadReply);
      return HttpResponse.json({ replies, continuationToken: undefined });
    }),

    http.post('/api/threads/:parentMessageId/subscribe', () => HttpResponse.json({ success: true })),
    http.delete('/api/threads/:parentMessageId/subscribe', () => HttpResponse.json({ success: true })),

    // ── Pinned / moderation ──────────────────────────────────────────
    http.get('/api/moderation/pins/:channelId', ({ params }) =>
      HttpResponse.json(scenario.pinnedByChannel[String(params.channelId)] ?? [])),
    // `bans`/`timeouts` are bare `CommunityBanDto[]`/`CommunityTimeoutDto[]`
    // on the real backend (moderation.controller.ts `bans/:communityId` /
    // `timeouts/:communityId`) — not a `{bans}`/`{timeouts}` envelope.
    http.get('/api/moderation/bans/:communityId', () => HttpResponse.json([])),
    http.get('/api/moderation/timeouts/:communityId', () => HttpResponse.json([])),
    // `TimeoutStatusResponseDto` — read by the composer (useComposerAvailability).
    http.get('/api/moderation/timeout-status/:communityId/:userId', () => HttpResponse.json({ isTimedOut: false })),
    // `ModerationLogsResponseDto` is `{logs, total}` (no continuationToken —
    // it's offset-paginated). `ModerationLogsPanel.tsx` does
    // `Math.ceil(data.total / PAGE_SIZE)`, which was `NaN` against the old
    // shape (missing `total`).
    http.get('/api/moderation/logs/:communityId', () => HttpResponse.json({ logs: [], total: 0 })),

    // ── Membership / roles ───────────────────────────────────────────
    http.get('/api/membership/community/:communityId', ({ params }) =>
      HttpResponse.json({
        members: scenario.membershipsByCommunity[String(params.communityId)] ?? [],
        continuationToken: undefined,
      })),

    http.get('/api/channel-membership/channel/:channelId', () => HttpResponse.json([])),

    // Real shape is `CommunityRolesResponseDto` ({communityId, roles}), not a
    // bare array — `RoleManagement.tsx`/`RoleAssignmentDialog.tsx` both read
    // `communityRoles.roles`, which was `undefined` (silent empty state)
    // against the old bare-array response.
    http.get('/api/roles/community/:communityId', ({ params }) =>
      HttpResponse.json({
        communityId: String(params.communityId),
        roles: scenario.rolesByCommunity[String(params.communityId)] ?? [],
      })),
    http.get('/api/roles/my/community/:communityId', ({ params }) =>
      HttpResponse.json({
        resourceType: 'COMMUNITY',
        userId: scenario.me.id,
        resourceId: String(params.communityId),
        roles: (scenario.rolesByCommunity[String(params.communityId)] ?? []).slice(0, 1),
      })),
    http.get('/api/roles/my/channel/:channelId', () =>
      HttpResponse.json({ resourceType: 'CHANNEL', userId: scenario.me.id, resourceId: null, roles: [] })),
    http.get('/api/roles/my/instance', () =>
      HttpResponse.json({ resourceType: 'INSTANCE', userId: scenario.me.id, resourceId: null, roles: [] })),
    http.get('/api/roles/instance/all', () => HttpResponse.json([])),
    http.get('/api/roles/user/:userId/community/:communityId', () =>
      HttpResponse.json({ resourceType: 'COMMUNITY', userId: '', resourceId: null, roles: [] })),

    // ── Direct messages ──────────────────────────────────────────────
    http.get('/api/direct-messages', () => HttpResponse.json(scenario.dmGroups)),
    http.get('/api/direct-messages/:id', ({ params }) => {
      const group = scenario.dmGroups.find((g) => g.id === params.id);
      return group ? HttpResponse.json(group) : HttpResponse.json({ message: 'Not found' }, { status: 404 });
    }),
    http.post('/api/direct-messages', async ({ request }) => {
      const body = (await request.json()) as { userIds: string[] };
      const existing = scenario.dmGroups.find(
        (g) => g.members.length === body.userIds.length + 1 && body.userIds.every((id) => g.members.some((m) => m.userId === id)),
      );
      return HttpResponse.json(existing ?? scenario.dmGroups[0]);
    }),

    // ── Friends ──────────────────────────────────────────────────────
    http.get('/api/friends', () => {
      const accepted = scenario.friendships.filter((f) => f.status === 'ACCEPTED');
      const list: FriendListItemDto[] = accepted.map((f) => {
        const other = f.userAId === scenario.me.id ? f.userB : f.userA;
        return {
          role: other.role,
          friendshipId: f.id,
          id: other.id,
          username: other.username,
          avatarUrl: other.avatarUrl,
          bannerUrl: other.bannerUrl,
          lastSeen: other.lastSeen,
          displayName: other.displayName,
          bio: other.bio,
          status: other.status,
        };
      });
      return HttpResponse.json(list);
    }),

    http.get('/api/friends/requests', () => {
      const pending = scenario.friendships.filter((f) => f.status === 'PENDING');
      const response: PendingRequestsDto = {
        sent: pending.filter((f) => f.userAId === scenario.me.id),
        received: pending.filter((f) => f.userBId === scenario.me.id),
      };
      return HttpResponse.json(response);
    }),

    http.post('/api/friends/request/:userId', () => HttpResponse.json({ success: true })),
    http.post('/api/friends/accept/:id', () => HttpResponse.json({ success: true })),
    http.delete('/api/friends/decline/:id', () => HttpResponse.json({ success: true })),
    http.delete('/api/friends/cancel/:id', () => HttpResponse.json({ success: true })),
    http.delete('/api/friends/:id', () => HttpResponse.json({ success: true })),

    // ── Notifications ────────────────────────────────────────────────
    http.get('/api/notifications', () => {
      const unreadCount = scenario.notifications.filter((n) => !n.read).length;
      const response: NotificationListResponseDto = {
        notifications: scenario.notifications,
        total: scenario.notifications.length,
        unreadCount,
      };
      return HttpResponse.json(response);
    }),
    http.get('/api/notifications/unread-count', () =>
      HttpResponse.json({ count: scenario.notifications.filter((n) => !n.read).length })),
    http.get('/api/notifications/settings', () =>
      HttpResponse.json({
        id: 'notif-settings-1',
        userId: scenario.me.id,
        desktopEnabled: true,
        playSound: true,
        soundType: 'default',
        doNotDisturb: false,
        dndStartTime: null,
        dndEndTime: null,
        dndTimezone: null,
        defaultChannelLevel: 'ALL',
        dmNotifications: true,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      } satisfies UserNotificationSettingsDto)),
    http.put('/api/notifications/settings', async ({ request }) => HttpResponse.json(await request.json())),
    http.get('/api/notifications/channels/:channelId/override', () => HttpResponse.json(null, { status: 404 })),
    http.put('/api/notifications/channels/:channelId/override', async ({ request }) => HttpResponse.json(await request.json())),
    http.delete('/api/notifications/channels/:channelId/override', () => HttpResponse.json({ success: true })),
    http.post('/api/notifications/read-all', () => HttpResponse.json({ success: true })),
    http.post('/api/notifications/:id/read', () => HttpResponse.json({ success: true })),
    http.post('/api/notifications/:id/dismiss', () => HttpResponse.json({ success: true })),
    http.delete('/api/notifications/:id', () => HttpResponse.json({ success: true })),

    // ── Read receipts / presence ─────────────────────────────────────
    http.get('/api/read-receipts/unread-counts', () => {
      const counts: UnreadCountDto[] = Object.entries(scenario.unreadByContextId).map(([id, v]) => ({
        directMessageGroupId: scenario.dmGroups.some((g) => g.id === id) ? id : undefined,
        channelId: scenario.dmGroups.some((g) => g.id === id) ? undefined : id,
        unreadCount: v.unreadCount,
        mentionCount: v.mentionCount,
      }));
      return HttpResponse.json(counts);
    }),
    http.get('/api/read-receipts/dm-peer-reads/:directMessageGroupId', () => HttpResponse.json([])),
    http.get('/api/read-receipts/unread-count/:contextId', () => HttpResponse.json({ unreadCount: 0, mentionCount: 0 })),
    // Real shape is `BulkPresenceResponseDto` (`{ presence: Record<string,
    // boolean> }`), not an array of `{userId, isOnline, lastSeen}` — every
    // consumer (`MemberListContainer.tsx`, `DirectMessageList.tsx`) reads
    // `presenceData?.presence?.[id]`, which was always `undefined` against
    // the old array response, i.e. everyone rendered "offline" regardless of
    // this handler's data. `/users/bulk` (a static path) must come before
    // `/users/:userIds` below, or the dynamic route swallows it first.
    http.get('/api/presence/user/:userId', ({ params }) =>
      HttpResponse.json({
        userId: String(params.userId),
        isOnline: isFixtureUserOnline(scenario, String(params.userId)),
      } satisfies UserPresenceResponseDto)),
    http.get('/api/presence/users/bulk', () => {
      const presence: Record<string, boolean> = {};
      for (const u of allScenarioUsers(scenario)) presence[u.id] = isFixtureUserOnline(scenario, u.id);
      return HttpResponse.json({ presence } satisfies BulkPresenceResponseDto);
    }),
    http.get('/api/presence/users/:userIds', ({ params }) => {
      const ids = String(params.userIds).split(',').filter(Boolean);
      const presence: Record<string, boolean> = {};
      for (const id of ids) presence[id] = isFixtureUserOnline(scenario, id);
      return HttpResponse.json({ presence } satisfies BulkPresenceResponseDto);
    }),

    // ── Voice ────────────────────────────────────────────────────────
    http.get('/api/livekit/connection-info', () => HttpResponse.json({ url: 'wss://ladle-sandbox.invalid' })),
    http.get('/api/channels/:channelId/voice-presence', ({ params }) => {
      const users = scenario.voicePresenceByChannel[String(params.channelId)] ?? [];
      const response: ChannelVoicePresenceResponseDto = { channelId: String(params.channelId), users, count: users.length };
      return HttpResponse.json(response);
    }),
    http.get('/api/dm-groups/:dmGroupId/voice-presence', ({ params }) => {
      const response: DmVoicePresenceResponseDto = { dmGroupId: String(params.dmGroupId), users: [], count: 0 };
      return HttpResponse.json(response);
    }),
    http.get('/api/livekit/clips', () => HttpResponse.json([])),
    http.get('/api/livekit/clips/user/:userId', () => HttpResponse.json([])),

    // ── Push notifications ───────────────────────────────────────────
    http.get('/api/push/status', () => HttpResponse.json({ subscribed: false })),
    http.get('/api/push/vapid-public-key', () => HttpResponse.json({ publicKey: null })),

    // ── Appearance / storage / misc settings ─────────────────────────
    http.get('/api/appearance-settings', () =>
      HttpResponse.json({
        id: 'appearance-1',
        userId: scenario.me.id,
        themeMode: 'dark',
        accentColor: 'blue',
        intensity: 'balanced',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      } satisfies AppearanceSettingsResponseDto)),
    http.patch('/api/appearance-settings', async ({ request }) => HttpResponse.json(await request.json())),

    http.get('/api/storage/instance', () =>
      HttpResponse.json({
        totalStorageUsedBytes: 4.2 * 1024 * 1024 * 1024,
        totalFileCount: 128,
        totalUserCount: allScenarioUsers(scenario).length,
        averageStoragePerUserBytes: 320 * 1024 * 1024,
        userStorageDistribution: { under25Percent: 10, under50Percent: 2, under75Percent: 1, under90Percent: 0, over90Percent: 0 },
        storageByType: [
          { type: 'IMAGE', bytes: 2.1 * 1024 * 1024 * 1024, count: 80 },
          { type: 'VIDEO', bytes: 1.8 * 1024 * 1024 * 1024, count: 12 },
          { type: 'DOCUMENT', bytes: 0.3 * 1024 * 1024 * 1024, count: 36 },
        ],
        defaultQuotaBytes: 5 * 1024 * 1024 * 1024,
        maxFileSizeBytes: 25 * 1024 * 1024,
        usersApproachingQuota: 0,
        usersOverQuota: 0,
        server: {
          memoryTotalBytes: 16 * 1024 * 1024 * 1024,
          memoryUsedBytes: 6 * 1024 * 1024 * 1024,
          memoryFreeBytes: 10 * 1024 * 1024 * 1024,
          memoryUsedPercent: 37.5,
          cpuCores: 8,
          cpuModel: 'Ladle Sandbox vCPU',
          loadAverage: [0.5, 0.4, 0.3],
          diskTotalBytes: 512 * 1024 * 1024 * 1024,
          diskUsedBytes: 128 * 1024 * 1024 * 1024,
          diskFreeBytes: 384 * 1024 * 1024 * 1024,
          diskUsedPercent: 25,
          platform: 'linux',
          hostname: 'ladle-sandbox',
          uptime: 3600 * 24 * 3,
        },
      })),
    http.get('/api/storage/users', () => HttpResponse.json({ users: [], continuationToken: undefined })),

    http.get('/api/custom-emoji/community/:communityId', () => HttpResponse.json([])),
    http.get('/api/soundboard/community/:communityId', () => HttpResponse.json([])),
    http.get('/api/alias-groups/community/:communityId', () => HttpResponse.json([])),
    http.get('/api/channels/:channelId/webhooks', () => HttpResponse.json([])),
    http.get('/api/invite', () => HttpResponse.json([])),
    http.get('/api/auth/sessions', () => HttpResponse.json([])),

    // ── Files ────────────────────────────────────────────────────────
    // `avatarUrl`/`avatar`/`banner`/`bannerUrl` fields are fake file ids
    // (`avatarFileId`/`bannerFileId` in avatars.ts), not URLs — every real
    // avatar consumer resolves them through an authenticated GET here
    // (see the doc comment in avatars.ts). `resolveFileSvg` decodes those
    // ids back into the matching SVG; anything else (message attachment
    // ids, custom-emoji ids) falls back to a generic placeholder, same as
    // before.
    http.get('/api/file/:id', ({ params }) => {
      const svg = resolveFileSvg(String(params.id), { width: 480, height: 320 });
      const [, encoded] = svg.split(',');
      return new HttpResponse(decodeURIComponent(encoded), { headers: { 'Content-Type': 'image/svg+xml' } });
    }),
    http.get('/api/file/:id/thumbnail', ({ params }) => {
      const svg = resolveFileSvg(String(params.id), { width: 160, height: 120 }, '');
      const [, encoded] = svg.split(',');
      return new HttpResponse(decodeURIComponent(encoded), { headers: { 'Content-Type': 'image/svg+xml' } });
    }),
  ];

  return [...(options.extraHandlers ?? []), ...base];
}
