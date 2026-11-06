import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { CommunityRolesService } from './community-roles.service';
import { PermissionsService } from './permissions.service';
import { DatabaseService } from '@/database/database.service';
import {
  PermissionsCacheService,
  type EpochBump,
} from './permissions-cache.service';
import { RbacActions } from '@prisma/client';
import {
  createMockDatabase,
  UserFactory,
  RoleFactory,
  ChannelFactory,
  CommunityFactory,
} from '@/test-utils';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

describe('CommunityRolesService', () => {
  let service: CommunityRolesService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let permissionsCacheService: Mocked<PermissionsCacheService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(CommunityRolesService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    permissionsCacheService = unitRef.get(PermissionsCacheService);
    // Rank is covered end to end in test/role-hierarchy.e2e-spec.ts
    unitRef
      .get(PermissionsService)
      .getRank.mockResolvedValue({ best: 10, isTop: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
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
            position: role.position,
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
      const role = RoleFactory.build({
        id: roleId,
        name: 'Custom Role',
        communityId,
      });

      mockDatabase.role.findUnique.mockResolvedValue(role);
      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToCommunityRole(userId, communityId, roleId);

      expect(mockDatabase.role.findUnique).toHaveBeenCalledWith({
        where: { id: roleId },
      });
      expect(mockDatabase.userRoles.create).toHaveBeenCalledWith({
        data: {
          userId,
          communityId,
          roleId,
          isInstanceRole: false,
        },
      });
    });

    it('should throw NotFoundException when role belongs to a different community', async () => {
      const userId = 'user-123';
      const communityId = 'community-123';
      const roleId = 'role-123';
      const roleFromOtherCommunity = RoleFactory.build({
        id: roleId,
        name: 'Other Role',
        communityId: 'different-community',
      });

      mockDatabase.role.findUnique.mockResolvedValue(roleFromOtherCommunity);

      await expect(
        service.assignUserToCommunityRole(userId, communityId, roleId),
      ).rejects.toThrow(NotFoundException);

      expect(mockDatabase.userRoles.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when role does not exist', async () => {
      mockDatabase.role.findUnique.mockResolvedValue(null);

      await expect(
        service.assignUserToCommunityRole(
          'user-123',
          'community-123',
          'nonexistent-role',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockDatabase.userRoles.create).not.toHaveBeenCalled();
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
    it('should create custom community role with auto-assigned position', async () => {
      const communityId = 'community-123';
      const createRoleDto = {
        name: 'Custom Role',
        actions: [RbacActions.CREATE_MESSAGE, RbacActions.READ_MESSAGE],
      };
      const createdRole = RoleFactory.build({
        name: 'Custom Role',
        communityId,
        isDefault: false,
        position: 21,
        actions: createRoleDto.actions,
      });

      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.aggregate.mockResolvedValue({
        _max: { position: 20 },
      });
      mockDatabase.role.create.mockResolvedValue(createdRole);

      const result = await service.createCommunityRole(
        communityId,
        createRoleDto,
      );

      expect(result.name).toBe('Custom Role');
      expect(result.actions).toEqual(createRoleDto.actions);
      expect(result.isDefault).toBe(false);
      expect(result.position).toBe(21);
      expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
        where: { name: 'Custom Role', communityId },
      });
      expect(mockDatabase.role.aggregate).toHaveBeenCalledWith({
        where: {
          communityId,
          name: { not: 'Member' },
        },
        _max: { position: true },
      });
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: {
          name: 'Custom Role',
          communityId,
          isDefault: false,
          position: 21,
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

    describe('privilege escalation prevention', () => {
      it('should throw ForbiddenException when user tries to grant actions they do not have', async () => {
        const communityId = 'community-123';
        const userId = 'user-123';
        const createRoleDto = {
          name: 'Escalated Role',
          actions: [RbacActions.DELETE_COMMUNITY, RbacActions.CREATE_MESSAGE],
        };

        // No existing role with this name
        mockDatabase.role.findFirst.mockResolvedValue(null);

        // User only has CREATE_MESSAGE, not DELETE_COMMUNITY
        const userRole = RoleFactory.buildMember({
          communityId,
          actions: [RbacActions.CREATE_MESSAGE, RbacActions.READ_MESSAGE],
        });
        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId,
            communityId,
            roleId: userRole.id,
            isInstanceRole: false,
            role: userRole,
          },
        ]);

        await expect(
          service.createCommunityRole(communityId, createRoleDto, userId),
        ).rejects.toThrow(ForbiddenException);

        expect(mockDatabase.role.create).not.toHaveBeenCalled();
      });

      it('should succeed when user has all the actions they are granting', async () => {
        const communityId = 'community-123';
        const userId = 'user-123';
        const createRoleDto = {
          name: 'Allowed Role',
          actions: [RbacActions.CREATE_MESSAGE, RbacActions.READ_MESSAGE],
        };
        const createdRole = RoleFactory.build({
          name: 'Allowed Role',
          communityId,
          isDefault: false,
          actions: createRoleDto.actions,
        });

        // No existing role with this name
        mockDatabase.role.findFirst.mockResolvedValue(null);

        // User has all the actions being granted
        const userRole = RoleFactory.buildAdmin({
          communityId,
        });
        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId,
            communityId,
            roleId: userRole.id,
            isInstanceRole: false,
            role: userRole,
          },
        ]);

        mockDatabase.role.aggregate.mockResolvedValue({
          _max: { position: 20 },
        });
        mockDatabase.role.create.mockResolvedValue(createdRole);

        const result = await service.createCommunityRole(
          communityId,
          createRoleDto,
          userId,
        );

        expect(result.name).toBe('Allowed Role');
        expect(mockDatabase.role.create).toHaveBeenCalled();
      });

      it('should skip privilege escalation check when userId is not provided (internal call)', async () => {
        const communityId = 'community-123';
        const createRoleDto = {
          name: 'Internal Role',
          actions: [RbacActions.DELETE_COMMUNITY],
        };
        const createdRole = RoleFactory.build({
          name: 'Internal Role',
          communityId,
          isDefault: false,
          actions: createRoleDto.actions,
        });

        mockDatabase.role.findFirst.mockResolvedValue(null);
        mockDatabase.role.aggregate.mockResolvedValue({
          _max: { position: 20 },
        });
        mockDatabase.role.create.mockResolvedValue(createdRole);

        // Call without userId — should not check user permissions
        const result = await service.createCommunityRole(
          communityId,
          createRoleDto,
        );

        expect(result.name).toBe('Internal Role');
        // getUserRolesForCommunity uses userRoles.findMany — should not be called
        // since no userId was provided
        expect(mockDatabase.userRoles.findMany).not.toHaveBeenCalled();
        expect(mockDatabase.role.create).toHaveBeenCalled();
      });
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

    describe('privilege escalation prevention', () => {
      it('should throw ForbiddenException when user tries to add actions they do not have', async () => {
        const communityId = 'community-123';
        const userId = 'user-123';
        const existingRole = RoleFactory.build({
          name: 'Custom Role',
          communityId,
          isDefault: false,
          actions: [RbacActions.READ_MESSAGE],
        });
        const updateDto = {
          actions: [RbacActions.READ_MESSAGE, RbacActions.DELETE_COMMUNITY],
        };

        mockDatabase.role.findUnique.mockResolvedValue(existingRole);

        // User only has READ_MESSAGE and CREATE_MESSAGE, not DELETE_COMMUNITY
        const userRole = RoleFactory.buildMember({
          communityId,
          actions: [RbacActions.READ_MESSAGE, RbacActions.CREATE_MESSAGE],
        });
        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId,
            communityId,
            roleId: userRole.id,
            isInstanceRole: false,
            role: userRole,
          },
        ]);

        await expect(
          service.updateRole(existingRole.id, communityId, updateDto, userId),
        ).rejects.toThrow(ForbiddenException);

        expect(mockDatabase.role.update).not.toHaveBeenCalled();
      });

      it('should succeed when user has all the actions being set', async () => {
        const communityId = 'community-123';
        const userId = 'user-123';
        const existingRole = RoleFactory.build({
          name: 'Custom Role',
          communityId,
          isDefault: false,
          actions: [RbacActions.READ_MESSAGE],
        });
        const updateDto = {
          actions: [RbacActions.READ_MESSAGE, RbacActions.CREATE_MESSAGE],
        };

        mockDatabase.role.findUnique.mockResolvedValue(existingRole);

        // User has both actions
        const userRole = RoleFactory.buildAdmin({ communityId });
        mockDatabase.userRoles.findMany.mockResolvedValue([
          {
            userId,
            communityId,
            roleId: userRole.id,
            isInstanceRole: false,
            role: userRole,
          },
        ]);

        mockDatabase.role.update.mockResolvedValue({
          ...existingRole,
          actions: updateDto.actions,
        });

        const result = await service.updateRole(
          existingRole.id,
          communityId,
          updateDto,
          userId,
        );

        expect(result.actions).toEqual(updateDto.actions);
        expect(mockDatabase.role.update).toHaveBeenCalled();
      });

      it('should skip privilege escalation check when userId is not provided', async () => {
        const communityId = 'community-123';
        const existingRole = RoleFactory.build({
          name: 'Custom Role',
          communityId,
          isDefault: false,
          actions: [RbacActions.READ_MESSAGE],
        });
        const updateDto = {
          actions: [RbacActions.DELETE_COMMUNITY],
        };

        mockDatabase.role.findUnique.mockResolvedValue(existingRole);
        mockDatabase.role.update.mockResolvedValue({
          ...existingRole,
          actions: updateDto.actions,
        });

        // Call without userId — should not check user permissions
        const result = await service.updateRole(
          existingRole.id,
          communityId,
          updateDto,
        );

        expect(result.actions).toEqual(updateDto.actions);
        // getUserRolesForCommunity uses userRoles.findMany — should not be called
        expect(mockDatabase.userRoles.findMany).not.toHaveBeenCalled();
      });
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
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      });
    });

    it('should cap the roles list at 200', async () => {
      const communityId = 'community-123';
      mockDatabase.role.findMany.mockResolvedValue([]);

      await service.getCommunityRoles(communityId);

      expect(mockDatabase.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
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
        data: { actions: expect.any(Array), isDefault: true, position: 10 },
      });

      // Missing roles get created
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: {
          name: 'Moderator',
          communityId,
          isDefault: true,
          position: 20,
          actions: expect.any(Array),
        },
      });
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: {
          name: 'Member',
          communityId,
          isDefault: true,
          position: 100,
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

      // Update only touches actions, isDefault, and position — not UserRoles
      for (const call of mockDatabase.role.update.mock.calls) {
        const args = call[0];
        expect(args.data).toEqual({
          actions: expect.any(Array),
          isDefault: true,
          position: expect.any(Number),
        });
        expect(args.data).not.toHaveProperty('UserRoles');
      }
    });
  });

  describe('reorderRoles', () => {
    it('should reorder roles and set positions correctly', async () => {
      const communityId = 'community-123';
      const adminRole = RoleFactory.buildAdmin({ communityId });
      const modRole = RoleFactory.buildModerator({ communityId });
      const memberRole = RoleFactory.buildMember({
        communityId,
        name: 'Member',
      });
      const customRole = RoleFactory.build({
        communityId,
        name: 'Custom',
        position: 30,
      });

      mockDatabase.role.findMany.mockResolvedValueOnce([
        adminRole,
        modRole,
        memberRole,
        customRole,
      ]);

      // Mock the transaction
      mockDatabase.role.update.mockResolvedValue({});

      // Mock getCommunityRoles called at the end
      mockDatabase.role.findMany.mockResolvedValueOnce([
        { ...customRole, position: 10 },
        { ...modRole, position: 20 },
        { ...adminRole, position: 30 },
        { ...memberRole, position: 100 },
      ]);

      const result = await service.reorderRoles(communityId, [
        customRole.id,
        modRole.id,
        adminRole.id,
      ]);

      expect(result).toHaveLength(4);
      // Verify update calls within the transaction
      expect(mockDatabase.role.update).toHaveBeenCalledWith({
        where: { id: customRole.id },
        data: { position: 10 },
      });
      expect(mockDatabase.role.update).toHaveBeenCalledWith({
        where: { id: modRole.id },
        data: { position: 20 },
      });
      expect(mockDatabase.role.update).toHaveBeenCalledWith({
        where: { id: adminRole.id },
        data: { position: 30 },
      });
      // Member role should always be at 100
      expect(mockDatabase.role.update).toHaveBeenCalledWith({
        where: { id: memberRole.id },
        data: { position: 100 },
      });
    });

    it('should throw BadRequestException when roleId does not belong to community', async () => {
      const communityId = 'community-123';
      const adminRole = RoleFactory.buildAdmin({ communityId });
      const memberRole = RoleFactory.buildMember({ communityId });

      mockDatabase.role.findMany.mockResolvedValue([adminRole, memberRole]);

      await expect(
        service.reorderRoles(communityId, ['non-existent-role-id']),
      ).rejects.toThrow(BadRequestException);
    });

    it('should filter out Member role from reorder list and keep at position 100', async () => {
      const communityId = 'community-123';
      const adminRole = RoleFactory.buildAdmin({ communityId });
      const memberRole = RoleFactory.buildMember({
        communityId,
        name: 'Member',
      });

      mockDatabase.role.findMany.mockResolvedValueOnce([adminRole, memberRole]);
      mockDatabase.role.update.mockResolvedValue({});

      // Mock getCommunityRoles
      mockDatabase.role.findMany.mockResolvedValueOnce([
        { ...adminRole, position: 10 },
        { ...memberRole, position: 100 },
      ]);

      // Include the Member role ID in the reorder list — it should be filtered out
      await service.reorderRoles(communityId, [memberRole.id, adminRole.id]);

      // adminRole should get position 10 (first non-member role)
      expect(mockDatabase.role.update).toHaveBeenCalledWith({
        where: { id: adminRole.id },
        data: { position: 10 },
      });
      // Member role should be at 100
      expect(mockDatabase.role.update).toHaveBeenCalledWith({
        where: { id: memberRole.id },
        data: { position: 100 },
      });
    });
  });

  describe('createCommunityRole position auto-assignment', () => {
    it('should cap auto-assigned position below 100', async () => {
      const communityId = 'community-123';
      const createRoleDto = {
        name: 'High Position Role',
        actions: [RbacActions.CREATE_MESSAGE],
      };
      const createdRole = RoleFactory.build({
        name: 'High Position Role',
        communityId,
        isDefault: false,
        position: 99,
        actions: createRoleDto.actions,
      });

      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.aggregate.mockResolvedValue({
        _max: { position: 99 },
      });
      mockDatabase.role.create.mockResolvedValue(createdRole);

      await service.createCommunityRole(communityId, createRoleDto);

      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          position: 99,
        }),
      });
    });

    it('should use provided position when explicitly set', async () => {
      const communityId = 'community-123';
      const createRoleDto = {
        name: 'Explicit Position Role',
        actions: [RbacActions.CREATE_MESSAGE],
        position: 15,
      };
      const createdRole = RoleFactory.build({
        name: 'Explicit Position Role',
        communityId,
        isDefault: false,
        position: 15,
        actions: createRoleDto.actions,
      });

      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(createdRole);

      await service.createCommunityRole(communityId, createRoleDto);

      // aggregate should NOT be called when position is explicitly provided
      expect(mockDatabase.role.aggregate).not.toHaveBeenCalled();
      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          position: 15,
        }),
      });
    });

    it('should default to position 1 when no non-Member roles exist', async () => {
      const communityId = 'community-123';
      const createRoleDto = {
        name: 'First Custom Role',
        actions: [RbacActions.CREATE_MESSAGE],
      };
      const createdRole = RoleFactory.build({
        name: 'First Custom Role',
        communityId,
        isDefault: false,
        position: 1,
        actions: createRoleDto.actions,
      });

      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      mockDatabase.role.create.mockResolvedValue(createdRole);

      await service.createCommunityRole(communityId, createRoleDto);

      expect(mockDatabase.role.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          position: 1,
        }),
      });
    });
  });

  describe('RoleDto includes position field', () => {
    it('getCommunityRoles should include position in response', async () => {
      const communityId = 'community-123';
      const roles = [
        RoleFactory.build({
          name: 'Admin',
          communityId,
          isDefault: true,
          position: 10,
        }),
        RoleFactory.build({
          name: 'Member',
          communityId,
          isDefault: true,
          position: 100,
        }),
      ];

      mockDatabase.role.findMany.mockResolvedValue(roles);

      const result = await service.getCommunityRoles(communityId);

      expect(result.roles[0].position).toBe(10);
      expect(result.roles[1].position).toBe(100);
    });

    it('getUserRolesForCommunity should include position in response', async () => {
      const userId = 'user-123';
      const communityId = 'community-123';
      const role = RoleFactory.buildAdmin({
        communityId,
        position: 10,
      });

      mockDatabase.userRoles.findMany.mockResolvedValue([
        {
          userId,
          communityId,
          roleId: role.id,
          isInstanceRole: false,
          role,
        },
      ]);

      const result = await service.getUserRolesForCommunity(
        userId,
        communityId,
      );

      expect(result.roles[0].position).toBe(10);
    });
  });

  // ===========================================================================
  // Permission cache epoch bumps — one assertion per mutation site enumerated
  // in the RBAC permission cache task. Every create/delete of a UserRoles row
  // must bump the affected user's epoch; every create/update/delete of a Role
  // row must bump the owning community's epoch. Community-side subset of the
  // original RolesService coverage — see instance-roles.service.spec.ts for
  // the instance-side subset.
  //
  // Mutations that forward through `PermissionsCacheService.bumpNowOrDefer`
  // are asserted against that call (the fan-out to the concrete bump* method
  // is `bumpNowOrDefer`'s own concern, covered directly in
  // permissions-cache.service.spec.ts). Mutations that call a bump* method
  // directly are asserted against that method, unchanged from before the
  // split.
  // ===========================================================================
  describe('Permission cache epoch bumps', () => {
    it('createDefaultCommunityRoles bumps the community epoch', async () => {
      const communityId = 'community-bump-1';
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ name: 'Community Admin', communityId }),
      );

      await service.createDefaultCommunityRoles(communityId);

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        undefined,
        undefined,
      );
    });

    it('assignUserToCommunityRole bumps the target user epoch', async () => {
      const userId = 'user-bump-1';
      const communityId = 'community-bump-1';
      const roleId = 'role-bump-1';
      mockDatabase.role.findUnique.mockResolvedValue(
        RoleFactory.build({ id: roleId, communityId }),
      );
      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToCommunityRole(userId, communityId, roleId);

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'user', userId },
        undefined,
        undefined,
      );
    });

    it('createMemberRoleForCommunity bumps the community epoch', async () => {
      const communityId = 'community-bump-2';
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ name: 'Member', communityId }),
      );

      await service.createMemberRoleForCommunity(communityId);

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        undefined,
        undefined,
      );
    });

    it('resetDefaultCommunityRoles bumps the community epoch', async () => {
      const communityId = 'community-bump-3';
      mockDatabase.$transaction.mockImplementation((fn: any) =>
        fn(mockDatabase),
      );
      mockDatabase.role.findFirst.mockResolvedValue(
        RoleFactory.build({ communityId }),
      );
      mockDatabase.role.update.mockResolvedValue(RoleFactory.build());
      mockDatabase.role.findMany.mockResolvedValue([]);

      await service.resetDefaultCommunityRoles(communityId);

      expect(permissionsCacheService.bumpCommunityEpoch).toHaveBeenCalledWith(
        communityId,
      );
    });

    it('createCommunityRole bumps the community epoch', async () => {
      const communityId = 'community-bump-4';
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.aggregate.mockResolvedValue({ _max: { position: 20 } });
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId }),
      );

      await service.createCommunityRole(communityId, {
        name: 'New Role',
        actions: [RbacActions.CREATE_MESSAGE],
      });

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        undefined,
        undefined,
      );
    });

    it('updateRole bumps the community epoch', async () => {
      const communityId = 'community-bump-5';
      const roleId = 'role-bump-5';
      const existingRole = RoleFactory.build({
        id: roleId,
        communityId,
        isDefault: false,
      });
      mockDatabase.role.findUnique.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue({
        ...existingRole,
        actions: [RbacActions.READ_MESSAGE],
      });

      await service.updateRole(roleId, communityId, {
        actions: [RbacActions.READ_MESSAGE],
      });

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        undefined,
        undefined,
      );
    });

    it('deleteRole bumps the community epoch', async () => {
      const communityId = 'community-bump-6';
      const roleId = 'role-bump-6';
      const role = RoleFactory.build({
        id: roleId,
        communityId,
        isDefault: false,
      });
      mockDatabase.role.findUnique.mockResolvedValue({
        ...role,
        UserRoles: [],
      });
      mockDatabase.role.delete.mockResolvedValue(role);

      await service.deleteRole(roleId, communityId);

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        undefined,
        undefined,
      );
    });

    it('removeUserFromCommunityRole bumps the target user epoch', async () => {
      const userId = 'user-bump-2';
      const communityId = 'community-bump-7';
      const roleId = 'role-bump-7';
      const userRole = { id: 'user-role-bump', userId, communityId, roleId };
      mockDatabase.userRoles.findFirst.mockResolvedValue(userRole);
      mockDatabase.userRoles.delete.mockResolvedValue(userRole);

      await service.removeUserFromCommunityRole(userId, communityId, roleId);

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'user', userId },
        undefined,
        undefined,
      );
    });

    it('reorderRoles bumps the community epoch', async () => {
      const communityId = 'community-bump-8';
      const adminRole = RoleFactory.buildAdmin({ communityId });
      const memberRole = RoleFactory.buildMember({
        communityId,
        name: 'Member',
      });

      mockDatabase.role.findMany.mockResolvedValueOnce([adminRole, memberRole]);
      mockDatabase.role.update.mockResolvedValue({});
      mockDatabase.role.findMany.mockResolvedValueOnce([
        { ...adminRole, position: 10 },
        { ...memberRole, position: 100 },
      ]);

      await service.reorderRoles(communityId, [adminRole.id]);

      expect(permissionsCacheService.bumpCommunityEpoch).toHaveBeenCalledWith(
        communityId,
      );
    });
  });

  // ===========================================================================
  // Deferred epoch bumps — when a method runs inside a caller-owned
  // transaction (tx + pendingBumps collector), it forwards to
  // `PermissionsCacheService.bumpNowOrDefer`, which is responsible for
  // deferring the actual bump onto the collector rather than firing it while
  // the transaction is still open. That deferral mechanism itself (does it
  // push onto the collector? does it fall back to an immediate bump when no
  // collector is given?) is exercised directly against the real
  // PermissionsCacheService in permissions-cache.service.spec.ts. Here we
  // only verify each community-side mutation forwards the right EpochBump,
  // tx, and collector to bumpNowOrDefer.
  // ===========================================================================
  describe('Deferred epoch bumps inside caller-owned transactions', () => {
    it('createDefaultCommunityRoles forwards the community bump to bumpNowOrDefer when tx-nested', async () => {
      const communityId = 'community-defer-1';
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ name: 'Community Admin', communityId }),
      );

      await service.createDefaultCommunityRoles(
        communityId,
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        mockDatabase,
        pendingBumps,
      );
    });

    it('assignUserToCommunityRole forwards the user bump to bumpNowOrDefer when tx-nested', async () => {
      const userId = 'user-defer-1';
      const communityId = 'community-defer-2';
      const roleId = 'role-defer-1';
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.findUnique.mockResolvedValue(
        RoleFactory.build({ id: roleId, communityId }),
      );
      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToCommunityRole(
        userId,
        communityId,
        roleId,
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'user', userId },
        mockDatabase,
        pendingBumps,
      );
    });

    it('createMemberRoleForCommunity forwards the community bump to bumpNowOrDefer when tx-nested', async () => {
      const communityId = 'community-defer-3';
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ name: 'Member', communityId }),
      );

      await service.createMemberRoleForCommunity(
        communityId,
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        mockDatabase,
        pendingBumps,
      );
    });

    it('createCommunityRole forwards the community bump to bumpNowOrDefer when tx-nested', async () => {
      const communityId = 'community-defer-4';
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.aggregate.mockResolvedValue({ _max: { position: 20 } });
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId }),
      );

      await service.createCommunityRole(
        communityId,
        { name: 'New Role', actions: [RbacActions.CREATE_MESSAGE] },
        undefined,
        undefined,
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        mockDatabase,
        pendingBumps,
      );
    });

    it('updateRole forwards the community bump to bumpNowOrDefer when tx-nested', async () => {
      const communityId = 'community-defer-5';
      const roleId = 'role-defer-5';
      const pendingBumps: EpochBump[] = [];
      const existingRole = RoleFactory.build({
        id: roleId,
        communityId,
        isDefault: false,
      });
      mockDatabase.role.findUnique.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue({
        ...existingRole,
        actions: [RbacActions.READ_MESSAGE],
      });

      await service.updateRole(
        roleId,
        communityId,
        { actions: [RbacActions.READ_MESSAGE] },
        undefined,
        undefined,
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        mockDatabase,
        pendingBumps,
      );
    });

    it('deleteRole forwards the community bump to bumpNowOrDefer when tx-nested', async () => {
      const communityId = 'community-defer-6';
      const roleId = 'role-defer-6';
      const pendingBumps: EpochBump[] = [];
      const role = RoleFactory.build({
        id: roleId,
        communityId,
        isDefault: false,
      });
      mockDatabase.role.findUnique.mockResolvedValue({
        ...role,
        UserRoles: [],
      });
      mockDatabase.role.delete.mockResolvedValue(role);

      await service.deleteRole(
        roleId,
        communityId,
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'community', communityId },
        mockDatabase,
        pendingBumps,
      );
    });

    it('removeUserFromCommunityRole forwards the user bump to bumpNowOrDefer when tx-nested', async () => {
      const userId = 'user-defer-2';
      const communityId = 'community-defer-7';
      const roleId = 'role-defer-7';
      const pendingBumps: EpochBump[] = [];
      const userRole = { id: 'user-role-defer', userId, communityId, roleId };
      mockDatabase.userRoles.findFirst.mockResolvedValue(userRole);
      mockDatabase.userRoles.delete.mockResolvedValue(userRole);

      await service.removeUserFromCommunityRole(
        userId,
        communityId,
        roleId,
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'user', userId },
        mockDatabase,
        pendingBumps,
      );
    });

    it('assignUserToCommunityRole forwards tx without a pendingBumps collector to bumpNowOrDefer', async () => {
      const userId = 'user-defer-fallback';
      const communityId = 'community-defer-8';
      const roleId = 'role-defer-9';
      mockDatabase.role.findUnique.mockResolvedValue(
        RoleFactory.build({ id: roleId, communityId }),
      );
      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToCommunityRole(
        userId,
        communityId,
        roleId,
        mockDatabase as any,
      );

      // No collector was passed — bumpNowOrDefer itself decides whether to
      // fall back to an immediate bump (covered in
      // permissions-cache.service.spec.ts); here we only verify the call is
      // forwarded with the right (bump, tx, undefined) arguments.
      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'user', userId },
        mockDatabase,
        undefined,
      );
    });
  });
});
