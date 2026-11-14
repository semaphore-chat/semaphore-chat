import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { RoomSubscriptionHandler } from './room-subscription.handler';
import { WebsocketService } from '@/websocket/websocket.service';
import { DatabaseService } from '@/database/database.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { LivekitService } from '@/livekit/livekit.service';
import { createMockDatabase } from '@/test-utils';
import { ServerEvents } from '@semaphore-chat/shared';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { publishGrantFor } from '@/livekit/publish-grant.util';

describe('RoomSubscriptionHandler', () => {
  let handler: RoomSubscriptionHandler;
  let websocketService: Mocked<WebsocketService>;
  let voicePresenceService: Mocked<VoicePresenceService>;
  let livekitService: Mocked<LivekitService>;
  let channelAccessService: Mocked<ChannelAccessService>;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(RoomSubscriptionHandler)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    handler = unit;
    websocketService = unitRef.get(WebsocketService);
    voicePresenceService = unitRef.get(VoicePresenceService);
    livekitService = unitRef.get(LivekitService);
    channelAccessService = unitRef.get(ChannelAccessService);
    channelAccessService.visibleChannelIds.mockResolvedValue([]);

    // Default: user not in any voice channel
    voicePresenceService.getUserVoiceChannels.mockResolvedValue([]);
    // Default: LiveKit reports the user in no room
    livekitService.listParticipantRooms.mockResolvedValue([]);
    // Default: community has no alias groups
    mockDatabase.aliasGroup.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(handler).toBeDefined();
  });

  // =========================================================================
  // Community Membership
  // =========================================================================

  describe('onMembershipCreated', () => {
    it('should join user to community room and every channel they can see', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      channelAccessService.visibleChannelIds.mockResolvedValue([
        'channel-1',
        'channel-2',
      ]);

      await handler.onMembershipCreated({ userId, communityId });

      expect(channelAccessService.visibleChannelIds).toHaveBeenCalledWith(
        userId,
        communityId,
      );
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        `user:${userId}`,
        [`community:${communityId}`, 'channel-1', 'channel-2'],
      );
    });

    it('should notify the user about the new community', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      mockDatabase.channel.findMany.mockResolvedValue([]);

      await handler.onMembershipCreated({ userId, communityId });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `user:${userId}`,
        ServerEvents.MEMBER_ADDED_TO_COMMUNITY,
        { communityId, userId },
      );
    });

    it('should join community room even if no public channels exist', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      mockDatabase.channel.findMany.mockResolvedValue([]);

      await handler.onMembershipCreated({ userId, communityId });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        `user:${userId}`,
        [`community:${communityId}`],
      );
    });
  });

  describe('onMembershipRemoved', () => {
    it('should remove user from community room and ALL channel rooms', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';
      const channels = [
        { id: 'channel-1' },
        { id: 'channel-2' },
        { id: 'private-channel-3' },
      ];

      mockDatabase.channel.findMany.mockResolvedValue(channels);

      await handler.onMembershipRemoved({ userId, communityId });

      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: { communityId },
        select: { id: true },
      });
      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        `user:${userId}`,
        [
          `community:${communityId}`,
          'channel-1',
          'channel-2',
          'private-channel-3',
        ],
      );
    });

    it("should also remove user from the community's alias group rooms", async () => {
      const userId = 'user-123';
      const communityId = 'community-456';
      mockDatabase.channel.findMany.mockResolvedValue([{ id: 'channel-1' }]);
      mockDatabase.aliasGroup.findMany.mockResolvedValue([
        { id: 'alias-1' },
        { id: 'alias-2' },
      ]);

      await handler.onMembershipRemoved({ userId, communityId });

      expect(mockDatabase.aliasGroup.findMany).toHaveBeenCalledWith({
        where: { communityId },
        select: { id: true },
      });
      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        `user:${userId}`,
        [`community:${communityId}`, 'channel-1', 'alias-1', 'alias-2'],
      );
    });
  });

  // =========================================================================
  // Moderation
  // =========================================================================

  describe('onUserBanned', () => {
    it('should remove user from all community rooms', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';
      const channels = [{ id: 'channel-1' }];

      mockDatabase.channel.findMany.mockResolvedValue(channels);

      await handler.onUserBanned({ userId, communityId });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        `user:${userId}`,
        [`community:${communityId}`, 'channel-1'],
      );
    });

    it('should remove user from voice channels in the community', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      // First findMany call: onMembershipRemoved (all channels)
      // Second findMany call: removeUserFromCommunityVoice (VOICE channels)
      mockDatabase.channel.findMany
        .mockResolvedValueOnce([{ id: 'channel-1' }, { id: 'voice-1' }])
        .mockResolvedValueOnce([{ id: 'voice-1' }]);

      voicePresenceService.getUserVoiceChannels.mockResolvedValue(['voice-1']);

      await handler.onUserBanned({ userId, communityId });

      expect(livekitService.removeParticipant).toHaveBeenCalledWith(
        'voice-1',
        userId,
      );
      expect(voicePresenceService.leaveVoiceChannel).toHaveBeenCalledWith(
        'voice-1',
        userId,
      );
    });

    it('should not remove user from voice channels in other communities', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      // User is in a voice channel from a different community
      voicePresenceService.getUserVoiceChannels.mockResolvedValue([
        'voice-in-other-community',
      ]);

      mockDatabase.channel.findMany
        .mockResolvedValueOnce([{ id: 'channel-1' }])
        // DB intersection returns empty — no matching VOICE channels in this community
        .mockResolvedValueOnce([]);

      await handler.onUserBanned({ userId, communityId });

      expect(livekitService.removeParticipant).not.toHaveBeenCalled();
      expect(voicePresenceService.leaveVoiceChannel).not.toHaveBeenCalled();
    });

    it('should skip voice cleanup when user is not in any voice channel', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      mockDatabase.channel.findMany.mockResolvedValue([{ id: 'channel-1' }]);
      voicePresenceService.getUserVoiceChannels.mockResolvedValue([]);

      await handler.onUserBanned({ userId, communityId });

      // Should not query for community voice channels
      expect(mockDatabase.channel.findMany).toHaveBeenCalledTimes(1);
      expect(livekitService.removeParticipant).not.toHaveBeenCalled();
    });

    it('removes a user still connected to LiveKit after clearing their presence', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      mockDatabase.channel.findMany
        .mockResolvedValueOnce([{ id: 'channel-1' }, { id: 'voice-1' }])
        .mockResolvedValueOnce([{ id: 'voice-1' }]);
      // They called the REST leave: the presence index is empty...
      voicePresenceService.getUserVoiceChannels.mockResolvedValue([]);
      // ...but LiveKit still has them in the call
      livekitService.listParticipantRooms.mockResolvedValue([
        { roomName: 'voice-1', attributes: {} },
        { roomName: 'dm-call', attributes: {} },
      ]);

      await handler.onUserBanned({ userId, communityId });

      expect(mockDatabase.channel.findMany).toHaveBeenLastCalledWith({
        where: {
          communityId,
          type: 'VOICE',
          id: { in: ['voice-1', 'dm-call'] },
        },
        select: { id: true },
      });
      expect(livekitService.removeParticipant).toHaveBeenCalledWith(
        'voice-1',
        userId,
      );
      expect(livekitService.removeParticipant).toHaveBeenCalledTimes(1);
    });

    it('should not throw when voice cleanup fails', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      mockDatabase.channel.findMany
        .mockResolvedValueOnce([{ id: 'channel-1' }])
        .mockResolvedValueOnce([{ id: 'voice-1' }]);

      voicePresenceService.getUserVoiceChannels.mockResolvedValue(['voice-1']);
      livekitService.removeParticipant.mockRejectedValue(
        new Error('LiveKit error'),
      );

      await expect(
        handler.onUserBanned({ userId, communityId }),
      ).resolves.toBeUndefined();
    });
  });

  describe('onUserKicked', () => {
    it('should remove user from all community rooms', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';
      const channels = [{ id: 'channel-1' }];

      mockDatabase.channel.findMany.mockResolvedValue(channels);

      await handler.onUserKicked({ userId, communityId });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        `user:${userId}`,
        [`community:${communityId}`, 'channel-1'],
      );
    });

    it('should remove user from voice channels in the community', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';

      mockDatabase.channel.findMany
        .mockResolvedValueOnce([{ id: 'channel-1' }, { id: 'voice-1' }])
        .mockResolvedValueOnce([{ id: 'voice-1' }]);

      voicePresenceService.getUserVoiceChannels.mockResolvedValue(['voice-1']);

      await handler.onUserKicked({ userId, communityId });

      expect(livekitService.removeParticipant).toHaveBeenCalledWith(
        'voice-1',
        userId,
      );
      expect(voicePresenceService.leaveVoiceChannel).toHaveBeenCalledWith(
        'voice-1',
        userId,
      );
    });
  });

  // =========================================================================
  // Channel Lifecycle
  // =========================================================================

  describe('onChannelCreated', () => {
    it('should join all community members to a channel everyone can see', async () => {
      const channelId = 'channel-123';
      const communityId = 'community-456';
      channelAccessService.roomPlan.mockResolvedValue({
        everyone: true,
        communityId,
      });

      await handler.onChannelCreated({ channelId, communityId });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        `community:${communityId}`,
        channelId,
      );
    });

    it('should join only the viewers of a hidden channel', async () => {
      channelAccessService.roomPlan.mockResolvedValue({
        everyone: false,
        communityId: 'community-456',
        viewers: ['creator'],
        nonViewers: ['other'],
      });

      await handler.onChannelCreated({
        channelId: 'channel-123',
        communityId: 'community-456',
      });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledTimes(1);
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:creator',
        'channel-123',
      );
      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:other',
        'channel-123',
      );
    });
  });

  describe('onChannelVisibilityChanged', () => {
    it('removes users who lost access and joins those who can see it', async () => {
      channelAccessService.roomPlan.mockResolvedValue({
        everyone: false,
        communityId: 'community-456',
        viewers: ['member'],
        nonViewers: ['outsider'],
      });

      await handler.onChannelVisibilityChanged({
        channelId: 'channel-123',
        communityId: 'community-456',
      });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:outsider',
        'channel-123',
      );
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:member',
        'channel-123',
      );
      // ...and their thread subscriptions in that channel
      expect(mockDatabase.threadSubscriber.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: { in: ['outsider'] },
          parentMessage: { channelId: 'channel-123' },
        },
      });
    });

    it('keeps thread subscriptions when nobody lost access', async () => {
      channelAccessService.roomPlan.mockResolvedValue({
        everyone: false,
        communityId: 'community-456',
        viewers: ['member'],
        nonViewers: [],
      });

      await handler.onChannelVisibilityChanged({
        channelId: 'channel-123',
        communityId: 'community-456',
      });

      expect(mockDatabase.threadSubscriber.deleteMany).not.toHaveBeenCalled();
    });

    describe('voice: users who lost view leave the call', () => {
      const presenceUser = (id: string) => ({
        id,
        username: id,
        joinedAt: new Date(),
        isDeafened: false,
      });

      beforeEach(() => {
        channelAccessService.roomPlan.mockResolvedValue({
          everyone: false,
          communityId: 'community-456',
          viewers: ['member'],
          nonViewers: ['outsider', 'idle-outsider'],
        });
        mockDatabase.channel.findUnique.mockResolvedValue({ type: 'VOICE' });
        voicePresenceService.getChannelPresence.mockResolvedValue([
          presenceUser('member'),
          presenceUser('outsider'),
        ] as never);
        livekitService.listParticipantIdentities.mockResolvedValue([
          'member',
          'outsider',
          'EG_replay-egress',
        ]);
      });

      it('disconnects connected non-viewers and clears their presence (privacy flip)', async () => {
        await handler.onChannelVisibilityChanged({
          channelId: 'channel-123',
          communityId: 'community-456',
        });

        expect(livekitService.removeParticipant).toHaveBeenCalledTimes(1);
        expect(livekitService.removeParticipant).toHaveBeenCalledWith(
          'channel-123',
          'outsider',
        );
        expect(voicePresenceService.leaveVoiceChannel).toHaveBeenCalledTimes(1);
        expect(voicePresenceService.leaveVoiceChannel).toHaveBeenCalledWith(
          'channel-123',
          'outsider',
        );
        // Viewers stay, and so do LiveKit's own (egress) participants
        expect(livekitService.removeParticipant).not.toHaveBeenCalledWith(
          'channel-123',
          'member',
        );
      });

      it('also catches non-viewers whose presence lapsed but who are still in the LiveKit room', async () => {
        voicePresenceService.getChannelPresence.mockResolvedValue([]);
        livekitService.listParticipantIdentities.mockResolvedValue([
          'idle-outsider',
        ]);

        await handler.onChannelVisibilityChanged({
          channelId: 'channel-123',
          communityId: 'community-456',
        });

        expect(livekitService.removeParticipant).toHaveBeenCalledWith(
          'channel-123',
          'idle-outsider',
        );
      });

      it('swallows LiveKit and presence errors', async () => {
        livekitService.removeParticipant.mockRejectedValue(new Error('lk'));
        voicePresenceService.leaveVoiceChannel.mockRejectedValue(
          new Error('redis'),
        );

        await expect(
          handler.onChannelVisibilityChanged({
            channelId: 'channel-123',
            communityId: 'community-456',
          }),
        ).resolves.toBeUndefined();
      });

      it('swallows a failure to list who is connected', async () => {
        voicePresenceService.getChannelPresence.mockRejectedValue(
          new Error('redis'),
        );

        await expect(
          handler.onChannelVisibilityChanged({
            channelId: 'channel-123',
            communityId: 'community-456',
          }),
        ).resolves.toBeUndefined();
        expect(livekitService.removeParticipant).not.toHaveBeenCalled();
        // The socket room was still synced
        expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
          'user:outsider',
          'channel-123',
        );
      });

      it('leaves text channels alone', async () => {
        mockDatabase.channel.findUnique.mockResolvedValue({ type: 'TEXT' });

        await handler.onChannelVisibilityChanged({
          channelId: 'channel-123',
          communityId: 'community-456',
        });

        expect(livekitService.listParticipantIdentities).not.toHaveBeenCalled();
        expect(livekitService.removeParticipant).not.toHaveBeenCalled();
      });

      it('touches no call when everyone can see the channel', async () => {
        channelAccessService.roomPlan.mockResolvedValue({
          everyone: true,
          communityId: 'community-456',
        });

        await handler.onChannelVisibilityChanged({
          channelId: 'channel-123',
          communityId: 'community-456',
        });

        expect(livekitService.removeParticipant).not.toHaveBeenCalled();
        expect(voicePresenceService.leaveVoiceChannel).not.toHaveBeenCalled();
      });

      it('skips DM rooms (not a channel: no room plan)', async () => {
        channelAccessService.roomPlan.mockResolvedValue(null);

        await handler.onChannelVisibilityChanged({
          channelId: 'dm-group-1',
          communityId: 'community-456',
        });

        expect(livekitService.removeParticipant).not.toHaveBeenCalled();
        expect(voicePresenceService.leaveVoiceChannel).not.toHaveBeenCalled();
      });
    });

    it('does nothing for a channel that no longer exists', async () => {
      channelAccessService.roomPlan.mockResolvedValue(null);

      await handler.onChannelVisibilityChanged({
        channelId: 'gone',
        communityId: 'community-456',
      });

      expect(websocketService.joinSocketsToRoom).not.toHaveBeenCalled();
      expect(websocketService.removeSocketsFromRoom).not.toHaveBeenCalled();
    });
  });

  describe('onTimeoutChanged', () => {
    const caps = {
      channelId: 'voice-1',
      view: true,
      post: false,
      attach: false,
      react: false,
      threadReply: false,
      connect: true,
      speak: false,
      video: false,
      share: false,
      managePermissions: false,
      pin: false,
      deleteAny: false,
      seeRemoved: false,
      timedOutUntil: new Date(Date.now() + 60_000),
      postingRoleNames: [],
    };

    it("makes a timed-out user listen-only in the community's calls they're in", async () => {
      voicePresenceService.getUserVoiceChannels.mockResolvedValue([
        'voice-1',
        'other-community-voice',
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([{ id: 'voice-1' }]);
      channelAccessService.channelCapabilities.mockResolvedValue(caps);

      await handler.onTimeoutChanged({
        userId: 'user-1',
        communityId: 'community-456',
      });

      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: {
          communityId: 'community-456',
          id: { in: ['voice-1', 'other-community-voice'] },
        },
        select: { id: true },
      });
      expect(livekitService.updatePublishPermissions).toHaveBeenCalledTimes(1);
      expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
        { canPublish: false },
      );
    });

    it('restores full publishing once the timeout is lifted', async () => {
      voicePresenceService.getUserVoiceChannels.mockResolvedValue(['voice-1']);
      mockDatabase.channel.findMany.mockResolvedValue([{ id: 'voice-1' }]);
      channelAccessService.channelCapabilities.mockResolvedValue({
        ...caps,
        post: true,
        speak: true,
        video: true,
        share: true,
        timedOutUntil: null,
      });

      await handler.onTimeoutChanged({
        userId: 'user-1',
        communityId: 'community-456',
      });

      expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
        { canPublish: true },
      );
    });

    it('clamps a user still connected to LiveKit after clearing their presence', async () => {
      voicePresenceService.getUserVoiceChannels.mockResolvedValue([]);
      livekitService.listParticipantRooms.mockResolvedValue([
        { roomName: 'voice-1', attributes: {} },
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([{ id: 'voice-1' }]);
      channelAccessService.channelCapabilities.mockResolvedValue(caps);

      await handler.onTimeoutChanged({
        userId: 'user-1',
        communityId: 'community-456',
      });

      expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
        { canPublish: false },
      );
    });

    it('does nothing when the user is in no call', async () => {
      voicePresenceService.getUserVoiceChannels.mockResolvedValue([]);

      await handler.onTimeoutChanged({
        userId: 'user-1',
        communityId: 'community-456',
      });

      expect(livekitService.updatePublishPermissions).not.toHaveBeenCalled();
    });
  });

  describe('onTimeoutExpired', () => {
    it('sends TIMEOUT_REMOVED marked expired to the community room', () => {
      handler.onTimeoutExpired({
        userId: 'user-1',
        communityId: 'community-456',
        moderatorId: 'mod-1',
      });

      // RT-4: the community isn't told who set the timeout; the target is
      expect(websocketService.sendToRoom).toHaveBeenCalledTimes(2);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.TIMEOUT_REMOVED,
        {
          communityId: 'community-456',
          userId: 'user-1',
          expired: true,
        },
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.TIMEOUT_REMOVED,
        {
          communityId: 'community-456',
          userId: 'user-1',
          moderatorId: 'mod-1',
          expired: true,
        },
      );
    });
  });

  describe('onChannelDeleted', () => {
    it('should remove all sockets from the deleted channel room', () => {
      const channelId = 'channel-123';

      handler.onChannelDeleted({ channelId });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        channelId,
        channelId,
      );
    });
  });

  // =========================================================================
  // Private Channel Membership
  // =========================================================================

  describe('onChannelMembershipCreated', () => {
    it('should join user to private channel room', () => {
      handler.onChannelMembershipCreated({
        userId: 'user-123',
        channelId: 'channel-456',
        communityId: 'community-789',
      });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-123',
        'channel-456',
      );
    });

    it('tells only that user their channel list changed', () => {
      handler.onChannelMembershipCreated({
        userId: 'user-123',
        channelId: 'channel-456',
        communityId: 'community-789',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledTimes(1);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.PRIVATE_CHANNEL_ADDED,
        { communityId: 'community-789', channelId: 'channel-456' },
      );
    });
  });

  describe('onChannelMembershipRemoved', () => {
    it('should remove user from private channel room', async () => {
      channelAccessService.canViewChannel.mockResolvedValue(false);
      mockDatabase.channel.findUnique.mockResolvedValue({ type: 'TEXT' });

      await handler.onChannelMembershipRemoved({
        userId: 'user-123',
        channelId: 'channel-456',
        communityId: 'community-789',
      });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:user-123',
        'channel-456',
      );
    });

    it('tells only that user their channel list changed', async () => {
      channelAccessService.canViewChannel.mockResolvedValue(true);

      await handler.onChannelMembershipRemoved({
        userId: 'user-123',
        channelId: 'channel-456',
        communityId: 'community-789',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledTimes(1);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.PRIVATE_CHANNEL_REMOVED,
        { communityId: 'community-789', channelId: 'channel-456' },
      );
    });

    it('disconnects the removed user from the voice call', async () => {
      channelAccessService.canViewChannel.mockResolvedValue(false);
      mockDatabase.channel.findUnique.mockResolvedValue({ type: 'VOICE' });
      voicePresenceService.getChannelPresence.mockResolvedValue([
        { id: 'user-123' },
        { id: 'user-other' },
      ] as never);
      livekitService.listParticipantIdentities.mockResolvedValue([]);

      await handler.onChannelMembershipRemoved({
        userId: 'user-123',
        channelId: 'channel-456',
        communityId: 'community-789',
      });

      expect(channelAccessService.canViewChannel).toHaveBeenCalledWith(
        'user-123',
        'channel-456',
      );
      expect(livekitService.removeParticipant).toHaveBeenCalledTimes(1);
      expect(livekitService.removeParticipant).toHaveBeenCalledWith(
        'channel-456',
        'user-123',
      );
      expect(voicePresenceService.leaveVoiceChannel).toHaveBeenCalledWith(
        'channel-456',
        'user-123',
      );
    });

    it('keeps a user in the call who can still view it (e.g. a role allow)', async () => {
      channelAccessService.canViewChannel.mockResolvedValue(true);

      await handler.onChannelMembershipRemoved({
        userId: 'user-123',
        channelId: 'channel-456',
        communityId: 'community-789',
      });

      expect(livekitService.removeParticipant).not.toHaveBeenCalled();
      expect(voicePresenceService.leaveVoiceChannel).not.toHaveBeenCalled();
    });

    it('does nothing when they are not connected', async () => {
      channelAccessService.canViewChannel.mockResolvedValue(false);
      mockDatabase.channel.findUnique.mockResolvedValue({ type: 'VOICE' });
      voicePresenceService.getChannelPresence.mockResolvedValue([]);
      livekitService.listParticipantIdentities.mockResolvedValue([]);

      await handler.onChannelMembershipRemoved({
        userId: 'user-123',
        channelId: 'channel-456',
        communityId: 'community-789',
      });

      expect(livekitService.removeParticipant).not.toHaveBeenCalled();
    });

    it('swallows errors from the access check', async () => {
      channelAccessService.canViewChannel.mockRejectedValue(new Error('db'));

      await expect(
        handler.onChannelMembershipRemoved({
          userId: 'user-123',
          channelId: 'channel-456',
          communityId: 'community-789',
        }),
      ).resolves.toBeUndefined();
      expect(livekitService.removeParticipant).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Direct Message Groups
  // =========================================================================

  describe('onDmGroupCreated', () => {
    it('should join all members to the DM group room', () => {
      const memberIds = ['user-1', 'user-2', 'user-3'];

      handler.onDmGroupCreated({ groupId: 'dm-group-123', memberIds });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledTimes(3);
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-1',
        'dm:dm-group-123',
      );
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-2',
        'dm:dm-group-123',
      );
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-3',
        'dm:dm-group-123',
      );
    });

    it('tells every member the group exists, on their personal rooms', () => {
      const memberIds = ['user-1', 'user-2'];

      handler.onDmGroupCreated({ groupId: 'dm-group-123', memberIds });

      expect(websocketService.sendToRoom).toHaveBeenCalledTimes(2);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.DM_GROUP_CREATED,
        { groupId: 'dm-group-123', memberIds },
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-2',
        ServerEvents.DM_GROUP_CREATED,
        { groupId: 'dm-group-123', memberIds },
      );
    });
  });

  describe('onDmGroupMemberAdded', () => {
    it('should join new members to the DM group room', async () => {
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-4' },
        { userId: 'user-5' },
      ]);

      await handler.onDmGroupMemberAdded({
        groupId: 'dm-group-123',
        userIds: ['user-4', 'user-5'],
      });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledTimes(2);
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-4',
        'dm:dm-group-123',
      );
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-5',
        'dm:dm-group-123',
      );
    });

    it('tells every member, including the added ones', async () => {
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-4' },
      ]);

      await handler.onDmGroupMemberAdded({
        groupId: 'dm-group-123',
        userIds: ['user-4', 'new-user'],
      });

      expect(
        mockDatabase.directMessageGroupMember.findMany,
      ).toHaveBeenCalledWith({
        where: { groupId: 'dm-group-123' },
        select: { userId: true },
      });
      const rooms = (
        websocketService.sendToRoom.mock.calls as unknown as [string][]
      ).map((call) => call[0]);
      expect(rooms.sort()).toEqual([
        'user:new-user',
        'user:user-1',
        'user:user-4',
      ]);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.DM_GROUP_MEMBER_ADDED,
        { groupId: 'dm-group-123', userIds: ['user-4', 'new-user'] },
      );
    });
  });

  describe('onDmGroupMemberLeft', () => {
    it('should remove user from the DM group room and its call', async () => {
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId: 'user-1' },
      ]);

      await handler.onDmGroupMemberLeft({
        groupId: 'dm-group-123',
        userId: 'user-123',
      });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:user-123',
        'dm:dm-group-123',
      );
      expect(livekitService.removeParticipant).toHaveBeenCalledWith(
        'dm-group-123',
        'user-123',
      );
      expect(voicePresenceService.leaveDmVoice).toHaveBeenCalledWith(
        'dm-group-123',
        'user-123',
      );
    });

    it('tells the remaining members and the one who left', async () => {
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);

      await handler.onDmGroupMemberLeft({
        groupId: 'dm-group-123',
        userId: 'user-123',
      });

      const rooms = (
        websocketService.sendToRoom.mock.calls as unknown as [string][]
      ).map((call) => call[0]);
      expect(rooms.sort()).toEqual([
        'user:user-1',
        'user:user-123',
        'user:user-2',
      ]);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.DM_GROUP_MEMBER_LEFT,
        { groupId: 'dm-group-123', userId: 'user-123' },
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.DM_GROUP_MEMBER_LEFT,
        { groupId: 'dm-group-123', userId: 'user-123' },
      );
    });
  });

  // =========================================================================
  // Alias Groups
  // =========================================================================

  describe('onAliasGroupCreated', () => {
    it('should join all members to the alias group room', () => {
      const memberIds = ['user-1', 'user-2'];

      handler.onAliasGroupCreated({
        aliasGroupId: 'alias-123',
        memberIds,
        communityId: 'community-456',
      });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledTimes(2);
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-1',
        'alias-123',
      );
      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-2',
        'alias-123',
      );
    });

    it('tells the community the list gained a group', () => {
      handler.onAliasGroupCreated({
        aliasGroupId: 'alias-123',
        memberIds: [],
        communityId: 'community-456',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledTimes(1);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.ALIAS_GROUP_CREATED,
        { communityId: 'community-456', groupId: 'alias-123' },
      );
    });
  });

  describe('onAliasGroupUpdated', () => {
    it('tells the community a group changed', () => {
      handler.onAliasGroupUpdated({
        aliasGroupId: 'alias-123',
        communityId: 'community-456',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.ALIAS_GROUP_UPDATED,
        { communityId: 'community-456', groupId: 'alias-123' },
      );
    });
  });

  describe('onAliasGroupMemberAdded', () => {
    it('should join user to alias group room', () => {
      handler.onAliasGroupMemberAdded({
        aliasGroupId: 'alias-123',
        userId: 'user-456',
        communityId: 'community-789',
      });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-456',
        'alias-123',
      );
    });

    it("tells the community the group's members changed", () => {
      handler.onAliasGroupMemberAdded({
        aliasGroupId: 'alias-123',
        userId: 'user-456',
        communityId: 'community-789',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-789',
        ServerEvents.ALIAS_GROUP_MEMBERS_UPDATED,
        { communityId: 'community-789', groupId: 'alias-123' },
      );
    });
  });

  describe('onAliasGroupMemberRemoved', () => {
    it('should remove user from alias group room', () => {
      handler.onAliasGroupMemberRemoved({
        aliasGroupId: 'alias-123',
        userId: 'user-456',
        communityId: 'community-789',
      });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:user-456',
        'alias-123',
      );
    });

    it("tells the community the group's members changed", () => {
      handler.onAliasGroupMemberRemoved({
        aliasGroupId: 'alias-123',
        userId: 'user-456',
        communityId: 'community-789',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-789',
        ServerEvents.ALIAS_GROUP_MEMBERS_UPDATED,
        { communityId: 'community-789', groupId: 'alias-123' },
      );
    });
  });

  describe('onAliasGroupDeleted', () => {
    it('should remove all members from the alias group room', () => {
      const memberIds = ['user-1', 'user-2'];

      handler.onAliasGroupDeleted({
        aliasGroupId: 'alias-123',
        memberIds,
        communityId: 'community-456',
      });

      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledTimes(2);
      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:user-1',
        'alias-123',
      );
      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:user-2',
        'alias-123',
      );
    });

    it('tells the community the list lost a group', () => {
      handler.onAliasGroupDeleted({
        aliasGroupId: 'alias-123',
        memberIds: [],
        communityId: 'community-456',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.ALIAS_GROUP_DELETED,
        { communityId: 'community-456', groupId: 'alias-123' },
      );
    });
  });

  describe('onAliasGroupMembersUpdated', () => {
    it('should join added members and remove removed members', () => {
      handler.onAliasGroupMembersUpdated({
        aliasGroupId: 'alias-123',
        addedUserIds: ['user-new'],
        removedUserIds: ['user-old'],
        communityId: 'community-456',
      });

      expect(websocketService.joinSocketsToRoom).toHaveBeenCalledWith(
        'user:user-new',
        'alias-123',
      );
      expect(websocketService.removeSocketsFromRoom).toHaveBeenCalledWith(
        'user:user-old',
        'alias-123',
      );
    });

    it("tells the community the group's members changed", () => {
      handler.onAliasGroupMembersUpdated({
        aliasGroupId: 'alias-123',
        addedUserIds: ['user-new'],
        removedUserIds: [],
        communityId: 'community-456',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.ALIAS_GROUP_MEMBERS_UPDATED,
        { communityId: 'community-456', groupId: 'alias-123' },
      );
    });

    it('should handle empty added/removed arrays', () => {
      handler.onAliasGroupMembersUpdated({
        aliasGroupId: 'alias-123',
        addedUserIds: [],
        removedUserIds: [],
        communityId: 'community-456',
      });

      expect(websocketService.joinSocketsToRoom).not.toHaveBeenCalled();
      expect(websocketService.removeSocketsFromRoom).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Community Assets
  // =========================================================================

  describe('custom emoji', () => {
    it('announces a created emoji to the community', () => {
      handler.onCustomEmojiCreated({
        communityId: 'community-456',
        emojiId: 'emoji-1',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.CUSTOM_EMOJI_CREATED,
        { communityId: 'community-456', emojiId: 'emoji-1' },
      );
    });

    it('announces a deleted emoji to the community', () => {
      handler.onCustomEmojiDeleted({
        communityId: 'community-456',
        emojiId: 'emoji-1',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.CUSTOM_EMOJI_DELETED,
        { communityId: 'community-456', emojiId: 'emoji-1' },
      );
    });
  });

  describe('soundboard', () => {
    it('announces a created sound to the community', () => {
      handler.onSoundboardSoundCreated({
        communityId: 'community-456',
        soundId: 'sound-1',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.SOUNDBOARD_SOUND_CREATED,
        { communityId: 'community-456', soundId: 'sound-1' },
      );
    });

    it('announces a deleted sound to the community', () => {
      handler.onSoundboardSoundDeleted({
        communityId: 'community-456',
        soundId: 'sound-1',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'community:community-456',
        ServerEvents.SOUNDBOARD_SOUND_DELETED,
        { communityId: 'community-456', soundId: 'sound-1' },
      );
    });
  });

  describe('webhooks', () => {
    it('announces a created webhook without the token or URL', () => {
      handler.onWebhookCreated({
        communityId: 'community-456',
        channelId: 'channel-1',
        webhookId: 'webhook-1',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-1',
        ServerEvents.WEBHOOK_CREATED,
        {
          communityId: 'community-456',
          channelId: 'channel-1',
          webhookId: 'webhook-1',
        },
      );
    });

    it('announces a deleted webhook', () => {
      handler.onWebhookDeleted({
        communityId: 'community-456',
        channelId: 'channel-1',
        webhookId: 'webhook-1',
      });

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-1',
        ServerEvents.WEBHOOK_DELETED,
        {
          communityId: 'community-456',
          channelId: 'channel-1',
          webhookId: 'webhook-1',
        },
      );
    });
  });

  // =========================================================================
  // Friends
  // =========================================================================

  describe('friendship events', () => {
    const friendship = {
      friendshipId: 'fr-1',
      userAId: 'sender',
      userBId: 'receiver',
    };

    /** The personal rooms the event reached, sorted. */
    function rooms(): string[] {
      return (websocketService.sendToRoom.mock.calls as unknown as [string][])
        .map((call) => call[0])
        .sort();
    }

    it("a request reaches the recipient, and the sender's own devices", () => {
      handler.onFriendRequestSent({ ...friendship, actorId: 'sender' });

      expect(rooms()).toEqual(['user:receiver', 'user:sender']);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:receiver',
        ServerEvents.FRIEND_REQUEST_SENT,
        {
          friendshipId: 'fr-1',
          userAId: 'sender',
          userBId: 'receiver',
        },
      );
    });

    it('an acceptance reaches both sides', () => {
      handler.onFriendRequestAccepted({ ...friendship, actorId: 'receiver' });

      expect(rooms()).toEqual(['user:receiver', 'user:sender']);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:sender',
        ServerEvents.FRIEND_REQUEST_ACCEPTED,
        {
          friendshipId: 'fr-1',
          userAId: 'sender',
          userBId: 'receiver',
        },
      );
    });

    it('a decline reaches both people', () => {
      handler.onFriendRequestDeclined({ ...friendship, actorId: 'receiver' });

      expect(rooms()).toEqual(['user:receiver', 'user:sender']);
    });

    it('a cancellation reaches both people', () => {
      handler.onFriendRequestCancelled({ ...friendship, actorId: 'sender' });

      expect(rooms()).toEqual(['user:receiver', 'user:sender']);
    });

    it('a removal reaches both people, from either side', () => {
      handler.onFriendRemoved({ ...friendship, actorId: 'sender' });
      expect(rooms()).toEqual(['user:receiver', 'user:sender']);

      jest.clearAllMocks();
      handler.onFriendRemoved({ ...friendship, actorId: 'receiver' });
      expect(rooms()).toEqual(['user:receiver', 'user:sender']);
    });

    it('sends nothing to a community or DM room', () => {
      handler.onFriendRequestSent({ ...friendship, actorId: 'sender' });

      for (const [room] of websocketService.sendToRoom.mock
        .calls as unknown as [string][]) {
        expect(room).toMatch(/^user:/);
      }
    });
  });

  // =========================================================================
  // Instance Roles
  // =========================================================================

  describe('voice grants follow role and channel permission changes', () => {
    const caps = (over: Partial<Record<string, boolean>> = {}) => ({
      channelId: 'voice-1',
      view: true,
      post: true,
      attach: true,
      react: true,
      threadReply: true,
      connect: true,
      speak: true,
      video: true,
      share: true,
      managePermissions: false,
      pin: false,
      deleteAny: false,
      seeRemoved: false,
      timedOutUntil: null,
      postingRoleNames: [],
      ...over,
    });

    beforeEach(() => {
      mockDatabase.channel.findMany.mockResolvedValue([{ id: 'voice-1' }]);
      voicePresenceService.getChannelPresence.mockResolvedValue([]);
      voicePresenceService.isServerMuted.mockResolvedValue(false);
      livekitService.listParticipantIdentities.mockResolvedValue(['user-1']);
      mockDatabase.membership.findMany.mockResolvedValue([
        { userId: 'user-1' },
      ]);
    });

    it('ROLE_UNASSIGNED re-clamps what the user may publish in the call', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue(
        caps({ speak: false }),
      );

      await handler.onRoleUnassigned({
        communityId: 'community-456',
        userId: 'user-1',
        roleId: 'role-1',
      });

      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: { communityId: 'community-456', type: 'VOICE' },
        select: { id: true },
      });
      expect(channelAccessService.channelCapabilities).toHaveBeenCalledWith(
        'user-1',
        'voice-1',
      );
      expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
        publishGrantFor({ speak: false, video: true, share: true }),
      );
    });

    it('keeps a server mute when re-clamping', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue(caps());
      voicePresenceService.isServerMuted.mockResolvedValue(true);

      await handler.onRoleAssigned({
        communityId: 'community-456',
        userId: 'user-1',
        roleId: 'role-1',
        roleName: 'Speaker',
      });

      expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
        publishGrantFor({ speak: true, video: true, share: true }, true),
      );
    });

    it('removes a user who lost JOIN_CHANNEL from the call', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue(
        caps({ connect: false, speak: false, video: false, share: false }),
      );

      await handler.onRoleUnassigned({
        communityId: 'community-456',
        userId: 'user-1',
        roleId: 'role-1',
      });

      expect(livekitService.removeParticipant).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
      );
      expect(voicePresenceService.leaveVoiceChannel).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
      );
      expect(livekitService.updatePublishPermissions).not.toHaveBeenCalled();
    });

    it("ROLE_UNASSIGNED leaves the call's other participants alone", async () => {
      livekitService.listParticipantIdentities.mockResolvedValue([
        'user-1',
        'user-2',
      ]);
      channelAccessService.channelCapabilities.mockResolvedValue(caps());

      await handler.onRoleUnassigned({
        communityId: 'community-456',
        userId: 'user-1',
        roleId: 'role-1',
      });

      expect(livekitService.updatePublishPermissions).toHaveBeenCalledTimes(1);
      expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
        expect.anything(),
      );
    });

    it.each(['onRoleUpdated', 'onRoleDeleted'] as const)(
      '%s re-clamps every member in the community calls, never a non-member (egress)',
      async (method) => {
        livekitService.listParticipantIdentities.mockResolvedValue([
          'user-1',
          'EG_replay',
        ]);
        voicePresenceService.getChannelPresence.mockResolvedValue([
          { id: 'user-2' } as never,
        ]);
        mockDatabase.membership.findMany.mockResolvedValue([
          { userId: 'user-1' },
          { userId: 'user-2' },
        ]);
        channelAccessService.channelCapabilities.mockResolvedValue(caps());

        await handler[method]({
          communityId: 'community-456',
          roleId: 'role-1',
          roleName: 'Role',
        });

        expect(mockDatabase.membership.findMany).toHaveBeenCalledWith({
          where: {
            communityId: 'community-456',
            userId: { in: ['user-2', 'user-1', 'EG_replay'] },
          },
          select: { userId: true },
        });
        expect(livekitService.updatePublishPermissions).toHaveBeenCalledTimes(
          2,
        );
        expect(
          livekitService.updatePublishPermissions,
        ).not.toHaveBeenCalledWith('voice-1', 'EG_replay', expect.anything());
        expect(livekitService.removeParticipant).not.toHaveBeenCalled();
      },
    );

    it('coalesces a burst of ROLE_UPDATED (a role reorder) into at most two resyncs per community', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue(caps());
      const fullResyncs = () =>
        mockDatabase.channel.findMany.mock.calls.filter(
          ([args]) => !(args as { where: { id?: unknown } }).where.id,
        ).length;

      // 30 roles reordered: one event each, emitted without awaiting
      const events = Array.from({ length: 30 }, (_, i) =>
        handler.onRoleUpdated({
          communityId: 'community-456',
          roleId: `role-${i}`,
          roleName: `Role ${i}`,
        }),
      );
      // Another community's resync is not held back by this one
      const other = handler.onRoleDeleted({
        communityId: 'community-other',
        roleId: 'role-x',
      });
      await Promise.all([...events, other]);

      // The first runs; the other 29 queue one more behind it
      expect(fullResyncs()).toBe(3);
      expect(livekitService.listParticipantIdentities).toHaveBeenCalledTimes(3);
      // Every event was still broadcast
      expect(websocketService.sendToRoom).toHaveBeenCalledTimes(31);

      // Once idle, the next change resyncs again
      await handler.onRoleUpdated({
        communityId: 'community-456',
        roleId: 'role-0',
        roleName: 'Role 0',
      });
      expect(fullResyncs()).toBe(4);
    });

    it('a change during a running resync is applied by one queued resync after it', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue(caps());
      let release!: () => void;
      livekitService.listParticipantIdentities.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(['user-1']);
          }),
      );
      const first = handler.onRoleUpdated({
        communityId: 'community-456',
        roleId: 'role-1',
        roleName: 'Role',
      });
      await new Promise(setImmediate);
      // Arrives while the first is in flight: must not be lost
      const second = handler.onRoleUpdated({
        communityId: 'community-456',
        roleId: 'role-2',
        roleName: 'Role',
      });
      release();
      await Promise.all([first, second]);

      expect(livekitService.listParticipantIdentities).toHaveBeenCalledTimes(2);
    });

    it('a channel permission change re-clamps the viewers still in its call', async () => {
      channelAccessService.roomPlan.mockResolvedValue({
        everyone: true,
        communityId: 'community-456',
      });
      channelAccessService.channelCapabilities.mockResolvedValue(
        caps({ video: false, share: false }),
      );

      await handler.onChannelVisibilityChanged({
        channelId: 'voice-1',
        communityId: 'community-456',
      });

      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: {
          communityId: 'community-456',
          type: 'VOICE',
          id: { in: ['voice-1'] },
        },
        select: { id: true },
      });
      expect(livekitService.updatePublishPermissions).toHaveBeenCalledWith(
        'voice-1',
        'user-1',
        publishGrantFor({ speak: true, video: false, share: false }),
      );
    });

    it('never throws: a LiveKit failure for one participant is logged', async () => {
      livekitService.listParticipantIdentities.mockResolvedValue([
        'user-1',
        'user-2',
      ]);
      mockDatabase.membership.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      channelAccessService.channelCapabilities.mockResolvedValue(caps());
      livekitService.updatePublishPermissions.mockRejectedValueOnce(
        new Error('participant left'),
      );

      await expect(
        handler.onRoleUpdated({
          communityId: 'community-456',
          roleId: 'role-1',
          roleName: 'Role',
        }),
      ).resolves.toBeUndefined();
      expect(livekitService.updatePublishPermissions).toHaveBeenCalledTimes(2);
    });
  });

  describe('onInstanceRolesUpdated', () => {
    it("tells the user's own sessions which role changed", () => {
      handler.onInstanceRolesUpdated({ userId: 'user-1', roleId: 'role-1' });

      expect(websocketService.sendToRoom).toHaveBeenCalledTimes(1);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-1',
        ServerEvents.INSTANCE_ROLES_UPDATED,
        { userId: 'user-1', roleId: 'role-1' },
      );
    });
  });
});
