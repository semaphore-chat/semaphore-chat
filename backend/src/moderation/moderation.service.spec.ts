import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModerationService } from './moderation.service';
import { DatabaseService } from '@/database/database.service';
import { RolesService } from '@/roles/roles.service';
import { MembershipService } from '@/membership/membership.service';
import { WebsocketService } from '@/websocket/websocket.service';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  createMockDatabase,
  ChannelFactory,
  MessageFactory,
} from '@/test-utils';
import { ModerationAction } from '@prisma/client';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { RoomName } from '@/common/utils/room-name.util';

describe('ModerationService', () => {
  let service: ModerationService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let rolesService: Mocked<RolesService>;
  let membershipService: Mocked<MembershipService>;
  let websocketService: Mocked<WebsocketService>;
  let eventEmitter: Mocked<EventEmitter2>;

  const moderatorId = 'moderator-123';
  const userId = 'user-456';
  const communityId = 'community-789';
  const channelId = 'channel-321';
  const messageId = 'message-654';

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(ModerationService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    rolesService = unitRef.get(RolesService);
    membershipService = unitRef.get(MembershipService);
    websocketService = unitRef.get(WebsocketService);
    eventEmitter = unitRef.get(EventEmitter2);

    // Default: user lookups return empty (enrichment queries)
    mockDatabase.user.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockAdminRole = {
    id: '1',
    name: 'Admin',
    actions: [] as any[],
    createdAt: new Date(),
    isDefault: true,
  };
  const mockMemberRole = {
    id: '2',
    name: 'Member',
    actions: [] as any[],
    createdAt: new Date(),
    isDefault: true,
  };

  const createMockUserRoles = (roles: (typeof mockAdminRole)[]) => ({
    userId: 'test-user',
    resourceId: communityId,
    resourceType: 'COMMUNITY' as const,
    roles,
  });

  describe('banUser', () => {
    beforeEach(() => {
      // Setup default mock for role hierarchy (moderator > user)
      rolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole]) as any) // moderator
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole]) as any); // user
      membershipService.isMember.mockResolvedValue(true);
      mockDatabase.communityBan.findUnique.mockResolvedValue(null);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);
    });

    it('should ban a user successfully', async () => {
      const mockTx = {
        communityBan: { upsert: jest.fn().mockResolvedValue({}) },
        channelMembership: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        userRoles: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        membership: { delete: jest.fn().mockResolvedValue({}) },
        moderationLog: { create: jest.fn().mockResolvedValue({}) },
      };
      mockDatabase.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );

      await service.banUser(communityId, userId, moderatorId, 'spam');

      expect(mockTx.communityBan.upsert).toHaveBeenCalled();
      expect(mockTx.membership.delete).toHaveBeenCalled();
      expect(mockTx.moderationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: ModerationAction.BAN_USER,
            targetUserId: userId,
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.MODERATION_USER_BANNED,
        { userId, communityId },
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        RoomName.community(communityId),
        expect.any(String),
        expect.objectContaining({ communityId, userId }),
      );
    });

    it('should throw ForbiddenException when moderator has lower role', async () => {
      rolesService.getUserRolesForCommunity.mockReset();
      rolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole]) as any) // moderator (low)
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole]) as any); // user (high)

      await expect(
        service.banUser(communityId, userId, moderatorId, 'spam'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when user is not a member', async () => {
      membershipService.isMember.mockResolvedValue(false);

      await expect(
        service.banUser(communityId, userId, moderatorId, 'spam'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when user is already banned', async () => {
      mockDatabase.communityBan.findUnique.mockResolvedValue({
        id: 'ban-1',
        active: true,
      } as any);

      await expect(
        service.banUser(communityId, userId, moderatorId, 'spam'),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow temporary bans with expiry date', async () => {
      const expiresAt = new Date(Date.now() + 86400000); // 1 day from now
      const mockTx = {
        communityBan: { upsert: jest.fn().mockResolvedValue({}) },
        channelMembership: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        userRoles: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        membership: { delete: jest.fn().mockResolvedValue({}) },
        moderationLog: { create: jest.fn().mockResolvedValue({}) },
      };
      mockDatabase.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );

      await service.banUser(
        communityId,
        userId,
        moderatorId,
        'temp ban',
        expiresAt,
      );

      expect(mockTx.communityBan.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ expiresAt }),
        }),
      );
    });
  });

  describe('unbanUser', () => {
    it('should unban a user successfully', async () => {
      mockDatabase.communityBan.findUnique.mockResolvedValue({
        id: 'ban-1',
        active: true,
      } as any);
      mockDatabase.communityBan.update.mockResolvedValue({} as any);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);

      await service.unbanUser(communityId, userId, moderatorId, 'appealed');

      expect(mockDatabase.communityBan.update).toHaveBeenCalledWith({
        where: { communityId_userId: { communityId, userId } },
        data: { active: false },
      });
      expect(mockDatabase.moderationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: ModerationAction.UNBAN_USER,
          }),
        }),
      );
    });

    it('should throw NotFoundException when user is not banned', async () => {
      mockDatabase.communityBan.findUnique.mockResolvedValue(null);

      await expect(
        service.unbanUser(communityId, userId, moderatorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when ban is not active', async () => {
      mockDatabase.communityBan.findUnique.mockResolvedValue({
        id: 'ban-1',
        active: false,
      } as any);

      await expect(
        service.unbanUser(communityId, userId, moderatorId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('isUserBanned', () => {
    it('should return false when no ban exists', async () => {
      mockDatabase.communityBan.findUnique.mockResolvedValue(null);

      const result = await service.isUserBanned(communityId, userId);

      expect(result).toBe(false);
    });

    it('should return true for active ban', async () => {
      mockDatabase.communityBan.findUnique.mockResolvedValue({
        id: 'ban-1',
        active: true,
        expiresAt: null,
      } as any);

      const result = await service.isUserBanned(communityId, userId);

      expect(result).toBe(true);
    });

    it('should return false and auto-expire expired ban', async () => {
      const expiredDate = new Date(Date.now() - 86400000); // yesterday
      mockDatabase.communityBan.findUnique.mockResolvedValue({
        id: 'ban-1',
        active: true,
        expiresAt: expiredDate,
      } as any);
      mockDatabase.communityBan.update.mockResolvedValue({} as any);

      const result = await service.isUserBanned(communityId, userId);

      expect(result).toBe(false);
      expect(mockDatabase.communityBan.update).toHaveBeenCalledWith({
        where: { id: 'ban-1' },
        data: { active: false },
      });
    });
  });

  describe('kickUser', () => {
    beforeEach(() => {
      rolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole]) as any)
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole]) as any);
      membershipService.isMember.mockResolvedValue(true);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);
    });

    it('should kick a user successfully', async () => {
      const mockTx = {
        channelMembership: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        userRoles: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        membership: { delete: jest.fn().mockResolvedValue({}) },
        moderationLog: { create: jest.fn().mockResolvedValue({}) },
      };
      mockDatabase.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );

      await service.kickUser(
        communityId,
        userId,
        moderatorId,
        'rule violation',
      );

      expect(mockTx.membership.delete).toHaveBeenCalled();
      expect(mockTx.moderationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: ModerationAction.KICK_USER,
          }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.MODERATION_USER_KICKED,
        { userId, communityId },
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        RoomName.community(communityId),
        expect.any(String),
        expect.objectContaining({ communityId, userId }),
      );
    });

    it('should throw ForbiddenException when moderator has lower role', async () => {
      rolesService.getUserRolesForCommunity.mockReset();
      rolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole]) as any)
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole]) as any);

      await expect(
        service.kickUser(communityId, userId, moderatorId, 'rule violation'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('timeoutUser', () => {
    beforeEach(() => {
      rolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole]) as any)
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole]) as any);
      membershipService.isMember.mockResolvedValue(true);
      mockDatabase.communityTimeout.upsert.mockResolvedValue({} as any);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);
    });

    it('should timeout a user successfully', async () => {
      await service.timeoutUser(
        communityId,
        userId,
        moderatorId,
        600,
        'cool down',
      );

      expect(mockDatabase.communityTimeout.upsert).toHaveBeenCalled();
      expect(mockDatabase.moderationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: ModerationAction.TIMEOUT_USER,
          }),
        }),
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        RoomName.community(communityId),
        expect.any(String),
        expect.objectContaining({ communityId, userId }),
      );
    });

    it('should throw ForbiddenException when moderator has lower role', async () => {
      rolesService.getUserRolesForCommunity.mockReset();
      rolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole]) as any)
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole]) as any);

      await expect(
        service.timeoutUser(communityId, userId, moderatorId, 600),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeTimeout', () => {
    it('should remove timeout successfully', async () => {
      mockDatabase.communityTimeout.findUnique.mockResolvedValue({
        id: 'timeout-1',
      } as any);
      mockDatabase.communityTimeout.delete.mockResolvedValue({} as any);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);

      await service.removeTimeout(communityId, userId, moderatorId);

      expect(mockDatabase.communityTimeout.delete).toHaveBeenCalled();
      expect(mockDatabase.moderationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: ModerationAction.REMOVE_TIMEOUT,
          }),
        }),
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        RoomName.community(communityId),
        expect.any(String),
        expect.objectContaining({ communityId, userId }),
      );
    });

    it('should throw NotFoundException when timeout does not exist', async () => {
      mockDatabase.communityTimeout.findUnique.mockResolvedValue(null);

      await expect(
        service.removeTimeout(communityId, userId, moderatorId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('isUserTimedOut', () => {
    it('should return false when no timeout exists', async () => {
      mockDatabase.communityTimeout.findUnique.mockResolvedValue(null);

      const result = await service.isUserTimedOut(communityId, userId);

      expect(result).toEqual({ isTimedOut: false });
    });

    it('should return true with expiresAt for active timeout', async () => {
      const expiresAt = new Date(Date.now() + 600000); // 10 minutes from now
      mockDatabase.communityTimeout.findUnique.mockResolvedValue({
        id: 'timeout-1',
        expiresAt,
      } as any);

      const result = await service.isUserTimedOut(communityId, userId);

      expect(result).toEqual({ isTimedOut: true, expiresAt });
    });

    it('should auto-clean expired timeout and return false', async () => {
      const expiredDate = new Date(Date.now() - 60000); // 1 minute ago
      mockDatabase.communityTimeout.findUnique.mockResolvedValue({
        id: 'timeout-1',
        expiresAt: expiredDate,
      } as any);
      mockDatabase.communityTimeout.delete.mockResolvedValue({} as any);

      const result = await service.isUserTimedOut(communityId, userId);

      expect(result).toEqual({ isTimedOut: false });
      expect(mockDatabase.communityTimeout.delete).toHaveBeenCalledWith({
        where: { id: 'timeout-1' },
      });
    });
  });

  describe('pinMessage', () => {
    it('should pin a message successfully', async () => {
      const channel = ChannelFactory.build({ communityId });
      const message = MessageFactory.build({
        channelId: channel.id,
        pinned: false,
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel,
      } as any);
      mockDatabase.message.update.mockResolvedValue({} as any);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);

      await service.pinMessage(message.id, moderatorId);

      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: message.id },
        data: expect.objectContaining({
          pinned: true,
          pinnedBy: moderatorId,
        }),
      });
      expect(websocketService.sendToRoom).toHaveBeenCalled();
    });

    it('should throw NotFoundException when message not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(service.pinMessage(messageId, moderatorId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for direct messages', async () => {
      const message = MessageFactory.build({
        channelId: null,
        directMessageGroupId: 'dm-123',
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel: null,
      } as any);

      await expect(service.pinMessage(message.id, moderatorId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ConflictException when message is already pinned', async () => {
      const channel = ChannelFactory.build({ communityId });
      const message = MessageFactory.build({
        channelId: channel.id,
        pinned: true,
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel,
      } as any);

      await expect(service.pinMessage(message.id, moderatorId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('unpinMessage', () => {
    it('should unpin a message successfully', async () => {
      const channel = ChannelFactory.build({ communityId });
      const message = MessageFactory.build({
        channelId: channel.id,
        pinned: true,
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel,
      } as any);
      mockDatabase.message.update.mockResolvedValue({} as any);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);

      await service.unpinMessage(message.id, moderatorId);

      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: message.id },
        data: expect.objectContaining({
          pinned: false,
          pinnedAt: null,
          pinnedBy: null,
        }),
      });
      expect(websocketService.sendToRoom).toHaveBeenCalled();
    });

    it('should throw ConflictException when message is not pinned', async () => {
      const channel = ChannelFactory.build({ communityId });
      const message = MessageFactory.build({
        channelId: channel.id,
        pinned: false,
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel,
      } as any);

      await expect(
        service.unpinMessage(message.id, moderatorId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteMessageAsMod', () => {
    it('should soft delete a message successfully', async () => {
      const channel = ChannelFactory.build({ communityId });
      const message = MessageFactory.build({
        channelId: channel.id,
        deletedAt: null,
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel,
      } as any);
      mockDatabase.message.update.mockResolvedValue({} as any);
      mockDatabase.moderationLog.create.mockResolvedValue({} as any);

      await service.deleteMessageAsMod(
        message.id,
        moderatorId,
        'inappropriate',
      );

      expect(mockDatabase.message.update).toHaveBeenCalledWith({
        where: { id: message.id },
        data: expect.objectContaining({
          deletedBy: moderatorId,
          deletedByReason: 'inappropriate',
        }),
      });
    });

    it('should throw NotFoundException when message not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMessageAsMod(messageId, moderatorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for direct messages', async () => {
      const message = MessageFactory.build({
        channelId: null,
        directMessageGroupId: 'dm-123',
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel: null,
      } as any);

      await expect(
        service.deleteMessageAsMod(message.id, moderatorId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when message is already deleted', async () => {
      const channel = ChannelFactory.build({ communityId });
      const message = MessageFactory.build({
        channelId: channel.id,
        deletedAt: new Date(),
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel,
      } as any);

      await expect(
        service.deleteMessageAsMod(message.id, moderatorId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getModerationLogs', () => {
    it('should return logs with total count', async () => {
      const logs = [
        { id: 'log-1', action: ModerationAction.BAN_USER, moderatorId: 'mod-1', targetUserId: null },
        { id: 'log-2', action: ModerationAction.KICK_USER, moderatorId: 'mod-1', targetUserId: null },
      ];
      mockDatabase.moderationLog.findMany.mockResolvedValue(logs as any);
      mockDatabase.moderationLog.count.mockResolvedValue(2);

      const result = await service.getModerationLogs(communityId);

      expect(result.total).toBe(2);
      expect(result.logs).toHaveLength(2);
      expect(result.logs[0]).toMatchObject({ id: 'log-1' });
      expect(result.logs[1]).toMatchObject({ id: 'log-2' });
    });

    it('should support filtering by action', async () => {
      mockDatabase.moderationLog.findMany.mockResolvedValue([]);
      mockDatabase.moderationLog.count.mockResolvedValue(0);

      await service.getModerationLogs(communityId, {
        action: ModerationAction.BAN_USER,
      });

      expect(mockDatabase.moderationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { communityId, action: ModerationAction.BAN_USER },
        }),
      );
    });

    it('should support pagination', async () => {
      mockDatabase.moderationLog.findMany.mockResolvedValue([]);
      mockDatabase.moderationLog.count.mockResolvedValue(0);

      await service.getModerationLogs(communityId, { limit: 10, offset: 20 });

      expect(mockDatabase.moderationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });
  });

  describe('getCommunityIdFromChannel', () => {
    it('should return community ID for valid channel', async () => {
      const channel = ChannelFactory.build({ communityId });
      mockDatabase.channel.findUnique.mockResolvedValue(channel as any);

      const result = await service.getCommunityIdFromChannel(channelId);

      expect(result).toBe(communityId);
    });

    it('should throw NotFoundException when channel not found', async () => {
      mockDatabase.channel.findUnique.mockResolvedValue(null);

      await expect(
        service.getCommunityIdFromChannel(channelId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCommunityIdFromMessage', () => {
    it('should return community ID for valid message', async () => {
      const channel = ChannelFactory.build({ communityId });
      const message = MessageFactory.build({ channelId: channel.id });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel,
      } as any);

      const result = await service.getCommunityIdFromMessage(messageId);

      expect(result).toBe(communityId);
    });

    it('should throw NotFoundException when message not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(
        service.getCommunityIdFromMessage(messageId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for direct messages', async () => {
      const message = MessageFactory.build({
        channelId: null,
        directMessageGroupId: 'dm-123',
      });
      mockDatabase.message.findUnique.mockResolvedValue({
        ...message,
        channel: null,
      } as any);

      await expect(
        service.getCommunityIdFromMessage(message.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBanList', () => {
    it('should return active bans', async () => {
      const bans = [
        { id: 'ban-1', active: true, expiresAt: null },
        {
          id: 'ban-2',
          active: true,
          expiresAt: new Date(Date.now() + 86400000),
        },
      ];
      mockDatabase.communityBan.findMany.mockResolvedValue(bans as any);

      const result = await service.getBanList(communityId);

      expect(result).toHaveLength(2);
    });

    it('should auto-expire and filter out expired bans', async () => {
      const expiredDate = new Date(Date.now() - 86400000);
      const bans = [
        { id: 'ban-1', active: true, expiresAt: null },
        { id: 'ban-2', active: true, expiresAt: expiredDate },
      ];
      mockDatabase.communityBan.findMany.mockResolvedValue(bans as any);
      mockDatabase.communityBan.update.mockResolvedValue({} as any);

      const result = await service.getBanList(communityId);

      expect(result).toHaveLength(1);
      expect(mockDatabase.communityBan.update).toHaveBeenCalledWith({
        where: { id: 'ban-2' },
        data: { active: false },
      });
    });
  });

  describe('getTimeoutList', () => {
    it('should return active timeouts', async () => {
      const futureDate = new Date(Date.now() + 600000);
      const timeouts = [
        { id: 'timeout-1', expiresAt: futureDate },
        { id: 'timeout-2', expiresAt: futureDate },
      ];
      mockDatabase.communityTimeout.findMany.mockResolvedValue(timeouts as any);

      const result = await service.getTimeoutList(communityId);

      expect(result).toHaveLength(2);
    });

    it('should auto-clean and filter out expired timeouts', async () => {
      const expiredDate = new Date(Date.now() - 60000);
      const futureDate = new Date(Date.now() + 600000);
      const timeouts = [
        { id: 'timeout-1', expiresAt: futureDate },
        { id: 'timeout-2', expiresAt: expiredDate },
      ];
      mockDatabase.communityTimeout.findMany.mockResolvedValue(timeouts as any);
      mockDatabase.communityTimeout.delete.mockResolvedValue({} as any);

      const result = await service.getTimeoutList(communityId);

      expect(result).toHaveLength(1);
      expect(mockDatabase.communityTimeout.delete).toHaveBeenCalledWith({
        where: { id: 'timeout-2' },
      });
    });
  });

  describe('getPinnedMessages', () => {
    it('should return pinned messages for channel with authors', async () => {
      const messages = [
        {
          id: 'msg-1',
          authorId: 'user-1',
          pinned: true,
          deletedAt: null,
          attachments: [],
        },
        {
          id: 'msg-2',
          authorId: 'user-2',
          pinned: true,
          deletedAt: null,
          attachments: [],
        },
      ];
      const authors = [
        {
          id: 'user-1',
          username: 'user1',
          displayName: 'User 1',
          avatarUrl: null,
        },
        {
          id: 'user-2',
          username: 'user2',
          displayName: 'User 2',
          avatarUrl: null,
        },
      ];
      mockDatabase.message.findMany.mockResolvedValue(messages as any);
      mockDatabase.user.findMany.mockResolvedValue(authors as any);

      const result = await service.getPinnedMessages(channelId);

      expect(result).toHaveLength(2);
      expect(result[0].author).toEqual(authors[0]);
      expect(result[1].author).toEqual(authors[1]);
      // Note: deletedAt is filtered in memory, not in query (MongoDB null field issue)
      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: {
          channelId,
          pinned: true,
        },
        orderBy: { pinnedAt: 'desc' },
      });
      expect(mockDatabase.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-1', 'user-2'] } },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      });
    });
  });
});
