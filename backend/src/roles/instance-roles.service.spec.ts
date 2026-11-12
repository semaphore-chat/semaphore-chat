import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InstanceRolesService } from './instance-roles.service';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { getInstanceAdminActions } from './default-roles.config';
import { DatabaseService } from '@/database/database.service';
import {
  PermissionsCacheService,
  type EpochBump,
} from './permissions-cache.service';
import { RbacActions, InstanceRole } from '@prisma/client';
import { createMockDatabase, UserFactory, RoleFactory } from '@/test-utils';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

describe('InstanceRolesService', () => {
  let service: InstanceRolesService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let permissionsCacheService: Mocked<PermissionsCacheService>;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(InstanceRolesService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    permissionsCacheService = unitRef.get(PermissionsCacheService);
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
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

  describe('assertMayManageUser', () => {
    const fullAdmin = getInstanceAdminActions();
    const held = (byUser: Record<string, RbacActions[]>) =>
      mockDatabase.userRoles.findMany.mockImplementation(((args: {
        where: { userId: string };
      }) =>
        Promise.resolve(
          (byUser[args.where.userId] ?? []).length
            ? [{ role: { actions: byUser[args.where.userId] } }]
            : [],
        )) as never);
    const actor = { id: 'actor', role: 'USER' };

    it("refuses a target holding an action the actor doesn't", async () => {
      held({
        actor: [RbacActions.UPDATE_USER],
        target: [RbacActions.UPDATE_USER, RbacActions.DELETE_USER],
      });
      await expect(
        service.assertMayManageUser(actor, 'target'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a target holding nothing, or no more than the actor', async () => {
      held({
        actor: [RbacActions.UPDATE_USER],
        same: [RbacActions.UPDATE_USER],
      });
      await expect(
        service.assertMayManageUser(actor, 'none'),
      ).resolves.toBeUndefined();
      await expect(
        service.assertMayManageUser(actor, 'same'),
      ).resolves.toBeUndefined();
    });

    it('full authority reaches holders of actions outside the admin set', async () => {
      held({ actor: fullAdmin, target: [RbacActions.UNBAN_USER] });
      await expect(
        service.assertMayManageUser(actor, 'target'),
      ).resolves.toBeUndefined();
    });

    it('an instance owner reaches anyone', async () => {
      held({ target: fullAdmin });
      await expect(
        service.assertMayManageUser({ id: 'actor', role: 'OWNER' }, 'target'),
      ).resolves.toBeUndefined();
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
            position: 10,
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
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
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

      it('should only check instance-scoped roles for name conflicts (communityId: null)', async () => {
        const createdRole = RoleFactory.build({
          name: 'Shared Name',
          communityId: null,
          isDefault: false,
          actions: [RbacActions.READ_USER],
        });

        // No instance role with this name exists (communityId: null)
        mockDatabase.role.findFirst.mockResolvedValue(null);
        mockDatabase.role.create.mockResolvedValue(createdRole);

        // A community role with the same name should NOT block creation
        const result = await service.createInstanceRole('Shared Name', [
          RbacActions.READ_USER,
        ]);

        expect(result.name).toBe('Shared Name');
        // Verify the conflict check scoped to communityId: null
        expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
          where: { name: 'Shared Name', communityId: null },
        });
        expect(mockDatabase.role.create).toHaveBeenCalled();
      });

      it('should throw ConflictException when instance role with same name exists', async () => {
        const existingRole = RoleFactory.build({
          name: 'Duplicate Name',
          communityId: null,
        });

        mockDatabase.role.findFirst.mockResolvedValue(existingRole);

        await expect(
          service.createInstanceRole('Duplicate Name', [RbacActions.READ_USER]),
        ).rejects.toThrow(ConflictException);
      });

      it('should throw BadRequestException for non-instance actions', async () => {
        mockDatabase.role.findFirst.mockResolvedValue(null);

        // CREATE_MESSAGE is a community-level action, not an instance action
        await expect(
          service.createInstanceRole('Bad Role', [
            RbacActions.CREATE_MESSAGE as any,
          ]),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('assignUserToInstanceRole', () => {
      it('should assign user to instance role', async () => {
        const userId = 'user-123';
        const roleId = 'role-123';
        const role = RoleFactory.build({ id: roleId });

        mockDatabase.role.findUnique.mockResolvedValue({
          ...role,
          communityId: null,
        });
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
        mockDatabase.role.findUnique.mockResolvedValue({
          ...RoleFactory.build({ id: roleId }),
          communityId: null,
        });
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
        mockDatabase.userRoles.findMany.mockResolvedValue([]);

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
        const existingRole = RoleFactory.build({
          name: 'Instance Admin',
          communityId: null,
          isDefault: true,
        });

        mockDatabase.role.findUnique.mockResolvedValue(existingRole);

        await expect(
          service.updateInstanceRole(existingRole.id, { name: 'New Name' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should prevent renaming any default instance role (not just Instance Admin)', async () => {
        const communityCreatorRole = RoleFactory.build({
          name: 'Community Creator',
          communityId: null,
          isDefault: true,
        });

        mockDatabase.role.findUnique.mockResolvedValue(communityCreatorRole);

        await expect(
          service.updateInstanceRole(communityCreatorRole.id, {
            name: 'Renamed Creator',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw NotFoundException when given a community role ID', async () => {
        const communityRole = RoleFactory.build({
          name: 'Community Admin',
          communityId: 'community-123',
          isDefault: true,
        });

        mockDatabase.role.findUnique.mockResolvedValue(communityRole);

        await expect(
          service.updateInstanceRole(communityRole.id, {
            actions: [RbacActions.READ_USER],
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should not conflict with community role names when checking for name conflicts', async () => {
        const roleId = 'instance-role-123';
        const existingInstanceRole = RoleFactory.build({
          id: roleId,
          name: 'Old Name',
          communityId: null,
          isDefault: false,
        });

        mockDatabase.role.findUnique.mockResolvedValue(existingInstanceRole);
        // No conflicting instance role (communityId: null)
        mockDatabase.role.findFirst.mockResolvedValue(null);
        mockDatabase.role.update.mockResolvedValue({
          ...existingInstanceRole,
          name: 'Shared Name',
        });
        mockDatabase.userRoles.findMany.mockResolvedValue([]);

        // Even if a community role has the same name, it should not prevent the rename
        const result = await service.updateInstanceRole(roleId, {
          name: 'Shared Name',
        });

        expect(result.name).toBe('Shared Name');
        // Verify the conflict check scoped to communityId: null
        expect(mockDatabase.role.findFirst).toHaveBeenCalledWith({
          where: {
            name: 'Shared Name',
            communityId: null,
            id: { not: roleId },
          },
        });
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

      it('lets the instance owner delete a role they did not create', async () => {
        const role = RoleFactory.build({
          name: 'Custom Instance Role',
          actions: [RbacActions.UPDATE_INSTANCE_SETTINGS],
          communityId: null,
        });
        mockDatabase.role.findUnique.mockResolvedValue({
          ...role,
          UserRoles: [],
        });
        mockDatabase.role.delete.mockResolvedValue(role);

        await service.deleteInstanceRole(role.id, {
          id: 'owner',
          role: InstanceRole.OWNER,
        });

        expect(mockDatabase.role.delete).toHaveBeenCalledWith({
          where: { id: role.id },
        });
      });

      it('refuses an admin who does not hold an action the role grants', async () => {
        const role = RoleFactory.build({
          name: 'Custom Instance Role',
          actions: [RbacActions.DELETE_USER],
          communityId: null,
        });
        mockDatabase.role.findUnique.mockResolvedValue({
          ...role,
          UserRoles: [],
        });
        mockDatabase.userRoles.findMany.mockResolvedValue([
          { role: { actions: [RbacActions.READ_USER] } },
        ]);

        await expect(
          service.deleteInstanceRole(role.id, {
            id: 'lesser-admin',
            role: InstanceRole.USER,
          }),
        ).rejects.toThrow(ForbiddenException);

        expect(mockDatabase.role.delete).not.toHaveBeenCalled();
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

      it('should throw NotFoundException when given a community role ID', async () => {
        const communityRole = RoleFactory.build({
          name: 'Community Admin',
          communityId: 'community-123',
          isDefault: true,
        });

        mockDatabase.role.findUnique.mockResolvedValue({
          ...communityRole,
          UserRoles: [],
        });

        await expect(
          service.deleteInstanceRole(communityRole.id),
        ).rejects.toThrow(NotFoundException);

        expect(mockDatabase.role.delete).not.toHaveBeenCalled();
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
            position: 20,
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

  // ===========================================================================
  // Permission cache epoch bumps — one assertion per mutation site enumerated
  // in the RBAC permission cache task. Instance-side subset of the original
  // RolesService coverage — see community-roles.service.spec.ts for the
  // community-side subset and its note on the bumpNowOrDefer split.
  // ===========================================================================
  describe('Permission cache epoch bumps', () => {
    it('createDefaultInstanceRole bumps the instance epoch', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId: null }),
      );

      await service.createDefaultInstanceRole();

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'instance' },
        undefined,
        undefined,
      );
    });

    it('createInstanceRole bumps the instance epoch', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId: null }),
      );

      await service.createInstanceRole('Custom Instance Role', [
        RbacActions.READ_USER,
      ]);

      expect(permissionsCacheService.bumpInstanceEpoch).toHaveBeenCalled();
    });

    it('updateInstanceRole bumps the instance epoch', async () => {
      const roleId = 'role-bump-8';
      const existingRole = RoleFactory.build({
        id: roleId,
        communityId: null,
        isDefault: false,
      });
      mockDatabase.role.findUnique.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue({
        ...existingRole,
        actions: [RbacActions.READ_USER],
      });
      mockDatabase.userRoles.findMany.mockResolvedValue([]);

      await service.updateInstanceRole(roleId, {
        actions: [RbacActions.READ_USER],
      });

      expect(permissionsCacheService.bumpInstanceEpoch).toHaveBeenCalled();
    });

    it('deleteInstanceRole bumps the instance epoch', async () => {
      const roleId = 'role-bump-9';
      const role = RoleFactory.build({
        id: roleId,
        communityId: null,
        name: 'Custom Instance Role',
      });
      mockDatabase.role.findUnique.mockResolvedValue({
        ...role,
        UserRoles: [],
      });
      mockDatabase.role.delete.mockResolvedValue(role);

      await service.deleteInstanceRole(roleId);

      expect(permissionsCacheService.bumpInstanceEpoch).toHaveBeenCalled();
    });

    it('assignUserToInstanceRole bumps the target user epoch', async () => {
      const userId = 'user-bump-3';
      const roleId = 'role-bump-10';
      mockDatabase.role.findUnique.mockResolvedValue(
        RoleFactory.build({ id: roleId }),
      );
      mockDatabase.userRoles.findFirst.mockResolvedValue(null);
      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToInstanceRole(userId, roleId);

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'user', userId },
        undefined,
        undefined,
      );
    });

    it('removeUserFromInstanceRole bumps the target user epoch', async () => {
      const userId = 'user-bump-4';
      const userRole = { id: 'user-role-bump-2' };
      mockDatabase.userRoles.findFirst.mockResolvedValue(userRole);
      mockDatabase.userRoles.delete.mockResolvedValue(userRole);

      await service.removeUserFromInstanceRole(userId, 'role-bump-11');

      expect(permissionsCacheService.bumpUserEpoch).toHaveBeenCalledWith(
        userId,
      );
    });

    it('createDefaultCommunityCreatorRole bumps the instance epoch', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId: null }),
      );

      await service.createDefaultCommunityCreatorRole();

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'instance' },
        undefined,
        undefined,
      );
    });

    it('ensureDefaultInstanceRolesExist bumps the instance epoch for each newly created role', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId: null, isDefault: true }),
      );

      await service.ensureDefaultInstanceRolesExist();

      // 4 default instance roles, all missing -> 4 creates -> 4 bumps
      expect(permissionsCacheService.bumpInstanceEpoch).toHaveBeenCalledTimes(
        4,
      );
    });

    it('ensureDefaultInstanceRolesExist does not bump when the role already exists', async () => {
      mockDatabase.role.findFirst.mockResolvedValue(RoleFactory.build());

      await service.ensureDefaultInstanceRolesExist();

      expect(permissionsCacheService.bumpInstanceEpoch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Deferred epoch bumps — instance-side subset. See
  // community-roles.service.spec.ts for the rationale: these assert that
  // each tx-nested mutation forwards the right EpochBump/tx/collector to
  // `PermissionsCacheService.bumpNowOrDefer`; the deferral mechanism itself
  // is covered directly in permissions-cache.service.spec.ts.
  // ===========================================================================
  describe('Deferred epoch bumps inside caller-owned transactions', () => {
    it('createDefaultInstanceRole forwards the instance bump to bumpNowOrDefer when tx-nested', async () => {
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId: null }),
      );

      await service.createDefaultInstanceRole(
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'instance' },
        mockDatabase,
        pendingBumps,
      );
    });

    it('assignUserToInstanceRole forwards the user bump to bumpNowOrDefer when tx-nested', async () => {
      const userId = 'user-defer-3';
      const roleId = 'role-defer-8';
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.findUnique.mockResolvedValue(
        RoleFactory.build({ id: roleId }),
      );
      mockDatabase.userRoles.findFirst.mockResolvedValue(null);
      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToInstanceRole(
        userId,
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

    it('createDefaultCommunityCreatorRole forwards the instance bump to bumpNowOrDefer when tx-nested', async () => {
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.findFirst.mockResolvedValue(null);
      mockDatabase.role.create.mockResolvedValue(
        RoleFactory.build({ communityId: null }),
      );

      await service.createDefaultCommunityCreatorRole(
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).toHaveBeenCalledWith(
        { kind: 'instance' },
        mockDatabase,
        pendingBumps,
      );
    });

    it('does not call bumpNowOrDefer when the idempotent create finds an existing role', async () => {
      const pendingBumps: EpochBump[] = [];
      mockDatabase.role.findFirst.mockResolvedValue(
        RoleFactory.build({ communityId: null }),
      );

      await service.createDefaultInstanceRole(
        mockDatabase as any,
        pendingBumps,
      );

      expect(permissionsCacheService.bumpNowOrDefer).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Socket announcements
  // =========================================================================

  describe('announcing a change to the user', () => {
    /** The announcement, as [event, payload]. */
    function announcement(index = 0) {
      return eventEmitter.emit.mock.calls[index] as [RoomEvents, unknown];
    }

    it('tells the user their instance roles changed when one is assigned', async () => {
      const roleId = 'role-123';
      mockDatabase.role.findUnique.mockResolvedValue({
        ...RoleFactory.build({ id: roleId }),
        communityId: null,
      });
      mockDatabase.userRoles.findFirst.mockResolvedValue(null);
      mockDatabase.userRoles.create.mockResolvedValue({});

      await service.assignUserToInstanceRole('user-1', roleId);

      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(announcement()).toEqual([
        RoomEvents.INSTANCE_ROLES_UPDATED,
        { userId: 'user-1', roleId },
      ]);
    });

    it('announces nothing when the assignment is refused', async () => {
      mockDatabase.role.findUnique.mockResolvedValue({
        ...RoleFactory.build({ id: 'role-123' }),
        communityId: null,
      });
      mockDatabase.userRoles.findFirst.mockResolvedValue({
        id: 'existing',
      });

      await expect(
        service.assignUserToInstanceRole('user-1', 'role-123'),
      ).rejects.toThrow(ConflictException);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('tells the user their instance roles changed when one is removed', async () => {
      mockDatabase.userRoles.findFirst.mockResolvedValue({ id: 'user-role-1' });
      mockDatabase.userRoles.delete.mockResolvedValue({ id: 'user-role-1' });

      await service.removeUserFromInstanceRole('user-1', 'role-123');

      expect(announcement()).toEqual([
        RoomEvents.INSTANCE_ROLES_UPDATED,
        { userId: 'user-1', roleId: 'role-123' },
      ]);
    });

    it('announces nothing when the removal is refused', async () => {
      mockDatabase.userRoles.findFirst.mockResolvedValue(null);

      await expect(
        service.removeUserFromInstanceRole('user-1', 'role-123'),
      ).rejects.toThrow(NotFoundException);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('tells every holder when their role is edited', async () => {
      const roleId = 'role-123';
      const existingRole = RoleFactory.build({
        id: roleId,
        name: 'Custom Instance Role',
      });
      mockDatabase.role.findUnique.mockResolvedValue(existingRole);
      mockDatabase.role.update.mockResolvedValue({
        ...existingRole,
        actions: [RbacActions.READ_USER],
      });
      mockDatabase.userRoles.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);

      await service.updateInstanceRole(roleId, {
        actions: [RbacActions.READ_USER],
      });

      expect(mockDatabase.userRoles.findMany).toHaveBeenCalledWith({
        where: { roleId, isInstanceRole: true },
        select: { userId: true },
      });
      expect(eventEmitter.emit.mock.calls).toEqual([
        [RoomEvents.INSTANCE_ROLES_UPDATED, { userId: 'user-1', roleId }],
        [RoomEvents.INSTANCE_ROLES_UPDATED, { userId: 'user-2', roleId }],
      ]);
    });

    it('announces nothing when the edit is refused', async () => {
      const existingRole = RoleFactory.build({
        name: 'Instance Admin',
        communityId: null,
        isDefault: true,
      });
      mockDatabase.role.findUnique.mockResolvedValue(existingRole);

      await expect(
        service.updateInstanceRole(existingRole.id, { name: 'New Name' }),
      ).rejects.toThrow(BadRequestException);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
