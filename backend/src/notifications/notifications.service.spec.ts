import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';

import { DatabaseService } from '@/database/database.service';
import { PushNotificationsService } from '@/push-notifications/push-notifications.service';
import { PresenceService } from '@/presence/presence.service';
import { NotificationsGateway } from './notifications.gateway';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { NotificationType, SpanType } from '@prisma/client';
import {
  createMockDatabase,
  NotificationFactory,
  UserNotificationSettingsFactory,
  ChannelNotificationOverrideFactory,
  MessageFactory,
} from '@/test-utils';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  let pushNotificationsService: Mocked<PushNotificationsService>;
  let presenceService: Mocked<PresenceService>;
  let configService: Mocked<ConfigService>;
  let notificationsGateway: Mocked<NotificationsGateway>;
  let channelAccessService: Mocked<ChannelAccessService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(NotificationsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;

    pushNotificationsService = unitRef.get(PushNotificationsService);
    presenceService = unitRef.get(PresenceService);
    configService = unitRef.get(ConfigService);
    notificationsGateway = unitRef.get(NotificationsGateway);
    channelAccessService = unitRef.get(ChannelAccessService);

    // Default mock behaviors
    pushNotificationsService.isEnabled.mockReturnValue(false);
    presenceService.isActive.mockResolvedValue(false);
    pushNotificationsService.sendToUser.mockResolvedValue({
      sent: 0,
      failed: 0,
    });
    // Default: no CHANNEL_MESSAGE_MEMBER_THRESHOLD override configured —
    // individual tests override this via configService.get.mockImplementation.
    (configService.get as jest.Mock).mockReturnValue(undefined);
    // Default: everyone these tests mention can see the channel; tests about
    // visibility override it. Channels are public by default (cheap path).
    channelAccessService.viewerUserIds.mockResolvedValue([
      'author-1',
      'user-1',
      'user-2',
      'user-3',
      'target-user',
      'user-mention',
      'recipient-1',
      'subscriber-1',
      'subscriber-2',
    ]);
    channelAccessService.isVisibleToWholeCommunity.mockResolvedValue(false);
    mockDatabase.notification.findMany.mockResolvedValue([]);
    // No one opted into "all": the CHANNEL_MESSAGE pass creates nothing
    mockDatabase.userNotificationSettings.findMany.mockResolvedValue([]);
    mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processMessageForNotifications', () => {
    it('should create notifications for mentioned users', async () => {
      const userId1 = 'user-1';
      const userId2 = 'user-2';
      const authorId = 'author-1';
      const channelId = 'channel-1';

      const message = MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: userId1,
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
          {
            type: SpanType.USER_MENTION,
            userId: userId2,
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );
      mockDatabase.notification.create.mockImplementation((args) =>
        Promise.resolve({
          ...NotificationFactory.build(args.data),
          author: {
            id: authorId,
            username: 'test',
            displayName: null,
            avatarUrl: null,
          },
          message: {
            id: 'msg-1',
            spans: [],
            channelId,
            directMessageGroupId: null,
          },
        }),
      );

      await service.processMessageForNotifications(message as any);

      // Should create 2 notifications (one for each mentioned user)
      expect(mockDatabase.notification.create).toHaveBeenCalledTimes(2);
      expect(mockDatabase.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: userId1,
            type: NotificationType.USER_MENTION,
            messageId: message.id,
            channelId,
            authorId,
          }),
          include: expect.any(Object),
        }),
      );
      expect(mockDatabase.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: userId2,
          }),
          include: expect.any(Object),
        }),
      );
    });

    it('should not create notification for message author', async () => {
      const authorId = 'author-1';
      const message = MessageFactory.build({
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: authorId, // Author mentioning themselves
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processMessageForNotifications(message as any);

      expect(mockDatabase.notification.create).not.toHaveBeenCalled();
    });

    it('notifies every viewer of the channel for @channel (ChannelAccessService)', async () => {
      const channelId = 'channel-1';
      const message = MessageFactory.build({
        channelId,
        authorId: 'author-1',
        spans: [
          {
            type: SpanType.SPECIAL_MENTION,
            specialKind: 'channel',
            userId: null,
            text: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      channelAccessService.viewerUserIds.mockResolvedValue([
        'user-1',
        'user-2',
        'user-3',
      ]);
      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );
      mockDatabase.notification.create.mockImplementation((args) =>
        Promise.resolve(NotificationFactory.build(args.data)),
      );

      await service.processMessageForNotifications(message as any);

      expect(channelAccessService.viewerUserIds).toHaveBeenCalledWith(
        channelId,
      );
      expect(mockDatabase.notification.create).toHaveBeenCalledTimes(3);
      // No hand-rolled visibility queries
      expect(mockDatabase.channelMembership.findMany).not.toHaveBeenCalled();
    });

    it('excludes the author from @channel', async () => {
      const channelId = 'channel-1';
      const message = MessageFactory.build({
        channelId,
        authorId: 'author-1',
        spans: [
          {
            type: SpanType.SPECIAL_MENTION,
            specialKind: 'channel',
            userId: null,
            text: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      channelAccessService.viewerUserIds.mockResolvedValue([
        'author-1',
        'user-1',
        'user-2',
        'user-3',
      ]);
      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );
      mockDatabase.notification.create.mockImplementation((args) =>
        Promise.resolve(NotificationFactory.build(args.data)),
      );

      await service.processMessageForNotifications(message as any);

      expect(mockDatabase.notification.create).toHaveBeenCalledTimes(3);
    });

    it('notifies only recently seen viewers for @here', async () => {
      const channelId = 'channel-1';
      const message = MessageFactory.build({
        channelId,
        authorId: 'author-1',
        spans: [
          {
            type: SpanType.SPECIAL_MENTION,
            specialKind: 'here',
            userId: null,
            text: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      channelAccessService.viewerUserIds.mockResolvedValue([
        'user-1',
        'user-2',
      ]);
      // DB-level lastSeen filter returns only the online viewer
      mockDatabase.user.findMany.mockResolvedValue([{ id: 'user-1' }]);
      // CHANNEL_MESSAGE fan-out for the other viewer: nobody opted in
      mockDatabase.notification.findMany.mockResolvedValue([]);
      mockDatabase.userNotificationSettings.findMany.mockResolvedValue([]);
      mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);
      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );
      mockDatabase.notification.create.mockImplementation((args) =>
        Promise.resolve(NotificationFactory.build(args.data)),
      );

      await service.processMessageForNotifications(message as any);

      expect(mockDatabase.notification.create).toHaveBeenCalledTimes(1);
      expect(mockDatabase.user.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['user-1', 'user-2'] },
          lastSeen: { gt: expect.any(Date) },
        },
        select: { id: true },
      });
    });

    it('does not notify a mentioned user who cannot see the channel', async () => {
      const channelId = 'channel-1';
      const message = MessageFactory.build({
        channelId,
        authorId: 'author-1',
        spans: [
          {
            type: SpanType.USER_MENTION,
            specialKind: null,
            userId: 'outsider',
            text: null,
            communityId: null,
            aliasId: null,
          },
          {
            type: SpanType.USER_MENTION,
            specialKind: null,
            userId: 'viewer',
            text: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      channelAccessService.viewerUserIds.mockResolvedValue(['viewer']);
      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );
      mockDatabase.notification.create.mockImplementation((args) =>
        Promise.resolve(NotificationFactory.build(args.data)),
      );

      await service.processMessageForNotifications(message as any);

      expect(mockDatabase.notification.create).toHaveBeenCalledTimes(1);
      expect(mockDatabase.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'viewer' }),
        }),
      );
    });

    it('should notify all DM members when message has @mention (mention + regular DM)', async () => {
      const dmGroupId = 'dm-group-1';
      const authorId = 'author-1';
      const mentionedUserId = 'user-1';
      const message = MessageFactory.buildDirectMessage({
        directMessageGroupId: dmGroupId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: mentionedUserId,
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      // 4-person DM group
      const members = [
        { userId: authorId },
        { userId: mentionedUserId },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ];

      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue(members);
      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.notification.create.mockImplementation((args) =>
        Promise.resolve(NotificationFactory.build(args.data)),
      );

      await service.processMessageForNotifications(message as any);

      // Should create 3 notifications total:
      // 1 DIRECT_MESSAGE (mention) for user-1, 2 DIRECT_MESSAGE for user-2 and user-3
      expect(mockDatabase.notification.create).toHaveBeenCalledTimes(3);
      // user-1 gets a DIRECT_MESSAGE via mention path
      expect(mockDatabase.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: mentionedUserId,
            type: NotificationType.DIRECT_MESSAGE,
          }),
          include: expect.any(Object),
        }),
      );
      // user-2 and user-3 get DIRECT_MESSAGE via DM path
      expect(mockDatabase.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-2',
            type: NotificationType.DIRECT_MESSAGE,
          }),
          include: expect.any(Object),
        }),
      );
      expect(mockDatabase.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-3',
            type: NotificationType.DIRECT_MESSAGE,
          }),
          include: expect.any(Object),
        }),
      );
    });

    it('should handle DM notifications', async () => {
      const dmGroupId = 'dm-group-1';
      const message = MessageFactory.buildDirectMessage({
        directMessageGroupId: dmGroupId,
        authorId: 'author-1',
        spans: [],
      } as any);

      const members = [{ userId: 'user-1' }, { userId: 'user-2' }];

      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue(members);
      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.notification.create.mockImplementation((args) =>
        Promise.resolve(NotificationFactory.build(args.data)),
      );

      await service.processMessageForNotifications(message as any);

      expect(mockDatabase.notification.create).toHaveBeenCalledTimes(2);
    });

    // ==========================================================================
    // Batched CHANNEL_MESSAGE fan-out (issue B1 N+1 fix).
    //
    // createChannelMessageNotifications() replaced the per-recipient
    // shouldNotify()/createNotification() loop with:
    //   1 settings findMany + 1 override findMany + 1 createMany + 1
    //   follow-up findMany, regardless of recipient count. Each shouldNotify
    //   rule that's reachable from this call site (channelId set,
    //   directMessageGroupId null, type always CHANNEL_MESSAGE) gets its own
    //   test below, mirroring the rules exercised via shouldNotify() in the
    //   describe('shouldNotify') block for the mention/DM/thread call sites.
    // ==========================================================================
    describe('createChannelMessageNotifications (batched)', () => {
      const channelId = 'channel-1';
      const communityId = 'community-1';
      const authorId = 'author-1';

      function buildMessage() {
        return MessageFactory.build({
          id: 'msg-1',
          channelId,
          authorId,
          spans: [],
        } as any);
      }

      /** A channel with `viewerCount` viewers (for the threshold guard). */
      function mockPublicChannel(viewerCount?: number) {
        if (viewerCount !== undefined) {
          channelAccessService.viewerUserIds.mockResolvedValue(
            Array.from({ length: viewerCount }, (_, i) => `viewer-${i}`),
          );
        }
      }

      beforeEach(() => {
        mockDatabase.notification.createMany.mockResolvedValue({ count: 0 });
        mockDatabase.notification.findMany.mockResolvedValue([]);
        // The channel's viewers (ChannelAccessService) are the members each
        // test lists via membership.findMany.
        channelAccessService.viewerUserIds.mockImplementation(async () => {
          const members = (await mockDatabase.membership.findMany()) as
            { userId: string }[] | undefined;
          return (members ?? []).map((m) => m.userId);
        });
      });

      it('creates CHANNEL_MESSAGE notifications for members whose resolved level is "all" (rule: all-level pass)', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
          { userId: 'user-2' },
        ]);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([
          { userId: 'user-1', defaultChannelLevel: 'all' },
          { userId: 'user-2', defaultChannelLevel: 'all' },
        ]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);
        mockDatabase.notification.createMany.mockResolvedValue({ count: 2 });
        mockDatabase.notification.findMany
          // 1st call: retry-idempotency existing-check — nobody created yet.
          .mockResolvedValueOnce([])
          // 2nd call: post-create read for WS/push emission.
          .mockResolvedValueOnce(
            NotificationFactory.buildMany(2, {
              type: NotificationType.CHANNEL_MESSAGE,
              channelId,
              authorId,
            }).map((n, i) => ({
              ...n,
              userId: `user-${i + 1}`,
              author: {
                id: authorId,
                username: 'a',
                displayName: null,
                avatarUrl: null,
              },
              message: {
                id: 'msg-1',
                spans: [],
                channelId,
                directMessageGroupId: null,
              },
              channel: { id: channelId, name: 'general', communityId },
            })),
          );

        await service.processMessageForNotifications(buildMessage() as any);

        expect(mockDatabase.notification.createMany).toHaveBeenCalledTimes(1);
        expect(mockDatabase.notification.createMany).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({
              userId: 'user-1',
              type: NotificationType.CHANNEL_MESSAGE,
              messageId: 'msg-1',
              channelId,
              authorId,
            }),
            expect.objectContaining({
              userId: 'user-2',
              type: NotificationType.CHANNEL_MESSAGE,
            }),
          ],
        });
        // notification.findMany is called twice: the retry-idempotency
        // existing-check before createMany, then the post-create read that
        // drives the WS emit + push flow per created recipient.
        expect(mockDatabase.notification.findMany).toHaveBeenCalledTimes(2);
      });

      it('excludes a member whose default level is "mentions" (rule: mentions-only excludes CHANNEL_MESSAGE)', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
        ]);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([
          { userId: 'user-1', defaultChannelLevel: 'mentions' },
        ]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(mockDatabase.notification.createMany).not.toHaveBeenCalled();
      });

      it('excludes a member with no settings row, defaulting to schema default "mentions" (rule: missing-settings default, no create-on-read)', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
        ]);
        // No settings row for user-1 at all.
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(mockDatabase.notification.createMany).not.toHaveBeenCalled();
        // The batch path must never create-on-read a settings row.
        expect(
          mockDatabase.userNotificationSettings.upsert,
        ).not.toHaveBeenCalled();
        expect(
          mockDatabase.userNotificationSettings.create,
        ).not.toHaveBeenCalled();
      });

      it('includes a member via a per-channel "all" override even though their default is "mentions" (rule: override wins over default)', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
        ]);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([
          { userId: 'user-1', defaultChannelLevel: 'mentions' },
        ]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([
          { userId: 'user-1', level: 'all' },
        ]);
        mockDatabase.notification.createMany.mockResolvedValue({ count: 1 });

        await service.processMessageForNotifications(buildMessage() as any);

        expect(mockDatabase.notification.createMany).toHaveBeenCalledWith({
          data: [expect.objectContaining({ userId: 'user-1' })],
        });
      });

      it('excludes a member muted via a per-channel "none" override even though their default is "all" (rule: mute override wins over default)', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
        ]);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([
          { userId: 'user-1', defaultChannelLevel: 'all' },
        ]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([
          { userId: 'user-1', level: 'none' },
        ]);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(mockDatabase.notification.createMany).not.toHaveBeenCalled();
      });

      it('excludes the author and already-mention-notified users before querying settings (rule: self-exclusion / already-notified de-dup)', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: authorId },
          { userId: 'user-1' },
        ]);

        // user-1 was already notified via the mention path.
        const message = MessageFactory.build({
          id: 'msg-1',
          channelId,
          authorId,
          spans: [
            {
              type: SpanType.USER_MENTION,
              userId: 'user-1',
              text: null,
              specialKind: null,
              communityId: null,
              aliasId: null,
            },
          ],
        } as any);
        mockDatabase.userNotificationSettings.upsert.mockResolvedValue(
          UserNotificationSettingsFactory.build(),
        );
        mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
          null,
        );
        mockDatabase.notification.create.mockResolvedValue(
          NotificationFactory.build({ userId: 'user-1' }),
        );

        await service.processMessageForNotifications(message as any);

        // Only the mention-path create fires; the channel-message batch has
        // nobody left to query settings for (author + already-notified are
        // filtered out before the settings/override queries run).
        expect(mockDatabase.notification.create).toHaveBeenCalledTimes(1);
        expect(
          mockDatabase.userNotificationSettings.findMany,
        ).not.toHaveBeenCalled();
        expect(mockDatabase.notification.createMany).not.toHaveBeenCalled();
      });

      it('queries settings and overrides EXACTLY ONCE regardless of recipient count (the N+1 fix)', async () => {
        const N = 200;
        mockPublicChannel();
        const members = Array.from({ length: N }, (_, i) => ({
          userId: `user-${i}`,
        }));
        mockDatabase.membership.findMany.mockResolvedValue(members);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue(
          members.map((m) => ({
            userId: m.userId,
            defaultChannelLevel: 'all',
          })),
        );
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);
        mockDatabase.notification.createMany.mockResolvedValue({ count: N });

        await service.processMessageForNotifications(buildMessage() as any);

        expect(
          mockDatabase.userNotificationSettings.findMany,
        ).toHaveBeenCalledTimes(1);
        expect(
          mockDatabase.channelNotificationOverride.findMany,
        ).toHaveBeenCalledTimes(1);
        expect(mockDatabase.notification.createMany).toHaveBeenCalledTimes(1);
        // No per-recipient settings queries at all — the old N+1 loop.
        expect(
          mockDatabase.userNotificationSettings.upsert,
        ).not.toHaveBeenCalled();
        expect(
          mockDatabase.channelNotificationOverride.findUnique,
        ).not.toHaveBeenCalled();
      });

      it('skips fan-out and logs a WARN for communities over the configured threshold (rule: large-community threshold guard)', async () => {
        configService.get.mockImplementation((key: string) =>
          key === 'CHANNEL_MESSAGE_MEMBER_THRESHOLD' ? '5' : undefined,
        );
        mockPublicChannel(6);
        const warnSpy = jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => undefined);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(
          mockDatabase.userNotificationSettings.findMany,
        ).not.toHaveBeenCalled();
        expect(mockDatabase.notification.createMany).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('6 viewers'),
        );
      });

      it('cheap path: a public channel over the threshold is skipped on the member count, without computing viewers', async () => {
        configService.get.mockImplementation((key: string) =>
          key === 'CHANNEL_MESSAGE_MEMBER_THRESHOLD' ? '5' : undefined,
        );
        channelAccessService.isVisibleToWholeCommunity.mockResolvedValue(true);
        mockDatabase.channel.findUnique.mockResolvedValue({ communityId });
        mockDatabase.membership.count.mockResolvedValue(6);
        jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => undefined);

        // A plain message: no mentions, so nothing else needs viewers either
        await service.processMessageForNotifications(buildMessage() as any);

        expect(mockDatabase.membership.count).toHaveBeenCalledWith({
          where: { communityId },
        });
        expect(channelAccessService.viewerUserIds).not.toHaveBeenCalled();
        expect(mockDatabase.notification.createMany).not.toHaveBeenCalled();
      });

      it('a public channel under the threshold computes viewers once', async () => {
        channelAccessService.isVisibleToWholeCommunity.mockResolvedValue(true);
        mockDatabase.channel.findUnique.mockResolvedValue({ communityId });
        mockDatabase.membership.count.mockResolvedValue(2);
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
        ]);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(channelAccessService.viewerUserIds).toHaveBeenCalledTimes(1);
      });

      it('treats an explicit "0" threshold as invalid, warns, and falls back to the default 5000', async () => {
        configService.get.mockImplementation((key: string) =>
          key === 'CHANNEL_MESSAGE_MEMBER_THRESHOLD' ? '0' : undefined,
        );
        mockPublicChannel(4999);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);
        const warnSpy = jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => undefined);

        await service.processMessageForNotifications(buildMessage() as any);

        // Falls back to 5000, so 4999 viewers is still under threshold.
        expect(
          mockDatabase.userNotificationSettings.findMany,
        ).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid CHANNEL_MESSAGE_MEMBER_THRESHOLD'),
        );
      });

      it('defaults the threshold to 5000 when CHANNEL_MESSAGE_MEMBER_THRESHOLD is unset', async () => {
        configService.get.mockReturnValue(undefined);
        mockPublicChannel(5001);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(
          mockDatabase.userNotificationSettings.findMany,
        ).not.toHaveBeenCalled();
        expect(mockDatabase.notification.createMany).not.toHaveBeenCalled();
      });

      it('proceeds when the viewer count is at/under the default 5000 threshold', async () => {
        configService.get.mockReturnValue(undefined);
        mockPublicChannel(4999);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(
          mockDatabase.userNotificationSettings.findMany,
        ).toHaveBeenCalled();
      });

      it('applies the threshold to the channel viewers, not the community size', async () => {
        configService.get.mockImplementation((key: string) =>
          key === 'CHANNEL_MESSAGE_MEMBER_THRESHOLD' ? '5' : undefined,
        );
        mockPublicChannel(3);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);

        await service.processMessageForNotifications(buildMessage() as any);

        expect(mockDatabase.membership.count).not.toHaveBeenCalled();
        expect(
          mockDatabase.userNotificationSettings.findMany,
        ).toHaveBeenCalled();
      });

      it('propagates a batch-query failure so the caller (BullMQ processor) can retry, instead of swallowing it', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
        ]);
        mockDatabase.userNotificationSettings.findMany.mockRejectedValue(
          new Error('DB error'),
        );

        await expect(
          service.processMessageForNotifications(buildMessage() as any),
        ).rejects.toThrow('DB error');
      });

      it('excludes a recipient who already has a CHANNEL_MESSAGE notification for this message from a prior attempt, and only emits WS/push for newly-created rows (rule: BullMQ retry idempotency)', async () => {
        mockPublicChannel();
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
          { userId: 'user-2' },
        ]);
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([
          { userId: 'user-1', defaultChannelLevel: 'all' },
          { userId: 'user-2', defaultChannelLevel: 'all' },
        ]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);
        // user-1 already has a CHANNEL_MESSAGE notification for this
        // message — simulating a prior (failed) attempt at this job.
        mockDatabase.notification.findMany
          .mockResolvedValueOnce([{ userId: 'user-1' }])
          .mockResolvedValueOnce(
            NotificationFactory.buildMany(1, {
              type: NotificationType.CHANNEL_MESSAGE,
              channelId,
              authorId,
            }).map((n) => ({
              ...n,
              userId: 'user-2',
              author: {
                id: authorId,
                username: 'a',
                displayName: null,
                avatarUrl: null,
              },
              message: {
                id: 'msg-1',
                spans: [],
                channelId,
                directMessageGroupId: null,
              },
              channel: { id: channelId, name: 'general', communityId },
            })),
          );
        mockDatabase.notification.createMany.mockResolvedValue({ count: 1 });

        await service.processMessageForNotifications(buildMessage() as any);

        // Only user-2 (the recipient without a prior notification) is
        // (re-)created — user-1 is excluded from both the write and the
        // settings/override lookups that would otherwise run for them.
        expect(mockDatabase.notification.createMany).toHaveBeenCalledTimes(1);
        expect(mockDatabase.notification.createMany).toHaveBeenCalledWith({
          data: [expect.objectContaining({ userId: 'user-2' })],
        });
        expect(
          notificationsGateway.emitNotificationToUser,
        ).toHaveBeenCalledTimes(1);
        expect(
          notificationsGateway.emitNotificationToUser,
        ).toHaveBeenCalledWith(
          'user-2',
          expect.objectContaining({ userId: 'user-2' }),
        );
      });
    });

    describe('retry idempotency across a partial-failure retry (BullMQ job)', () => {
      it('does not duplicate a notification created before the job failed, and emits WS only for the newly-created recipient on retry', async () => {
        const authorId = 'author-1';
        const channelId = 'channel-1';
        const communityId = 'community-1';
        const message = MessageFactory.build({
          id: 'msg-1',
          channelId,
          authorId,
          spans: [
            {
              type: SpanType.USER_MENTION,
              userId: 'user-mention',
              text: null,
              specialKind: null,
              communityId: null,
              aliasId: null,
            },
          ],
        } as any);

        jest.spyOn(service, 'shouldNotify').mockResolvedValue(true);
        // Both users can see the channel
        channelAccessService.viewerUserIds.mockResolvedValue([
          'user-mention',
          'user-channel',
        ]);
        mockDatabase.notification.create.mockResolvedValue(
          NotificationFactory.build({
            userId: 'user-mention',
            type: NotificationType.USER_MENTION,
          }),
        );

        // --- Run 1: mention notification is created, then the channel
        // batch throws (simulating a failure partway through the job) ---
        mockDatabase.notification.findFirst.mockResolvedValueOnce(null); // no prior mention notification
        // channel-batch existing-check (run 1): nobody created yet.
        mockDatabase.notification.findMany.mockResolvedValueOnce([]);
        mockDatabase.userNotificationSettings.findMany.mockRejectedValueOnce(
          new Error('DB blip'),
        );

        await expect(
          service.processMessageForNotifications(message as any),
        ).rejects.toThrow('DB blip');

        expect(mockDatabase.notification.create).toHaveBeenCalledTimes(1);

        // --- Run 2 (BullMQ retry): same message re-processed ---
        // The mention notification now already exists in the DB.
        mockDatabase.notification.findFirst.mockResolvedValueOnce({
          id: 'existing-mention-notif',
        });
        mockDatabase.userNotificationSettings.findMany.mockResolvedValue([
          { userId: 'user-channel', defaultChannelLevel: 'all' },
        ]);
        mockDatabase.channelNotificationOverride.findMany.mockResolvedValue([]);
        mockDatabase.notification.findMany
          .mockResolvedValueOnce([]) // channel-batch existing-check: nobody yet
          .mockResolvedValueOnce([
            {
              ...NotificationFactory.build({
                userId: 'user-channel',
                type: NotificationType.CHANNEL_MESSAGE,
              }),
              author: {
                id: authorId,
                username: 'a',
                displayName: null,
                avatarUrl: null,
              },
              message: {
                id: 'msg-1',
                spans: [],
                channelId,
                directMessageGroupId: null,
              },
              channel: { id: channelId, name: 'general', communityId },
            },
          ]);
        mockDatabase.notification.createMany.mockResolvedValue({ count: 1 });

        await service.processMessageForNotifications(message as any);

        // The mention notification was NOT re-created on retry.
        expect(mockDatabase.notification.create).toHaveBeenCalledTimes(1);
        // The channel-message notification for the new recipient was created.
        expect(mockDatabase.notification.createMany).toHaveBeenCalledTimes(1);
        expect(mockDatabase.notification.createMany).toHaveBeenCalledWith({
          data: [expect.objectContaining({ userId: 'user-channel' })],
        });
        // WS emit only fired for: user-mention (run 1) + user-channel (run 2).
        // Never a second emit for user-mention on the retry.
        expect(
          notificationsGateway.emitNotificationToUser,
        ).toHaveBeenCalledTimes(2);
        expect(
          notificationsGateway.emitNotificationToUser,
        ).toHaveBeenCalledWith(
          'user-mention',
          expect.objectContaining({ userId: 'user-mention' }),
        );
        expect(
          notificationsGateway.emitNotificationToUser,
        ).toHaveBeenCalledWith(
          'user-channel',
          expect.objectContaining({ userId: 'user-channel' }),
        );
      });
    });
  });

  describe('shouldNotify', () => {
    const userId = 'user-1';
    const channelId = 'channel-1';

    it('should still create notification records when desktop notifications are disabled', async () => {
      const settings = UserNotificationSettingsFactory.buildMutedDesktop();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.shouldNotify(
        userId,
        channelId,
        null,
        NotificationType.USER_MENTION,
      );

      expect(result).toBe(true);
    });

    it('should still create notification records when in DND time window', async () => {
      const settings = UserNotificationSettingsFactory.buildWithDND({
        dndStartTime: '22:00',
        dndEndTime: '08:00',
      });
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.shouldNotify(
        userId,
        channelId,
        null,
        NotificationType.USER_MENTION,
      );

      expect(result).toBe(true);
    });

    it('should return false when DM notifications are disabled for DMs', async () => {
      const settings = UserNotificationSettingsFactory.buildMutedDMs();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);

      const result = await service.shouldNotify(
        userId,
        null,
        'dm-group-1',
        NotificationType.DIRECT_MESSAGE,
      );

      expect(result).toBe(false);
    });

    it('should return false when channel is muted', async () => {
      const settings = UserNotificationSettingsFactory.build();
      const override = ChannelNotificationOverrideFactory.buildMuted({
        userId,
        channelId,
      });

      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        override,
      );

      const result = await service.shouldNotify(
        userId,
        channelId,
        null,
        NotificationType.USER_MENTION,
      );

      expect(result).toBe(false);
    });

    it('should return false for channel messages when set to mentions-only', async () => {
      const settings = UserNotificationSettingsFactory.buildMentionsOnlyMode();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.shouldNotify(
        userId,
        channelId,
        null,
        NotificationType.CHANNEL_MESSAGE,
      );

      expect(result).toBe(false);
    });

    it('should return true for mentions when set to mentions-only', async () => {
      const settings = UserNotificationSettingsFactory.buildMentionsOnlyMode();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.shouldNotify(
        userId,
        channelId,
        null,
        NotificationType.USER_MENTION,
      );

      expect(result).toBe(true);
    });

    it('should return true for thread reply even when channel is muted', async () => {
      const settings = UserNotificationSettingsFactory.build();
      const override = ChannelNotificationOverrideFactory.buildMuted({
        userId,
        channelId,
      });

      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        override,
      );

      const result = await service.shouldNotify(
        userId,
        channelId,
        null,
        NotificationType.THREAD_REPLY,
      );

      expect(result).toBe(true);
    });

    it('should return false for thread reply in DM when DM notifications are disabled', async () => {
      const settings = UserNotificationSettingsFactory.buildMutedDMs();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);

      const result = await service.shouldNotify(
        userId,
        null,
        'dm-group-1',
        NotificationType.THREAD_REPLY,
      );

      expect(result).toBe(false);
    });

    it('should use upsert to get-or-create settings', async () => {
      const newSettings = UserNotificationSettingsFactory.build({ userId });
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(
        newSettings,
      );
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      await service.shouldNotify(
        userId,
        channelId,
        null,
        NotificationType.USER_MENTION,
      );

      expect(mockDatabase.userNotificationSettings.upsert).toHaveBeenCalledWith(
        {
          where: { userId },
          create: { userId },
          update: {},
        },
      );
    });
  });

  describe('getUserNotifications', () => {
    it('should return paginated notifications', async () => {
      const userId = 'user-1';
      const notifications = NotificationFactory.buildMany(3, { userId });

      mockDatabase.notification.findMany.mockResolvedValue(notifications);

      const result = await service.getUserNotifications(userId, {
        limit: 50,
        offset: 0,
      });

      expect(result).toHaveLength(3);
      expect(mockDatabase.notification.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should filter by unread only', async () => {
      const userId = 'user-1';
      mockDatabase.notification.findMany.mockResolvedValue([]);

      await service.getUserNotifications(userId, {
        unreadOnly: true,
        limit: 50,
        offset: 0,
      });

      expect(mockDatabase.notification.findMany).toHaveBeenCalledWith({
        where: { userId, read: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
        include: expect.any(Object),
      });
    });

    it('should cap an oversized limit at 100 even if it bypasses DTO validation', async () => {
      const userId = 'user-1';
      mockDatabase.notification.findMany.mockResolvedValue([]);

      await service.getUserNotifications(userId, {
        limit: 99999,
        offset: 0,
      });

      expect(mockDatabase.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      const userId = 'user-1';
      mockDatabase.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount(userId);

      expect(result).toBe(5);
      expect(mockDatabase.notification.count).toHaveBeenCalledWith({
        where: { userId, read: false },
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const userId = 'user-1';
      const notificationId = 'notif-1';
      const notification = NotificationFactory.build({
        id: notificationId,
        userId,
      });
      const updatedNotification = { ...notification, read: true };

      mockDatabase.notification.findFirst.mockResolvedValue(notification);
      mockDatabase.notification.update.mockResolvedValue(updatedNotification);

      const result = await service.markAsRead(notificationId, userId);

      expect(result.read).toBe(true);
      expect(mockDatabase.notification.update).toHaveBeenCalledWith({
        where: { id: notificationId },
        data: { read: true },
      });
    });

    it('should throw NotFoundException if notification not found', async () => {
      mockDatabase.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead('nonexistent', 'user-1')).rejects.toThrow(
        'Notification not found',
      );
    });
  });

  describe('markContextNotificationsAsRead', () => {
    it('should mark channel mention notifications as read', async () => {
      mockDatabase.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markContextNotificationsAsRead(
        'user-1',
        'channel-1',
        null,
      );

      expect(result).toBe(3);
      expect(mockDatabase.notification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          read: false,
          channelId: 'channel-1',
          type: { in: ['USER_MENTION', 'SPECIAL_MENTION', 'CHANNEL_MESSAGE'] },
        },
        data: { read: true },
      });
    });

    it('should include DIRECT_MESSAGE type for DM groups', async () => {
      mockDatabase.notification.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.markContextNotificationsAsRead(
        'user-1',
        null,
        'dm-group-1',
      );

      expect(result).toBe(2);
      expect(mockDatabase.notification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          read: false,
          directMessageGroupId: 'dm-group-1',
          type: { in: ['USER_MENTION', 'SPECIAL_MENTION', 'DIRECT_MESSAGE'] },
        },
        data: { read: true },
      });
    });

    it('should return 0 when no context provided', async () => {
      const result = await service.markContextNotificationsAsRead(
        'user-1',
        null,
        null,
      );

      expect(result).toBe(0);
      expect(mockDatabase.notification.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications as read', async () => {
      const userId = 'user-1';
      mockDatabase.notification.updateMany.mockResolvedValue({ count: 10 });

      const result = await service.markAllAsRead(userId);

      expect(result.count).toBe(10);
      expect(mockDatabase.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, read: false },
        data: { read: true },
      });
    });
  });

  describe('getUserSettings', () => {
    it('should return existing settings', async () => {
      const userId = 'user-1';
      const settings = UserNotificationSettingsFactory.build({ userId });

      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);

      const result = await service.getUserSettings(userId);

      expect(result).toEqual(settings);
    });

    it('should create default settings if none exist', async () => {
      const userId = 'user-1';
      const newSettings = UserNotificationSettingsFactory.build({ userId });

      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(
        newSettings,
      );

      const result = await service.getUserSettings(userId);

      expect(result).toEqual(newSettings);
    });

    it('should use upsert instead of find-then-create', async () => {
      const userId = 'user-1';
      const settings = UserNotificationSettingsFactory.build({ userId });

      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);

      await service.getUserSettings(userId);

      expect(mockDatabase.userNotificationSettings.upsert).toHaveBeenCalledWith(
        {
          where: { userId },
          create: { userId },
          update: {},
        },
      );
      // Verify the old find-then-create pattern is NOT used
      expect(
        mockDatabase.userNotificationSettings.findUnique,
      ).not.toHaveBeenCalled();
      expect(
        mockDatabase.userNotificationSettings.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe('updateUserSettings', () => {
    it('should update user settings', async () => {
      const userId = 'user-1';
      const existingSettings = UserNotificationSettingsFactory.build({
        userId,
      });
      const updates = {
        doNotDisturb: true,
        dndStartTime: '22:00',
        dndEndTime: '08:00',
      };

      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(
        existingSettings,
      );
      mockDatabase.userNotificationSettings.update.mockResolvedValue({
        ...existingSettings,
        ...updates,
      });

      const result = await service.updateUserSettings(userId, updates);

      expect(result.doNotDisturb).toBe(true);
      expect(mockDatabase.userNotificationSettings.update).toHaveBeenCalledWith(
        {
          where: { userId },
          data: updates,
        },
      );
    });
  });

  describe('getChannelOverride', () => {
    it('should return channel override if exists', async () => {
      const userId = 'user-1';
      const channelId = 'channel-1';
      const override = ChannelNotificationOverrideFactory.build({
        userId,
        channelId,
      });

      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        override,
      );

      const result = await service.getChannelOverride(userId, channelId);

      expect(result).toEqual(override);
    });

    it('should return null if no override exists', async () => {
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.getChannelOverride('user-1', 'channel-1');

      expect(result).toBeNull();
    });
  });

  describe('setChannelOverride', () => {
    it('should create new channel override', async () => {
      const userId = 'user-1';
      const channelId = 'channel-1';
      const override = ChannelNotificationOverrideFactory.buildMuted({
        userId,
        channelId,
      });

      mockDatabase.channelNotificationOverride.upsert.mockResolvedValue(
        override,
      );

      const result = await service.setChannelOverride(userId, channelId, {
        level: 'none',
      });

      expect(result).toEqual(override);
      expect(
        mockDatabase.channelNotificationOverride.upsert,
      ).toHaveBeenCalledWith({
        where: { userId_channelId: { userId, channelId } },
        update: { level: 'none' },
        create: { userId, channelId, level: 'none' },
      });
    });
  });

  describe('deleteChannelOverride', () => {
    it('should delete channel override', async () => {
      const userId = 'user-1';
      const channelId = 'channel-1';

      mockDatabase.channelNotificationOverride.deleteMany.mockResolvedValue({
        count: 1,
      });

      await service.deleteChannelOverride(userId, channelId);

      expect(
        mockDatabase.channelNotificationOverride.deleteMany,
      ).toHaveBeenCalledWith({
        where: { userId, channelId },
      });
    });
  });

  // ============================================================================
  // PUSH NOTIFICATION SUPPRESSION FOR ACTIVE USERS
  // ============================================================================

  describe('push notification suppression for active users', () => {
    const authorId = 'author-1';
    const targetUserId = 'target-user';
    const channelId = 'channel-1';

    beforeEach(() => {
      pushNotificationsService.isEnabled.mockReturnValue(true);
    });

    function setupForPushTest() {
      const notification = NotificationFactory.build({
        type: NotificationType.USER_MENTION,
        authorId,
        channelId,
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: {
          id: authorId,
          username: 'johndoe',
          displayName: 'John Doe',
          avatarUrl: null,
        },
        message: {
          id: 'msg-1',
          spans: [{ text: 'Hello' }],
          channelId,
          directMessageGroupId: null,
        },
        channel: { id: channelId, name: 'general', communityId: 'community-1' },
      });

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      return MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: targetUserId,
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);
    }

    it('should suppress push notification when user is active', async () => {
      presenceService.isActive.mockResolvedValue(true);
      const message = setupForPushTest();

      await service.processMessageForNotifications(message as any);

      expect(presenceService.isActive).toHaveBeenCalledWith(targetUserId);
      expect(pushNotificationsService.sendToUser).not.toHaveBeenCalled();
    });

    it('should send push notification when user is not active', async () => {
      presenceService.isActive.mockResolvedValue(false);
      const message = setupForPushTest();

      await service.processMessageForNotifications(message as any);

      expect(presenceService.isActive).toHaveBeenCalledWith(targetUserId);
      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        targetUserId,
        expect.objectContaining({ title: expect.any(String) }),
      );
    });

    it('should always create notification record and emit WebSocket event regardless of active state', async () => {
      presenceService.isActive.mockResolvedValue(true);
      const message = setupForPushTest();

      await service.processMessageForNotifications(message as any);

      // Notification record should still be created
      expect(mockDatabase.notification.create).toHaveBeenCalled();
      // Push should be suppressed
      expect(pushNotificationsService.sendToUser).not.toHaveBeenCalled();
    });

    it('should suppress push when DND is active (manual toggle)', async () => {
      presenceService.isActive.mockResolvedValue(false);
      const message = setupForPushTest();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(
        UserNotificationSettingsFactory.build({ doNotDisturb: true }),
      );

      await service.processMessageForNotifications(message as any);

      // Record + WS emission still happen; only push is suppressed
      expect(mockDatabase.notification.create).toHaveBeenCalled();
      expect(pushNotificationsService.sendToUser).not.toHaveBeenCalled();
    });

    it('should send push when DND is enabled but outside the scheduled window', async () => {
      presenceService.isActive.mockResolvedValue(false);
      const message = setupForPushTest();
      // Window that can never contain "now": start === end is all-day,
      // so instead compute a 1-minute window guaranteed not to include now (UTC)
      const now = new Date();
      const farHour = (now.getUTCHours() + 12) % 24;
      const pad = (n: number) => String(n).padStart(2, '0');
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(
        UserNotificationSettingsFactory.build({
          doNotDisturb: true,
          dndStartTime: `${pad(farHour)}:00`,
          dndEndTime: `${pad(farHour)}:59`,
          dndTimezone: 'UTC',
        }),
      );

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // PUSH ACTION TOKEN (Mark as read)
  // ============================================================================

  describe('push notification action token', () => {
    const authorId = 'author-1';
    const targetUserId = 'target-user';
    const channelId = 'channel-1';

    beforeEach(() => {
      pushNotificationsService.isEnabled.mockReturnValue(true);
    });

    function setupForPushTest() {
      const notification = NotificationFactory.build({
        type: NotificationType.USER_MENTION,
        authorId,
        channelId,
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: {
          id: authorId,
          username: 'johndoe',
          displayName: 'John Doe',
          avatarUrl: null,
        },
        message: {
          id: 'msg-1',
          spans: [{ text: 'Hello' }],
          channelId,
          directMessageGroupId: null,
        },
        channel: { id: channelId, name: 'general', communityId: 'community-1' },
      });

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      return MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: targetUserId,
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);
    }

    it('should include markReadToken in push payload data when a token is created', async () => {
      pushNotificationsService.createActionToken.mockReturnValue(
        'signed-token-value',
      );
      const message = setupForPushTest();

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.createActionToken).toHaveBeenCalledWith(
        targetUserId,
        expect.any(String),
      );
      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        targetUserId,
        expect.objectContaining({
          data: expect.objectContaining({
            markReadToken: 'signed-token-value',
          }),
        }),
      );
    });

    it('should omit markReadToken from push payload data when token creation returns null', async () => {
      pushNotificationsService.createActionToken.mockReturnValue(null);
      const message = setupForPushTest();

      await service.processMessageForNotifications(message as any);

      const call = pushNotificationsService.sendToUser.mock.calls.find(
        ([uid]) => uid === targetUserId,
      );
      expect(call).toBeDefined();
      const data = call![1].data as Record<string, unknown>;
      expect(data).not.toHaveProperty('markReadToken');
    });
  });

  // ============================================================================
  // PUSH NOTIFICATION BODY
  // ============================================================================

  describe('push notification body formatting', () => {
    const authorId = 'author-1';
    const channelId = 'channel-1';
    const communityId = 'community-1';

    const authorInfo = {
      id: authorId,
      username: 'johndoe',
      displayName: 'John Doe',
      avatarUrl: null,
    };

    const channelInfo = {
      id: channelId,
      name: 'general',
      communityId,
    };

    beforeEach(() => {
      pushNotificationsService.isEnabled.mockReturnValue(true);
    });

    function setupNotificationCreate(
      type: NotificationType,
      spans: any[],
      options: { channel?: boolean } = {},
    ) {
      const notification = NotificationFactory.build({
        type,
        authorId,
        channelId: options.channel !== false ? channelId : null,
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: authorInfo,
        message: { id: 'msg-1', spans, channelId, directMessageGroupId: null },
        channel: options.channel !== false ? channelInfo : null,
      });

      return notification;
    }

    it('should include message text in USER_MENTION push body', async () => {
      const spans = [
        {
          type: SpanType.PLAINTEXT,
          text: 'Hello world',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ];
      setupNotificationCreate(NotificationType.USER_MENTION, spans);

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const message = MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: 'target-user',
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'target-user',
        expect.objectContaining({
          body: 'John Doe: Hello world',
        }),
      );
    });

    it('should fallback to generic text for USER_MENTION when message has no text spans', async () => {
      setupNotificationCreate(NotificationType.USER_MENTION, []);

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const message = MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: 'target-user',
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'target-user',
        expect.objectContaining({
          body: 'John Doe mentioned you',
        }),
      );
    });

    it('should include message text in DIRECT_MESSAGE push body', async () => {
      const spans = [
        {
          type: SpanType.PLAINTEXT,
          text: 'Hey there!',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ];
      const notification = NotificationFactory.build({
        type: NotificationType.DIRECT_MESSAGE,
        authorId,
        channelId: null,
        directMessageGroupId: 'dm-group-1',
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: authorInfo,
        message: {
          id: 'msg-1',
          spans,
          channelId: null,
          directMessageGroupId: 'dm-group-1',
        },
        channel: null,
      });

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);

      const message = MessageFactory.buildDirectMessage({
        id: 'msg-1',
        directMessageGroupId: 'dm-group-1',
        authorId,
        spans: [],
      } as any);

      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId: 'recipient-1' },
      ]);

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'recipient-1',
        expect.objectContaining({
          body: 'Hey there!',
        }),
      );
    });

    it('should fallback to generic text for DIRECT_MESSAGE when message has no text spans', async () => {
      const notification = NotificationFactory.build({
        type: NotificationType.DIRECT_MESSAGE,
        authorId,
        channelId: null,
        directMessageGroupId: 'dm-group-1',
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: authorInfo,
        message: {
          id: 'msg-1',
          spans: [],
          channelId: null,
          directMessageGroupId: 'dm-group-1',
        },
        channel: null,
      });

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);

      const message = MessageFactory.buildDirectMessage({
        id: 'msg-1',
        directMessageGroupId: 'dm-group-1',
        authorId,
        spans: [],
      } as any);

      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId: 'recipient-1' },
      ]);

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'recipient-1',
        expect.objectContaining({
          body: 'New message',
        }),
      );
    });

    it('should include message text in THREAD_REPLY push body', async () => {
      const spans = [
        {
          type: SpanType.PLAINTEXT,
          text: 'I agree!',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ];
      const notification = NotificationFactory.build({
        type: NotificationType.THREAD_REPLY,
        authorId,
        channelId,
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: authorInfo,
        message: {
          id: 'reply-1',
          spans,
          channelId,
          directMessageGroupId: null,
        },
        channel: channelInfo,
      });

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      mockDatabase.threadSubscriber.findMany.mockResolvedValue([
        { userId: 'subscriber-1' },
      ]);

      const reply = MessageFactory.build({
        id: 'reply-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.PLAINTEXT,
            text: 'I agree!',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processThreadReplyNotifications(
        reply,
        'parent-msg-1',
        authorId,
      );

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'subscriber-1',
        expect.objectContaining({
          body: 'John Doe: I agree!',
        }),
      );
    });

    it('thread replies notify only subscribers who can still see the channel', async () => {
      const spans = [
        {
          type: SpanType.PLAINTEXT,
          text: 'I agree!',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ];
      const notification = NotificationFactory.build({
        type: NotificationType.THREAD_REPLY,
        authorId,
        channelId,
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: authorInfo,
        message: {
          id: 'reply-1',
          spans,
          channelId,
          directMessageGroupId: null,
        },
        channel: channelInfo,
      });

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      mockDatabase.threadSubscriber.findMany.mockResolvedValue([
        { userId: 'subscriber-1' },
        { userId: 'lost-access' },
      ]);
      channelAccessService.viewerUserIds.mockResolvedValue(['subscriber-1']);

      const reply = MessageFactory.build({
        id: 'reply-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.PLAINTEXT,
            text: 'I agree!',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processThreadReplyNotifications(
        reply,
        'parent-msg-1',
        authorId,
      );

      expect(channelAccessService.viewerUserIds).toHaveBeenCalledWith(
        channelId,
      );
      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'subscriber-1',
        expect.anything(),
      );
      expect(pushNotificationsService.sendToUser).not.toHaveBeenCalledWith(
        'lost-access',
        expect.anything(),
      );
      expect(mockDatabase.notification.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'lost-access' }),
        }),
      );
    });

    it('should truncate long message text to 100 characters', async () => {
      const longText = 'A'.repeat(150);
      const spans = [
        {
          type: SpanType.PLAINTEXT,
          text: longText,
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ];
      setupNotificationCreate(NotificationType.USER_MENTION, spans);

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const message = MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: 'target-user',
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'target-user',
        expect.objectContaining({
          body: `John Doe: ${'A'.repeat(100)}...`,
        }),
      );
    });

    it('should preserve original case in message text', async () => {
      const spans = [
        {
          type: SpanType.PLAINTEXT,
          text: 'Hello World! Testing CaSe',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ];
      setupNotificationCreate(NotificationType.USER_MENTION, spans);

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const message = MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: 'target-user',
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'target-user',
        expect.objectContaining({
          body: 'John Doe: Hello World! Testing CaSe',
        }),
      );
    });

    it('should join multiple spans into a single text', async () => {
      const spans = [
        {
          type: SpanType.PLAINTEXT,
          text: 'Hello',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
        {
          type: SpanType.PLAINTEXT,
          text: 'World',
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ];
      setupNotificationCreate(NotificationType.USER_MENTION, spans);

      const settings = UserNotificationSettingsFactory.build();
      mockDatabase.userNotificationSettings.upsert.mockResolvedValue(settings);
      mockDatabase.channelNotificationOverride.findUnique.mockResolvedValue(
        null,
      );

      const message = MessageFactory.build({
        id: 'msg-1',
        channelId,
        authorId,
        spans: [
          {
            type: SpanType.USER_MENTION,
            userId: 'target-user',
            text: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      } as any);

      await service.processMessageForNotifications(message as any);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(
        'target-user',
        expect.objectContaining({
          body: 'John Doe: Hello World',
        }),
      );
    });
  });

  // ============================================================================
  // DEBUG METHODS
  // ============================================================================

  describe('createTestNotification', () => {
    it('should create a test notification for the user', async () => {
      const userId = 'user-1';
      const type = NotificationType.DIRECT_MESSAGE;
      const notification = NotificationFactory.build({
        userId,
        type,
        authorId: userId,
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: {
          id: userId,
          username: 'test',
          displayName: null,
          avatarUrl: null,
        },
        message: null,
      });

      const result = await service.createTestNotification(userId, type);

      expect(result).toBeDefined();
      expect(mockDatabase.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            type,
            authorId: userId,
          }),
        }),
      );
    });

    it('should create test notification with USER_MENTION type', async () => {
      const userId = 'user-1';
      const type = NotificationType.USER_MENTION;
      const notification = NotificationFactory.build({
        userId,
        type,
        authorId: userId,
      });

      mockDatabase.notification.create.mockResolvedValue({
        ...notification,
        author: {
          id: userId,
          username: 'test',
          displayName: null,
          avatarUrl: null,
        },
        message: null,
      });

      const result = await service.createTestNotification(userId, type);

      expect(result).toBeDefined();
      expect(result.type).toBe(type);
    });
  });

  describe('clearUserNotificationData', () => {
    it('should delete all notification data for the user', async () => {
      const userId = 'user-1';

      mockDatabase.notification.deleteMany.mockResolvedValue({ count: 5 });
      mockDatabase.userNotificationSettings.deleteMany.mockResolvedValue({
        count: 1,
      });
      mockDatabase.channelNotificationOverride.deleteMany.mockResolvedValue({
        count: 3,
      });

      const result = await service.clearUserNotificationData(userId);

      expect(result).toEqual({
        notificationsDeleted: 5,
        settingsDeleted: 1,
        overridesDeleted: 3,
      });

      expect(mockDatabase.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(
        mockDatabase.userNotificationSettings.deleteMany,
      ).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(
        mockDatabase.channelNotificationOverride.deleteMany,
      ).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it('should return zeros when no data exists', async () => {
      const userId = 'user-1';

      mockDatabase.notification.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.userNotificationSettings.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockDatabase.channelNotificationOverride.deleteMany.mockResolvedValue({
        count: 0,
      });

      const result = await service.clearUserNotificationData(userId);

      expect(result).toEqual({
        notificationsDeleted: 0,
        settingsDeleted: 0,
        overridesDeleted: 0,
      });
    });
  });
});
