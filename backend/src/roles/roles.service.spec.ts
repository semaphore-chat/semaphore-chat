import { TestBed } from '@suites/unit';
import { RolesService } from './roles.service';
import { DatabaseService } from '@/database/database.service';
import { RbacResourceType } from '@/auth/rbac-resource.decorator';
import { RbacActions } from '@prisma/client';
import {
  createMockDatabase,
  UserFactory,
  RoleFactory,
  ChannelFactory,
  MessageFactory,
  CommunityFactory,
} from '@/test-utils';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

describe('RolesService', () => {
  let service: RolesService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit } = await TestBed.solitary(RolesService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyActionsForUserAndResource', () => {
    describe('Instance-level permissions', () => {
      it('should verify instance-level permissions when no resourceId provided', async () => {
        const user = UserFactory.build();
        const role = RoleFactory.buildAdmin();

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            roleId: role.id,
            isInstanceRole: true,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          undefined,
          undefined,
          [RbacActions.CREATE_COMMUNITY],
        );

        expect(result).toBe(true);
        expect(mockDatabase.userRoles.findMany).toHaveBeenCalledWith({
          where: {
            userId: user.id,
            isInstanceRole: true,
          },
          include: {
            role: true,
          },
        });
      });

      it('should verify instance-level permissions when resourceType is INSTANCE', async () => {
        const user = UserFactory.build();
        const role = RoleFactory.buildAdmin();

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            roleId: role.id,
            isInstanceRole: true,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          'some-id',
          RbacResourceType.INSTANCE,
          [RbacActions.DELETE_USER],
        );

        expect(result).toBe(true);
      });

      it('should deny when user lacks required instance actions', async () => {
        const user = UserFactory.build();
        const role = RoleFactory.buildMember();

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            roleId: role.id,
            isInstanceRole: true,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          undefined,
          undefined,
          [RbacActions.DELETE_USER],
        );

        expect(result).toBe(false);
      });
    });

    describe('Community resource type', () => {
      it('should verify permissions for community resource', async () => {
        const user = UserFactory.build();
        const community = CommunityFactory.build();
        const role = RoleFactory.buildAdmin();

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            communityId: community.id,
            roleId: role.id,
            isInstanceRole: false,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          community.id,
          RbacResourceType.COMMUNITY,
          [RbacActions.DELETE_CHANNEL],
        );

        expect(result).toBe(true);
        expect(mockDatabase.userRoles.findMany).toHaveBeenCalledWith({
          where: {
            userId: user.id,
            communityId: community.id,
            isInstanceRole: false,
          },
          include: {
            role: true,
          },
        });
      });
    });

    describe('Channel resource type', () => {
      it('should verify permissions for public channel by finding community', async () => {
        const user = UserFactory.build();
        const channel = ChannelFactory.build({ isPrivate: false });
        const role = RoleFactory.buildModerator();

        mockDatabase.channel.findUnique.mockResolvedValue({
          id: channel.id,
          communityId: channel.communityId,
          isPrivate: false,
        });

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            communityId: channel.communityId,
            roleId: role.id,
            isInstanceRole: false,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          channel.id,
          RbacResourceType.CHANNEL,
          [RbacActions.DELETE_MESSAGE],
        );

        expect(result).toBe(true);
        expect(mockDatabase.channel.findUnique).toHaveBeenCalledWith({
          where: { id: channel.id },
          select: { communityId: true, isPrivate: true },
        });
      });

      it('should allow access to private channel when user has channel membership', async () => {
        const user = UserFactory.build();
        const channel = ChannelFactory.build({ isPrivate: true });
        const role = RoleFactory.buildMember();

        mockDatabase.channel.findUnique.mockResolvedValue({
          id: channel.id,
          communityId: channel.communityId,
          isPrivate: true,
        });

        mockDatabase.channelMembership.findUnique.mockResolvedValue({
          userId: user.id,
          channelId: channel.id,
        });

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            communityId: channel.communityId,
            roleId: role.id,
            isInstanceRole: false,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          channel.id,
          RbacResourceType.CHANNEL,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(true);
        expect(mockDatabase.channelMembership.findUnique).toHaveBeenCalledWith({
          where: {
            userId_channelId: { userId: user.id, channelId: channel.id },
          },
        });
      });

      it('should deny access to private channel when user lacks channel membership', async () => {
        const user = UserFactory.build();
        const channel = ChannelFactory.build({ isPrivate: true });

        mockDatabase.channel.findUnique.mockResolvedValue({
          id: channel.id,
          communityId: channel.communityId,
          isPrivate: true,
        });

        mockDatabase.channelMembership.findUnique.mockResolvedValue(null);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          channel.id,
          RbacResourceType.CHANNEL,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(false);
        expect(mockDatabase.userRoles.findMany).not.toHaveBeenCalled();
      });

      it('should deny when channel not found', async () => {
        const user = UserFactory.build();
        const channelId = 'nonexistent-channel';

        mockDatabase.channel.findUnique.mockResolvedValue(null);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          channelId,
          RbacResourceType.CHANNEL,
          [RbacActions.READ_CHANNEL],
        );

        expect(result).toBe(false);
      });
    });

    describe('Message resource type', () => {
      it('should verify permissions for message in public channel', async () => {
        const user = UserFactory.build();
        const message = MessageFactory.build();
        const channel = ChannelFactory.build({
          id: message.channelId!,
          isPrivate: false,
        });
        const role = RoleFactory.buildMember();

        mockDatabase.message.findUnique.mockResolvedValue({
          id: message.id,
          channelId: channel.id,
          directMessageGroupId: null,
          channel: {
            communityId: channel.communityId,
            isPrivate: false,
          },
        });

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            communityId: channel.communityId,
            roleId: role.id,
            isInstanceRole: false,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          message.id,
          RbacResourceType.MESSAGE,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(true);
      });

      it('should allow access to message in private channel when user has channel membership', async () => {
        const user = UserFactory.build();
        const message = MessageFactory.build();
        const channel = ChannelFactory.build({
          id: message.channelId!,
          isPrivate: true,
        });
        const role = RoleFactory.buildMember();

        mockDatabase.message.findUnique.mockResolvedValue({
          id: message.id,
          channelId: channel.id,
          directMessageGroupId: null,
          channel: {
            communityId: channel.communityId,
            isPrivate: true,
          },
        });

        mockDatabase.channelMembership.findUnique.mockResolvedValue({
          userId: user.id,
          channelId: channel.id,
        });

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            communityId: channel.communityId,
            roleId: role.id,
            isInstanceRole: false,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          message.id,
          RbacResourceType.MESSAGE,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(true);
        expect(mockDatabase.channelMembership.findUnique).toHaveBeenCalledWith({
          where: {
            userId_channelId: { userId: user.id, channelId: channel.id },
          },
        });
      });

      it('should deny access to message in private channel when user lacks channel membership', async () => {
        const user = UserFactory.build();
        const message = MessageFactory.build();
        const channel = ChannelFactory.build({
          id: message.channelId!,
          isPrivate: true,
        });

        mockDatabase.message.findUnique.mockResolvedValue({
          id: message.id,
          channelId: channel.id,
          directMessageGroupId: null,
          channel: {
            communityId: channel.communityId,
            isPrivate: true,
          },
        });

        mockDatabase.channelMembership.findUnique.mockResolvedValue(null);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          message.id,
          RbacResourceType.MESSAGE,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(false);
        expect(mockDatabase.userRoles.findMany).not.toHaveBeenCalled();
      });

      it('should grant access to DM message when user is member', async () => {
        const user = UserFactory.build();
        const dmMessage = MessageFactory.buildDirectMessage();

        mockDatabase.message.findUnique.mockResolvedValue({
          id: dmMessage.id,
          channelId: null,
          directMessageGroupId: dmMessage.directMessageGroupId,
          channel: null,
        });

        mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
          userId: user.id,
          groupId: dmMessage.directMessageGroupId,
        });

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          dmMessage.id,
          RbacResourceType.MESSAGE,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(true);
        expect(
          mockDatabase.directMessageGroupMember.findFirst,
        ).toHaveBeenCalledWith({
          where: {
            userId: user.id,
            groupId: dmMessage.directMessageGroupId,
          },
        });
      });

      it('should deny access to DM message when user is not member', async () => {
        const user = UserFactory.build();
        const dmMessage = MessageFactory.buildDirectMessage();

        mockDatabase.message.findUnique.mockResolvedValue({
          id: dmMessage.id,
          channelId: null,
          directMessageGroupId: dmMessage.directMessageGroupId,
          channel: null,
        });

        mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue(null);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          dmMessage.id,
          RbacResourceType.MESSAGE,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(false);
      });

      it('should deny when message not found', async () => {
        mockDatabase.message.findUnique.mockResolvedValue(null);

        const result = await service.verifyActionsForUserAndResource(
          'user-id',
          'nonexistent-message',
          RbacResourceType.MESSAGE,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(false);
      });

      it('should deny when message has no associated channel', async () => {
        mockDatabase.message.findUnique.mockResolvedValue({
          id: 'msg-id',
          channelId: 'ch-id',
          directMessageGroupId: null,
          channel: null,
        });

        const result = await service.verifyActionsForUserAndResource(
          'user-id',
          'msg-id',
          RbacResourceType.MESSAGE,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(false);
      });
    });

    describe('DM_GROUP resource type', () => {
      it('should grant access when user is member of DM group', async () => {
        const user = UserFactory.build();
        const groupId = 'dm-group-123';

        mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
          userId: user.id,
          groupId,
        });

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          groupId,
          RbacResourceType.DM_GROUP,
          [RbacActions.CREATE_MESSAGE],
        );

        expect(result).toBe(true);
      });

      it('should deny access when user is not member of DM group', async () => {
        const user = UserFactory.build();
        const groupId = 'dm-group-123';

        mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue(null);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          groupId,
          RbacResourceType.DM_GROUP,
          [RbacActions.CREATE_MESSAGE],
        );

        expect(result).toBe(false);
      });
    });

    describe('Unknown resource type', () => {
      it('should deny access for unknown resource type', async () => {
        const result = await service.verifyActionsForUserAndResource(
          'user-id',
          'resource-id',

          'UNKNOWN' as any,
          [RbacActions.READ_MESSAGE],
        );

        expect(result).toBe(false);
      });
    });

    describe('Multiple actions verification', () => {
      it('should verify all actions are present', async () => {
        const user = UserFactory.build();
        const community = CommunityFactory.build();
        const role = RoleFactory.buildAdmin();

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            communityId: community.id,
            roleId: role.id,
            isInstanceRole: false,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          community.id,
          RbacResourceType.COMMUNITY,
          [
            RbacActions.CREATE_MESSAGE,
            RbacActions.DELETE_MESSAGE,
            RbacActions.READ_CHANNEL,
          ],
        );

        expect(result).toBe(true);
      });

      it('should deny when one action is missing', async () => {
        const user = UserFactory.build();
        const community = CommunityFactory.build();
        const role = RoleFactory.buildMember();

        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId: user.id,
            communityId: community.id,
            roleId: role.id,
            isInstanceRole: false,
            role,
          },
        ]);

        const result = await service.verifyActionsForUserAndResource(
          user.id,
          community.id,
          RbacResourceType.COMMUNITY,
          [RbacActions.CREATE_MESSAGE, RbacActions.DELETE_COMMUNITY],
        );

        expect(result).toBe(false);
      });
    });
  });

  describe('getUserRolesForCommunity', () => {
    it('should return user roles for community', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const role = RoleFactory.buildMember();

      mockDatabase.userRoles.findMany.mockResolvedValue([
        {
          userId: user.id,
          communityId: community.id,
          roleId: role.id,
          isInstanceRole: false,
          role,
        },
      ]);

      const result = await service.getUserRolesForCommunity(
        user.id,
        community.id,
      );

      expect(result).toEqual({
        userId: user.id,
        resourceId: community.id,
        resourceType: 'COMMUNITY',
        roles: [
          {
            id: role.id,
            name: role.name,
            actions: role.actions,
            createdAt: role.createdAt,
            isDefault: role.isDefault,
          },
        ],
      });
    });
  });

  describe('getUserRolesForChannel', () => {
    it('should return user roles for channel via community', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build();
      const role = RoleFactory.buildModerator();

      mockDatabase.channel.findUnique.mockResolvedValue({
        id: channel.id,
        communityId: channel.communityId,
      });

      mockDatabase.userRoles.findMany.mockResolvedValue([
        {
          userId: user.id,
          communityId: channel.communityId,
          roleId: role.id,
          isInstanceRole: false,
          role,
        },
      ]);

      const result = await service.getUserRolesForChannel(user.id, channel.id);

      expect(result.roles).toHaveLength(1);
      expect(result.resourceType).toBe('CHANNEL');
    });

    it('should return empty roles when channel not found', async () => {
      mockDatabase.channel.findUnique.mockResolvedValue(null);

      const result = await service.getUserRolesForChannel(
        'user-id',
        'channel-id',
      );

      expect(result.roles).toEqual([]);
    });
  });

  describe('getUserInstanceRoles', () => {
    it('should return instance roles for user', async () => {
      const user = UserFactory.build();
      const role = RoleFactory.buildAdmin();

      mockDatabase.userRoles.findMany.mockResolvedValue([
        {
          userId: user.id,
          roleId: role.id,
          isInstanceRole: true,
          role,
        },
      ]);

      const result = await service.getUserInstanceRoles(user.id);

      expect(result.resourceType).toBe('INSTANCE');
      expect(result.resourceId).toBeNull();
      expect(result.roles).toHaveLength(1);
    });
  });

  describe('createDefaultCommunityRoles', () => {
    it('should create default roles and return admin role ID', async () => {
      const communityId = 'community-123';
      const adminRole = RoleFactory.build({
        name: 'Community Admin',
        communityId,
        isDefault: true,
      });

      mockDatabase.role.create
        .mockResolvedValueOnce(adminRole)
        .mockResolvedValueOnce(RoleFactory.build())
        .mockResolvedValueOnce(RoleFactory.build());

      const adminRoleId =
        await service.createDefaultCommunityRoles(communityId);

      expect(adminRoleId).toBe(adminRole.id);
      expect(mockDatabase.role.create).toHaveBeenCalledTimes(3);
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Community Admin',
          communityId,
          isDefault: true,
        }),
      });
    });

    it('should use transaction when provided', async () => {
      const mockTx = createMockDatabase();
      const communityId = 'community-123';

      mockTx.role.create.mockResolvedValue(RoleFactory.build());

      await service.createDefaultCommunityRoles(communityId, mockTx as any);

      expect(mockTx.role.create).toHaveBeenCalled();
      expect(mockDatabase.role.create).not.toHaveBeenCalled();
    });
  });

  describe('assignUserToCommunityRole', () => {
    it('should assign user to community role', async () => {
      const userId = 'user-123';
      const communityId = 'community-123';
      const roleId = 'role-123';

      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToCommunityRole(userId, communityId, roleId);

      expect(mockDatabase.userRoles.create).toHaveBeenCalledWith({
        data: {
          userId,
          communityId,
          roleId,
          isInstanceRole: false,
        },
      });
    });
  });

  describe('getCommunityAdminRole', () => {
    it('should return admin role for community', async () => {
      const communityId = 'community-123';
      const adminRole = RoleFactory.buildAdmin({
        name: 'Community Admin',
        communityId,
        isDefault: true,
      });

      mockDatabase.role.findFirst.mockResolvedValue(adminRole);

      const result = await service.getCommunityAdminRole(communityId);

      expect(result).toBeTruthy();
      expect(result?.name).toBe('Community Admin');
      expect(result?.isDefault).toBe(true);
      expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'Community Admin', communityId },
      });
    });

    it('should return null when admin role not found', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(null);

      const result = await service.getCommunityAdminRole('community-123');

      expect(result).toBeNull();
    });
  });

  describe('createCommunityRole', () => {
    it('should create custom community role', async () => {
      const communityId = 'community-123';
      const createRoleDto = {
        name: 'Custom Role',
        actions: [RbacActions.CREATE_MESSAGE, RbacActions.READ_MESSAGE],
      };
      const createdRole = RoleFactory.build({
        name: 'Custom Role',
        communityId,
        isDefault: false,
        actions: createRoleDto.actions,
      });

      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(createdRole);

      const result = await service.createCommunityRole(
        communityId,
        createRoleDto,
      );

      expect(result.name).toBe('Custom Role');
      expect(result.actions).toEqual(createRoleDto.actions);
      expect(result.isDefault).toBe(false);
      expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'Custom Role', communityId },
      });
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: {
          name: 'Custom Role',
          communityId,
          isDefault: false,
          actions: createRoleDto.actions,
        },
      });
    });

    it('should throw ConflictException when role name already exists', async () => {
      const communityId = 'community-123';
      const createRoleDto = {
        name: 'Existing Role',
        actions: [RbacActions.CREATE_MESSAGE],
      };

      mockDatabase.role.findFirst.mockResolvedValue(
        RoleFactory.build({ communityId }),
      );

      await expect(
        service.createCommunityRole(communityId, createRoleDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for invalid actions', async () => {
      const communityId = 'community-123';
      const createRoleDto = {
        name: 'Invalid Role',

        actions: ['INVALID_ACTION' as any],
      };

      mockDatabase.role.findFirst.mockResolvedValue(null);

      await expect(
        service.createCommunityRole(communityId, createRoleDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateRole', () => {
    it('should update role actions', async () => {
      const roleId = 'role-123';
      const communityId = 'community-123';
      const existingRole = RoleFactory.build({
        id: roleId,
        name: 'Custom Role',
        communityId,
        isDefault: false,
      });
      const updateDto = {
        actions: [RbacActions.READ_MESSAGE, RbacActions.CREATE_MESSAGE],
      };
      const updatedRole = { ...existingRole, actions: updateDto.actions };

      mockDatabase.role.findUnique.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue(updatedRole);

      const result = await service.updateRole(roleId, communityId, updateDto);

      expect(result.actions).toEqual(updateDto.actions);
      expect(result.isDefault).toBe(false);
    });

    it('should throw NotFoundException when role not found', async () => {
      mockDatabase.role.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole('nonexistent', 'community-123', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when role belongs to different community', async () => {
      const existingRole = RoleFactory.build({
        name: 'Custom Role',
        communityId: 'other-community',
        isDefault: false,
      });

      mockDatabase.role.findUnique.mockResolvedValue(existingRole);

      await expect(
        service.updateRole(existingRole.id, 'community-123', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should prevent renaming default roles', async () => {
      const communityId = 'community-123';
      const existingRole = RoleFactory.build({
        name: 'Community Admin',
        communityId,
        isDefault: true,
      });

      mockDatabase.role.findUnique.mockResolvedValue(existingRole);

      await expect(
        service.updateRole(existingRole.id, communityId, {
          name: 'New Name',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow changing permissions of default roles', async () => {
      const communityId = 'community-123';
      const existingRole = RoleFactory.build({
        name: 'Member',
        communityId,
        isDefault: true,
      });
      const updateDto = { actions: [RbacActions.READ_MESSAGE] };

      mockDatabase.role.findUnique.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue({
        ...existingRole,
        actions: updateDto.actions,
      });

      const result = await service.updateRole(
        existingRole.id,
        communityId,
        updateDto,
      );

      expect(result.actions).toEqual(updateDto.actions);
      expect(result.isDefault).toBe(true);
    });
  });

  describe('deleteRole', () => {
    it('should delete custom role', async () => {
      const roleId = 'role-123';
      const communityId = 'community-123';
      const customRole = RoleFactory.build({
        id: roleId,
        name: 'Custom Role',
        communityId,
        isDefault: false,
      });

      mockDatabase.role.findUnique.mockResolvedValue({
        ...customRole,
        UserRoles: [],
      });
      mockDatabase.role.delete.mockResolvedValue(customRole);

      await service.deleteRole(roleId, communityId);

      expect(mockDatabase.role.delete).toHaveBeenCalledWith({
        where: { id: roleId },
      });
    });

    it('should throw NotFoundException when role not found', async () => {
      mockDatabase.role.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteRole('nonexistent', 'community-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when role belongs to different community', async () => {
      const customRole = RoleFactory.build({
        name: 'Custom Role',
        communityId: 'other-community',
        isDefault: false,
      });

      mockDatabase.role.findUnique.mockResolvedValue({
        ...customRole,
        UserRoles: [],
      });

      await expect(
        service.deleteRole(customRole.id, 'community-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for default roles', async () => {
      const communityId = 'community-123';
      const defaultRole = RoleFactory.build({
        name: 'Community Admin',
        communityId,
        isDefault: true,
      });

      mockDatabase.role.findUnique.mockResolvedValue({
        ...defaultRole,
        UserRoles: [],
      });

      await expect(
        service.deleteRole(defaultRole.id, communityId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when role is assigned to users', async () => {
      const communityId = 'community-123';
      const role = RoleFactory.build({
        name: 'Custom Role',
        communityId,
        isDefault: false,
      });

      mockDatabase.role.findUnique.mockResolvedValue({
        ...role,
        UserRoles: [{ id: 'user-role-1' }, { id: 'user-role-2' }],
      });

      await expect(service.deleteRole(role.id, communityId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('removeUserFromCommunityRole', () => {
    it('should remove user from community role', async () => {
      const userId = 'user-123';
      const communityId = 'community-123';
      const roleId = 'role-123';
      const userRole = { id: 'user-role-1', userId, communityId, roleId };

      mockDatabase.userRoles.findFirst.mockResolvedValue(userRole);
      mockDatabase.userRoles.delete.mockResolvedValue(userRole);

      await service.removeUserFromCommunityRole(userId, communityId, roleId);

      expect(mockDatabase.userRoles.delete).toHaveBeenCalledWith({
        where: { id: userRole.id },
      });
    });

    it('should throw NotFoundException when assignment not found', async () => {
      mockDatabase.userRoles.findFirst.mockResolvedValue(null);

      await expect(
        service.removeUserFromCommunityRole(
          'user-id',
          'community-id',
          'role-id',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUsersForRole', () => {
    it('should return users assigned to role', async () => {
      const roleId = 'role-123';
      const communityId = 'community-123';
      const users = [
        UserFactory.build({ username: 'user1' }),
        UserFactory.build({ username: 'user2' }),
      ];

      mockDatabase.userRoles.findMany.mockResolvedValue([
        { userId: users[0].id, user: users[0] },
        { userId: users[1].id, user: users[1] },
      ]);

      const result = await service.getUsersForRole(roleId, communityId);

      expect(result).toHaveLength(2);
      expect(result[0].username).toBe('user1');
      expect(result[1].username).toBe('user2');
    });
  });

  describe('getCommunityModeratorRole', () => {
    it('should return moderator role for community', async () => {
      const communityId = 'community-123';
      const modRole = RoleFactory.build({
        name: 'Moderator',
        communityId,
        isDefault: true,
        actions: [RbacActions.CREATE_MESSAGE, RbacActions.DELETE_MESSAGE],
      });

      mockDatabase.role.findFirst.mockResolvedValue(modRole);

      const result = await service.getCommunityModeratorRole(communityId);

      expect(result).toBeDefined();
      expect(result?.name).toBe('Moderator');
      expect(result?.isDefault).toBe(true);
      expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'Moderator', communityId },
      });
    });

    it('should return null when moderator role not found', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(null);

      const result = await service.getCommunityModeratorRole('community-456');

      expect(result).toBeNull();
    });
  });

  describe('getCommunityMemberRole', () => {
    it('should return member role for community', async () => {
      const communityId = 'community-789';
      const memberRole = RoleFactory.build({
        name: 'Member',
        communityId,
        isDefault: true,
        actions: [RbacActions.READ_MESSAGE],
      });

      mockDatabase.role.findFirst.mockResolvedValue(memberRole);

      const result = await service.getCommunityMemberRole(communityId);

      expect(result).toBeDefined();
      expect(result?.name).toBe('Member');
      expect(result?.isDefault).toBe(true);
      expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'Member', communityId },
      });
    });

    it('should return null when member role not found', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(null);

      const result = await service.getCommunityMemberRole('community-999');

      expect(result).toBeNull();
    });
  });

  describe('createMemberRoleForCommunity', () => {
    it('should create member role for community', async () => {
      const communityId = 'community-abc';
      const createdRole = RoleFactory.build({
        id: 'role-member-123',
        name: 'Member',
        communityId,
        isDefault: true,
      });

      mockDatabase.role.create.mockResolvedValue(createdRole);

      const result = await service.createMemberRoleForCommunity(communityId);

      expect(result).toBe('role-member-123');
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Member',
          communityId,
          isDefault: true,
        }),
      });
    });

    it('should use transaction when provided', async () => {
      const communityId = 'community-tx';
      const mockTx = {
        role: {
          create: jest
            .fn()
            .mockResolvedValue(RoleFactory.build({ id: 'tx-role' })),
        },
      } as any;

      const result = await service.createMemberRoleForCommunity(
        communityId,
        mockTx,
      );

      expect(result).toBe('tx-role');
      expect(mockTx.role.create).toHaveBeenCalled();
      expect(mockDatabase.role.create).not.toHaveBeenCalled();
    });
  });

  describe('getCommunityRoles', () => {
    it('should return all roles for community', async () => {
      const communityId = 'community-123';
      const roles = [
        RoleFactory.build({
          name: 'Community Admin',
          communityId,
          isDefault: true,
        }),
        RoleFactory.build({
          name: 'Moderator',
          communityId,
          isDefault: true,
        }),
        RoleFactory.build({
          name: 'Member',
          communityId,
          isDefault: true,
        }),
      ];

      mockDatabase.role.findMany.mockResolvedValue(roles);

      const result = await service.getCommunityRoles(communityId);

      expect(result.communityId).toBe(communityId);
      expect(result.roles).toHaveLength(3);
      expect(result.roles[0].name).toBe('Community Admin');
      expect(result.roles[1].name).toBe('Moderator');
      expect(result.roles[2].name).toBe('Member');
      expect(result.roles[0].isDefault).toBe(true);
      expect(mockDatabase.role.findMany).toHaveBeenCalledWith({
        where: { communityId },
        orderBy: {
          createdAt: 'asc',
        },
      });
    });

    it('should return empty roles list when no roles found', async () => {
      const communityId = 'empty-community';

      mockDatabase.role.findMany.mockResolvedValue([]);

      const result = await service.getCommunityRoles(communityId);

      expect(result.communityId).toBe(communityId);
      expect(result.roles).toHaveLength(0);
    });
  });

  describe('resetDefaultCommunityRoles', () => {
    it('should find and update/create all three default roles and return community roles', async () => {
      const communityId = 'community-123';
      const existingRole = RoleFactory.build({
        id: 'existing-id',
        communityId,
      });
      const roles = [
        RoleFactory.build({
          name: 'Community Admin',
          communityId,
          isDefault: true,
        }),
        RoleFactory.build({ name: 'Moderator', communityId, isDefault: true }),
        RoleFactory.build({ name: 'Member', communityId, isDefault: true }),
      ];

      mockDatabase.$transaction.mockImplementation((fn: any) =>
        fn(mockDatabase),
      );
      mockDatabase.role.findFirst.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue(existingRole);
      mockDatabase.role.findMany.mockResolvedValue(roles);

      const result = await service.resetDefaultCommunityRoles(communityId);

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      expect(mockDatabase.role.findFirst).toHaveBeenCalledTimes(3);
      expect(result.communityId).toBe(communityId);
      expect(result.roles).toHaveLength(3);
    });

    it('should use findFirst + update for existing roles, create for missing ones', async () => {
      const communityId = 'community-456';
      const existingAdmin = RoleFactory.build({
        id: 'admin-role-id',
        name: 'Community Admin',
        communityId,
      });

      mockDatabase.$transaction.mockImplementation((fn: any) =>
        fn(mockDatabase),
      );
      // First call (Community Admin) finds existing, rest return null
      mockDatabase.role.findFirst
        .mockResolvedValueOnce(existingAdmin)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockDatabase.role.update.mockResolvedValue(existingAdmin);
      mockDatabase.role.create.mockResolvedValue(RoleFactory.build());
      mockDatabase.role.findMany.mockResolvedValue([]);

      await service.resetDefaultCommunityRoles(communityId);

      // Existing role gets updated by id
      expect(mockDatabase.role.update).toHaveBeenCalledWith({
        where: { id: 'admin-role-id' },
        data: { actions: expect.any(Array), isDefault: true },
      });

      // Missing roles get created
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: {
          name: 'Moderator',
          communityId,
          isDefault: true,
          actions: expect.any(Array),
        },
      });
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: {
          name: 'Member',
          communityId,
          isDefault: true,
          actions: expect.any(Array),
        },
      });
    });

    it('should reset permissions on existing roles without affecting user assignments', async () => {
      const communityId = 'community-789';
      const existingRole = RoleFactory.build({ id: 'role-id', communityId });

      mockDatabase.$transaction.mockImplementation((fn: any) =>
        fn(mockDatabase),
      );
      mockDatabase.role.findFirst.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue(existingRole);
      mockDatabase.role.findMany.mockResolvedValue([]);

      await service.resetDefaultCommunityRoles(communityId);

      // Update only touches actions and isDefault — not UserRoles
      for (const call of mockDatabase.role.update.mock.calls) {
        const args = call[0];
        expect(args.data).toEqual({
          actions: expect.any(Array),
          isDefault: true,
        });
        expect(args.data).not.toHaveProperty('UserRoles');
      }
    });
  });

  describe('Instance Role Management', () => {
    describe('createDefaultInstanceRole', () => {
      it('should create Instance Admin role if not exists', async () => {
        const createdRole = RoleFactory.build({
          id: 'instance-admin-role-id',
          name: 'Instance Admin',
          communityId: null,
          isDefault: true,
        });

        mockDatabase.role.findFirst.mockResolvedValue(null);
        mockDatabase.role.create.mockResolvedValue(createdRole);

        const result = await service.createDefaultInstanceRole();

        expect(result).toBe('instance-admin-role-id');
        expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
          where: { name: 'Instance Admin', communityId: null },
        });
        expect(mockDatabase.role.create).toHaveBeenCalledWith({
          data: {
            name: 'Instance Admin',
            actions: expect.any(Array),
            communityId: null,
            isDefault: true,
          },
        });
      });

      it('should return existing Instance Admin role id if already exists', async () => {
        const existingRole = RoleFactory.build({
          id: 'existing-instance-admin-id',
          name: 'Instance Admin',
        });

        mockDatabase.role.findFirst.mockResolvedValue(existingRole);

        const result = await service.createDefaultInstanceRole();

        expect(result).toBe('existing-instance-admin-id');
        expect(mockDatabase.role.create).not.toHaveBeenCalled();
      });
    });

    describe('getInstanceRoles', () => {
      it('should return all instance-level roles', async () => {
        const instanceRoles = [
          RoleFactory.build({
            name: 'Instance Admin',
            communityId: null,
            isDefault: true,
          }),
          RoleFactory.build({
            name: 'Community Creator',
            communityId: null,
            isDefault: true,
          }),
          RoleFactory.build({
            name: 'User Manager',
            communityId: null,
            isDefault: true,
          }),
          RoleFactory.build({
            name: 'Invite Manager',
            communityId: null,
            isDefault: true,
          }),
        ];

        mockDatabase.role.findMany.mockResolvedValue(instanceRoles);

        const result = await service.getInstanceRoles();

        expect(result).toHaveLength(4);
        expect(result[0].name).toBe('Instance Admin');
        expect(result[0].isDefault).toBe(true);
        expect(mockDatabase.role.findMany).toHaveBeenCalledWith({
          where: {
            communityId: null,
            OR: [
              {
                name: {
                  in: [
                    'Instance Admin',
                    'Community Creator',
                    'User Manager',
                    'Invite Manager',
                  ],
                },
              },
              { UserRoles: { some: { isInstanceRole: true } } },
            ],
          },
          orderBy: { createdAt: 'asc' },
        });
      });
    });

    describe('createInstanceRole', () => {
      it('should create custom instance role with valid actions', async () => {
        const createdRole = RoleFactory.build({
          name: 'Custom Admin',
          communityId: null,
          isDefault: false,
          actions: [RbacActions.READ_USER, RbacActions.UPDATE_USER],
        });

        mockDatabase.role.findFirst.mockResolvedValue(null);
        mockDatabase.role.create.mockResolvedValue(createdRole);

        const result = await service.createInstanceRole('Custom Admin', [
          RbacActions.READ_USER,
          RbacActions.UPDATE_USER,
        ]);

        expect(result.name).toBe('Custom Admin');
        expect(result.isDefault).toBe(false);
        expect(result.actions).toContain(RbacActions.READ_USER);
        expect(mockDatabase.role.create).toHaveBeenCalledWith({
          data: {
            name: 'Custom Admin',
            actions: [RbacActions.READ_USER, RbacActions.UPDATE_USER],
            communityId: null,
            isDefault: false,
          },
        });
      });
    });

    describe('assignUserToInstanceRole', () => {
      it('should assign user to instance role', async () => {
        const userId = 'user-123';
        const roleId = 'role-123';
        const role = RoleFactory.build({ id: roleId });

        mockDatabase.role.findUnique.mockResolvedValue(role);
        mockDatabase.userRoles.findFirst.mockResolvedValue(null);
        mockDatabase.userRoles.create.mockResolvedValue({});

        await service.assignUserToInstanceRole(userId, roleId);

        expect(mockDatabase.userRoles.create).toHaveBeenCalledWith({
          data: {
            userId,
            roleId,
            isInstanceRole: true,
            communityId: null,
          },
        });
      });

      it('should throw NotFoundException when role not found', async () => {
        mockDatabase.role.findUnique.mockResolvedValue(null);

        await expect(
          service.assignUserToInstanceRole('user-id', 'nonexistent-role'),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw ConflictException when user already has role', async () => {
        const roleId = 'role-123';
        mockDatabase.role.findUnique.mockResolvedValue(
          RoleFactory.build({ id: roleId }),
        );
        mockDatabase.userRoles.findFirst.mockResolvedValue({
          id: 'existing-assignment',
        });

        await expect(
          service.assignUserToInstanceRole('user-id', roleId),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('removeUserFromInstanceRole', () => {
      it('should remove user from instance role', async () => {
        const userRole = { id: 'user-role-1' };

        mockDatabase.userRoles.findFirst.mockResolvedValue(userRole);
        mockDatabase.userRoles.delete.mockResolvedValue(userRole);

        await service.removeUserFromInstanceRole('user-id', 'role-id');

        expect(mockDatabase.userRoles.delete).toHaveBeenCalledWith({
          where: { id: userRole.id },
        });
      });

      it('should throw NotFoundException when assignment not found', async () => {
        mockDatabase.userRoles.findFirst.mockResolvedValue(null);

        await expect(
          service.removeUserFromInstanceRole('user-id', 'role-id'),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('updateInstanceRole', () => {
      it('should update instance role actions', async () => {
        const roleId = 'role-123';
        const existingRole = RoleFactory.build({
          id: roleId,
          name: 'Custom Instance Role',
        });
        const updatedRole = {
          ...existingRole,
          actions: [RbacActions.READ_USER],
        };

        mockDatabase.role.findUnique.mockResolvedValue(existingRole);
        mockDatabase.role.update.mockResolvedValue(updatedRole);

        const result = await service.updateInstanceRole(roleId, {
          actions: [RbacActions.READ_USER],
        });

        expect(result.actions).toContain(RbacActions.READ_USER);
      });

      it('should throw NotFoundException when role not found', async () => {
        mockDatabase.role.findUnique.mockResolvedValue(null);

        await expect(
          service.updateInstanceRole('nonexistent', {}),
        ).rejects.toThrow(NotFoundException);
      });

      it('should prevent renaming Instance Admin role', async () => {
        const existingRole = RoleFactory.build({ name: 'Instance Admin' });

        mockDatabase.role.findUnique.mockResolvedValue(existingRole);

        await expect(
          service.updateInstanceRole(existingRole.id, { name: 'New Name' }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('deleteInstanceRole', () => {
      it('should delete custom instance role', async () => {
        const roleId = 'role-123';
        const customRole = RoleFactory.build({
          name: 'Custom Instance Role',
        });

        mockDatabase.role.findUnique.mockResolvedValue({
          ...customRole,
          UserRoles: [],
        });
        mockDatabase.role.delete.mockResolvedValue(customRole);

        await service.deleteInstanceRole(roleId);

        expect(mockDatabase.role.delete).toHaveBeenCalledWith({
          where: { id: roleId },
        });
      });

      it('should throw NotFoundException when role not found', async () => {
        mockDatabase.role.findUnique.mockResolvedValue(null);

        await expect(service.deleteInstanceRole('nonexistent')).rejects.toThrow(
          NotFoundException,
        );
      });

      it('should throw BadRequestException for Instance Admin role', async () => {
        const defaultRole = RoleFactory.build({ name: 'Instance Admin' });

        mockDatabase.role.findUnique.mockResolvedValue({
          ...defaultRole,
          UserRoles: [],
        });

        await expect(
          service.deleteInstanceRole(defaultRole.id),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException when role has assigned users', async () => {
        const role = RoleFactory.build({ name: 'Custom Instance Role' });

        mockDatabase.role.findUnique.mockResolvedValue({
          ...role,
          UserRoles: [{ id: 'user-role-1' }],
        });

        await expect(service.deleteInstanceRole(role.id)).rejects.toThrow(
          BadRequestException,
        );
      });
    });

    describe('getInstanceRoleUsers', () => {
      it('should return users assigned to instance role', async () => {
        const roleId = 'role-123';
        const users = [
          UserFactory.build({ username: 'admin1' }),
          UserFactory.build({ username: 'admin2' }),
        ];

        mockDatabase.userRoles.findMany.mockResolvedValue([
          { userId: users[0].id, user: users[0] },
          { userId: users[1].id, user: users[1] },
        ]);

        const result = await service.getInstanceRoleUsers(roleId);

        expect(result).toHaveLength(2);
        expect(result[0].username).toBe('admin1');
        expect(result[1].username).toBe('admin2');
        expect(mockDatabase.userRoles.findMany).toHaveBeenCalledWith({
          where: { roleId, isInstanceRole: true },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
              },
            },
          },
        });
      });
    });
  });

  describe('Community Creator Role Management', () => {
    describe('createDefaultCommunityCreatorRole', () => {
      it('should create Community Creator role if not exists', async () => {
        const createdRole = RoleFactory.build({
          id: 'community-creator-role-id',
          name: 'Community Creator',
          communityId: null,
          isDefault: true,
        });

        mockDatabase.role.findFirst.mockResolvedValue(null);
        mockDatabase.role.create.mockResolvedValue(createdRole);

        const result = await service.createDefaultCommunityCreatorRole();

        expect(result).toBe('community-creator-role-id');
        expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
          where: { name: 'Community Creator', communityId: null },
        });
        expect(mockDatabase.role.create).toHaveBeenCalledWith({
          data: {
            name: 'Community Creator',
            actions: expect.any(Array),
            communityId: null,
            isDefault: true,
          },
        });
      });

      it('should return existing Community Creator role id if already exists', async () => {
        const existingRole = RoleFactory.build({
          id: 'existing-community-creator-id',
          name: 'Community Creator',
        });

        mockDatabase.role.findFirst.mockResolvedValue(existingRole);

        const result = await service.createDefaultCommunityCreatorRole();

        expect(result).toBe('existing-community-creator-id');
        expect(mockDatabase.role.create).not.toHaveBeenCalled();
      });

      it('should use transaction when provided', async () => {
        const mockTx = createMockDatabase();
        const createdRole = RoleFactory.build({
          id: 'tx-community-creator-id',
          name: 'Community Creator',
        });

        mockTx.role.findFirst.mockResolvedValue(null);
        mockTx.role.create.mockResolvedValue(createdRole);

        const result = await service.createDefaultCommunityCreatorRole(
          mockTx as any,
        );

        expect(result).toBe('tx-community-creator-id');
        expect(mockTx.role.create).toHaveBeenCalled();
        expect(mockDatabase.role.create).not.toHaveBeenCalled();
      });
    });

    describe('getCommunityCreatorRole', () => {
      it('should return Community Creator role when it exists', async () => {
        const creatorRole = RoleFactory.build({
          name: 'Community Creator',
          communityId: null,
          isDefault: true,
          actions: [RbacActions.CREATE_COMMUNITY, RbacActions.READ_COMMUNITY],
        });

        mockDatabase.role.findFirst.mockResolvedValue(creatorRole);

        const result = await service.getCommunityCreatorRole();

        expect(result).toBeDefined();
        expect(result?.name).toBe('Community Creator');
        expect(result?.isDefault).toBe(true);
        expect(result?.actions).toContain(RbacActions.CREATE_COMMUNITY);
        expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
          where: { name: 'Community Creator', communityId: null },
        });
      });

      it('should return null when Community Creator role does not exist', async () => {
        mockDatabase.role.findFirst.mockResolvedValue(null);

        const result = await service.getCommunityCreatorRole();

        expect(result).toBeNull();
      });
    });

    describe('getCommunityCreatorActions', () => {
      it('should return Community Creator actions', () => {
        const actions = service.getCommunityCreatorActions();

        expect(actions).toContain(RbacActions.CREATE_COMMUNITY);
        expect(actions).toContain(RbacActions.READ_COMMUNITY);
        expect(actions).toContain(RbacActions.CREATE_CHANNEL);
        expect(actions).toContain(RbacActions.DELETE_CHANNEL);
        expect(actions).toContain(RbacActions.CREATE_MESSAGE);
        expect(actions).toContain(RbacActions.CREATE_ROLE);
        expect(Array.isArray(actions)).toBe(true);
      });
    });
  });

  describe('User Manager Role', () => {
    describe('getUserManagerRole', () => {
      it('should return User Manager role when it exists', async () => {
        const userManagerRole = RoleFactory.build({
          name: 'User Manager',
          communityId: null,
          isDefault: true,
          actions: [RbacActions.READ_USER, RbacActions.UPDATE_USER],
        });

        mockDatabase.role.findFirst.mockResolvedValue(userManagerRole);

        const result = await service.getUserManagerRole();

        expect(result).toBeDefined();
        expect(result?.name).toBe('User Manager');
        expect(result?.isDefault).toBe(true);
        expect(result?.actions).toContain(RbacActions.READ_USER);
        expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
          where: { name: 'User Manager', communityId: null },
        });
      });

      it('should return null when User Manager role does not exist', async () => {
        mockDatabase.role.findFirst.mockResolvedValue(null);

        const result = await service.getUserManagerRole();

        expect(result).toBeNull();
      });
    });
  });

  describe('Invite Manager Role', () => {
    describe('getInviteManagerRole', () => {
      it('should return Invite Manager role when it exists', async () => {
        const inviteManagerRole = RoleFactory.build({
          name: 'Invite Manager',
          communityId: null,
          isDefault: true,
          actions: [
            RbacActions.READ_INSTANCE_INVITE,
            RbacActions.CREATE_INSTANCE_INVITE,
          ],
        });

        mockDatabase.role.findFirst.mockResolvedValue(inviteManagerRole);

        const result = await service.getInviteManagerRole();

        expect(result).toBeDefined();
        expect(result?.name).toBe('Invite Manager');
        expect(result?.isDefault).toBe(true);
        expect(result?.actions).toContain(RbacActions.READ_INSTANCE_INVITE);
        expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
          where: { name: 'Invite Manager', communityId: null },
        });
      });

      it('should return null when Invite Manager role does not exist', async () => {
        mockDatabase.role.findFirst.mockResolvedValue(null);

        const result = await service.getInviteManagerRole();

        expect(result).toBeNull();
      });
    });
  });

  describe('Default Instance Roles Bootstrap', () => {
    describe('ensureDefaultInstanceRolesExist', () => {
      it('should create all missing default instance roles', async () => {
        // All roles are missing
        mockDatabase.role.findFirst.mockResolvedValue(null);
        mockDatabase.role.create.mockResolvedValue(
          RoleFactory.build({ communityId: null, isDefault: true }),
        );

        await service.ensureDefaultInstanceRolesExist();

        // Should have checked for all 4 default instance roles
        expect(mockDatabase.role.findFirst).toHaveBeenCalledTimes(4);
        // Should have created all 4 default instance roles
        expect(mockDatabase.role.create).toHaveBeenCalledTimes(4);
        // Each create should include communityId: null and isDefault: true
        expect(mockDatabase.role.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            communityId: null,
            isDefault: true,
          }),
        });
      });

      it('should skip existing roles and only create missing ones', async () => {
        // First two roles exist, last two don't
        mockDatabase.role.findFirst
          .mockResolvedValueOnce(RoleFactory.build({ name: 'Instance Admin' }))
          .mockResolvedValueOnce(
            RoleFactory.build({ name: 'Community Creator' }),
          )
          .mockResolvedValueOnce(null) // User Manager missing
          .mockResolvedValueOnce(null); // Invite Manager missing

        mockDatabase.role.create.mockResolvedValue(RoleFactory.build());

        await service.ensureDefaultInstanceRolesExist();

        expect(mockDatabase.role.findFirst).toHaveBeenCalledTimes(4);
        // Should only create the 2 missing roles
        expect(mockDatabase.role.create).toHaveBeenCalledTimes(2);
      });

      it('should not create any roles if all exist', async () => {
        // All roles exist
        mockDatabase.role.findFirst.mockResolvedValue(RoleFactory.build());

        await service.ensureDefaultInstanceRolesExist();

        expect(mockDatabase.role.findFirst).toHaveBeenCalledTimes(4);
        expect(mockDatabase.role.create).not.toHaveBeenCalled();
      });
    });

    describe('onModuleInit', () => {
      it('should call ensureDefaultInstanceRolesExist on init', async () => {
        mockDatabase.role.findFirst.mockResolvedValue(RoleFactory.build());

        await service.onModuleInit();

        // Should have checked for default instance roles
        expect(mockDatabase.role.findFirst).toHaveBeenCalled();
      });

      it('should not throw if ensureDefaultInstanceRolesExist fails', async () => {
        mockDatabase.role.findFirst.mockRejectedValue(
          new Error('Database connection failed'),
        );

        // Should not throw
        await expect(service.onModuleInit()).resolves.not.toThrow();
      });
    });
  });
});
