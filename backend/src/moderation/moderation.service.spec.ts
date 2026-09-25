import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModerationService } from './moderation.service';
import { DatabaseService } from '@/database/database.service';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { MembershipService } from '@/membership/membership.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';
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
import { ServerEvents } from '@semaphore-chat/shared';

describe('ModerationService', () => {
  let service: ModerationService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let communityRolesService: Mocked<CommunityRolesService>;
  let membershipService: Mocked<MembershipService>;
  let websocketService: Mocked<WebsocketService>;
  let eventEmitter: Mocked<EventEmitter2>;
  let permissionsCacheService: Mocked<PermissionsCacheService>;

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
    communityRolesService = unitRef.get(CommunityRolesService);
    membershipService = unitRef.get(MembershipService);
    websocketService = unitRef.get(WebsocketService);
    eventEmitter = unitRef.get(EventEmitter2);
    permissionsCacheService = unitRef.get(PermissionsCacheService);

    // Default: user lookups return empty (enrichment queries)
    mockDatabase.user.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Position-based role mocks: lower position = higher rank (Community Admin=10, Moderator=20, Member=100)
  const mockAdminRole = {
    id: '1',
    name: 'Community Admin',
    actions: [] as any[],
    createdAt: new Date(),
    isDefault: true,
    position: 10,
  };
  const mockModeratorRole = {
    id: '2',
    name: 'Moderator',
    actions: [] as any[],
    createdAt: new Date(),
    isDefault: true,
    position: 20,
  };
  const mockMemberRole = {
    id: '3',
    name: 'Member',
    actions: [] as any[],
    createdAt: new Date(),
    isDefault: true,
    position: 100,
  };

  const createMockUserRoles = (roles: (typeof mockAdminRole)[]) => ({
    userId: 'test-user',
    resourceId: communityId,
    resourceType: 'COMMUNITY' as const,
    roles,
  });

  // =========================================
  // POSITION-BASED HIERARCHY TESTS
  // =========================================
  describe('role hierarchy (position-based)', () => {
    const setupBanScaffold = (moderatorRoles: any[], targetRoles: any[]) => {
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles(moderatorRoles))
        .mockResolvedValueOnce(createMockUserRoles(targetRoles));
      membershipService.isMember.mockResolvedValue(true);
      mockDatabase.communityBan.findUnique.mockResolvedValue(null);
      const mockTx = {
        communityBan: { upsert: jest.fn().mockResolvedValue({}) },
        channelMembership: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        userRoles: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        membership: { delete: jest.fn().mockResolvedValue({}) },
        moderationLog: { create: jest.fn().mockResolvedValue({}) },
      };
      mockDatabase.$transaction.mockImplementation((callback: any) =>
        callback(mockTx),
      );
    };

    it('user with roles at positions [20, 100] has effective rank 20 (best/lowest wins)', async () => {
      // Moderator has both Moderator (20) and Member (100) roles → effective rank = 20
      // Target has only Member (100) → effective rank = 100
      // 20 < 100 → can moderate → ban succeeds
      setupBanScaffold([mockModeratorRole, mockMemberRole], [mockMemberRole]);

      await expect(
        service.banUser(communityId, userId, moderatorId),
      ).resolves.not.toThrow();
    });

    it('canModerate is true when moderator best position (10) < target best position (20)', async () => {
      // Admin (10) vs Moderator (20) → 10 < 20 → can moderate
      setupBanScaffold([mockAdminRole], [mockModeratorRole]);

      await expect(
        service.banUser(communityId, userId, moderatorId),
      ).resolves.not.toThrow();
    });

    it('canModerate is false when positions are equal (20 vs 20)', async () => {
      // Both have Moderator (20) → equal → strictly-lower required → cannot moderate
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockModeratorRole]))
        .mockResolvedValueOnce(createMockUserRoles([mockModeratorRole]));

      await expect(
        service.banUser(communityId, userId, moderatorId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('user with zero roles can never moderate anyone', async () => {
      // Moderator has no roles → cannot moderate even a Member
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([])) // moderator: no roles
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole])); // target: Member

      await expect(
        service.banUser(communityId, userId, moderatorId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('anyone with a role can moderate a zero-role user', async () => {
      // Moderator has Member role (100) → target has no roles (MAX_SAFE_INTEGER)
      // 100 < MAX_SAFE_INTEGER → can moderate
      setupBanScaffold([mockMemberRole], []);

      await expect(
        service.banUser(communityId, userId, moderatorId),
      ).resolves.not.toThrow();
    });

    it('role named "Janitor" at position 10 outranks "Community Admin" at position 50 — names are irrelevant', async () => {
      // Custom "Janitor" role at position 10 beats "Community Admin" at position 50
      const janitorRole = {
        id: '99',
        name: 'Janitor',
        actions: [] as any[],
        createdAt: new Date(),
        isDefault: false,
        position: 10,
      };
      const renamedAdminRole = {
        id: '1',
        name: 'Community Admin',
        actions: [] as any[],
        createdAt: new Date(),
        isDefault: true,
        position: 50,
      };
      // Moderator has "Janitor" (10), target has "Community Admin" (50) → 10 < 50 → can moderate
      setupBanScaffold([janitorRole], [renamedAdminRole]);

      await expect(
        service.banUser(communityId, userId, moderatorId),
      ).resolves.not.toThrow();
    });

    it('role named "Community Admin" at position 50 cannot moderate "Janitor" at position 10', async () => {
      // Names are irrelevant: if "Community Admin" has position 50, it can't beat position 10
      const janitorRole = {
        id: '99',
        name: 'Janitor',
        actions: [] as any[],
        createdAt: new Date(),
        isDefault: false,
        position: 10,
      };
      const renamedAdminRole = {
        id: '1',
        name: 'Community Admin',
        actions: [] as any[],
        createdAt: new Date(),
        isDefault: true,
        position: 50,
      };
      // Moderator has "Community Admin" (50), target has "Janitor" (10) → 50 > 10 → cannot moderate
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([renamedAdminRole]))
        .mockResolvedValueOnce(createMockUserRoles([janitorRole]));

      await expect(
        service.banUser(communityId, userId, moderatorId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('banUser', () => {
    beforeEach(() => {
      // Setup default mock for role hierarchy (moderator position 10 < target position 100)
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole])) // moderator (position 10)
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole])); // user (position 100)
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
      // removeMemberInternal removes role assignments via a raw
      // tx.userRoles.deleteMany, bypassing CommunityRolesService — banUser must
      // bump the target user's epoch explicitly.
      expect(permissionsCacheService.bumpUserEpoch).toHaveBeenCalledWith(
        userId,
      );
    });

    it('should throw ForbiddenException when moderator has lower rank (higher position number)', async () => {
      communityRolesService.getUserRolesForCommunity.mockReset();
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole])) // moderator (position 100)
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole])); // user (position 10)

      await expect(
        service.banUser(communityId, userId, moderatorId, 'spam'),
      ).rejects.toThrow(ForbiddenException);
      expect(permissionsCacheService.bumpUserEpoch).not.toHaveBeenCalled();
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
      // moderator position 10 < target position 100 → can moderate
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole])) // moderator (position 10)
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole])); // target (position 100)
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
      // removeMemberInternal removes role assignments via a raw
      // tx.userRoles.deleteMany, bypassing CommunityRolesService — kickUser must
      // bump the target user's epoch explicitly.
      expect(permissionsCacheService.bumpUserEpoch).toHaveBeenCalledWith(
        userId,
      );
    });

    it('should throw ForbiddenException when moderator has lower rank (higher position number)', async () => {
      communityRolesService.getUserRolesForCommunity.mockReset();
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole])) // moderator (position 100)
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole])); // target (position 10)

      await expect(
        service.kickUser(communityId, userId, moderatorId, 'rule violation'),
      ).rejects.toThrow(ForbiddenException);
      expect(permissionsCacheService.bumpUserEpoch).not.toHaveBeenCalled();
    });
  });

  describe('timeoutUser', () => {
    beforeEach(() => {
      // moderator position 10 < target position 100 → can moderate
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole])) // moderator (position 10)
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole])); // target (position 100)
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
      // Timeouts don't touch UserRoles/Role and aren't consulted by
      // PermissionsService — no epoch bump is expected.
      expect(permissionsCacheService.bumpUserEpoch).not.toHaveBeenCalled();
      expect(permissionsCacheService.bumpCommunityEpoch).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when moderator has lower rank (higher position number)', async () => {
      communityRolesService.getUserRolesForCommunity.mockReset();
      communityRolesService.getUserRolesForCommunity
        .mockResolvedValueOnce(createMockUserRoles([mockMemberRole])) // moderator (position 100)
        .mockResolvedValueOnce(createMockUserRoles([mockAdminRole])); // target (position 10)

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

    it('should emit DELETE_MESSAGE WebSocket event to the channel room', async () => {
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
        'rule violation',
      );

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        message.channelId,
        ServerEvents.DELETE_MESSAGE,
        {
          messageId: message.id,
          channelId: message.channelId,
          directMessageGroupId: null,
        },
      );
    });
  });

  describe('getModerationLogs', () => {
    it('should return logs with total count', async () => {
      const logs = [
        {
          id: 'log-1',
          action: ModerationAction.BAN_USER,
          moderatorId: 'mod-1',
          targetUserId: null,
        },
        {
          id: 'log-2',
          action: ModerationAction.KICK_USER,
          moderatorId: 'mod-1',
          targetUserId: null,
        },
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
          spans: [],
          reactions: [],
        },
        {
          id: 'msg-2',
          authorId: 'user-2',
          pinned: true,
          deletedAt: null,
          attachments: [],
          spans: [],
          reactions: [],
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
      // Note: deletedAt is filtered in memory after query
      expect(mockDatabase.message.findMany).toHaveBeenCalledWith({
        where: {
          channelId,
          pinned: true,
        },
        orderBy: { pinnedAt: 'asc' },
        include: {
          attachments: {
            include: {
              file: {
                select: {
                  id: true,
                  filename: true,
                  mimeType: true,
                  fileType: true,
                  size: true,
                  thumbnailPath: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          },
          spans: { orderBy: { position: 'asc' } },
          reactions: true,
        },
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
