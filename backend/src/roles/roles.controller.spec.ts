import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { RolesController } from './roles.controller';
import { CommunityRolesService } from './community-roles.service';
import { InstanceRolesService } from './instance-roles.service';

describe('RolesController', () => {
  let controller: RolesController;
  let service: Mocked<CommunityRolesService>;
  let instanceService: Mocked<InstanceRolesService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(RolesController).compile();

    controller = unit;
    service = unitRef.get(CommunityRolesService);
    instanceService = unitRef.get(InstanceRolesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have a service', () => {
    expect(service).toBeDefined();
    expect(instanceService).toBeDefined();
  });

  describe('getMyRolesForCommunity', () => {
    it('should get current user roles for community', async () => {
      const communityId = 'community-123';
      const req = { user: { id: 'user-123' } } as any;
      const expectedRoles = { roles: [], permissions: [] };

      service.getUserRolesForCommunity.mockResolvedValue(expectedRoles as any);

      const result = await controller.getMyRolesForCommunity(communityId, req);

      expect(result).toEqual(expectedRoles);
      expect(service.getUserRolesForCommunity).toHaveBeenCalledWith(
        'user-123',
        communityId,
      );
    });
  });

  describe('getMyRolesForChannel', () => {
    it('should get current user roles for channel', async () => {
      const channelId = 'channel-123';
      const req = { user: { id: 'user-456' } } as any;
      const expectedRoles = { roles: [], permissions: [] };

      service.getUserRolesForChannel.mockResolvedValue(expectedRoles as any);

      const result = await controller.getMyRolesForChannel(channelId, req);

      expect(result).toEqual(expectedRoles);
      expect(service.getUserRolesForChannel).toHaveBeenCalledWith(
        'user-456',
        channelId,
      );
    });
  });

  describe('getMyInstanceRoles', () => {
    it('should get current user instance roles', async () => {
      const req = { user: { id: 'user-789' } } as any;
      const expectedRoles = { roles: [], permissions: [] };

      instanceService.getUserInstanceRoles.mockResolvedValue(
        expectedRoles as any,
      );

      const result = await controller.getMyInstanceRoles(req);

      expect(result).toEqual(expectedRoles);
      expect(instanceService.getUserInstanceRoles).toHaveBeenCalledWith(
        'user-789',
      );
    });
  });

  describe('getUserRolesForCommunity', () => {
    it('should get specific user roles for community', async () => {
      const userId = 'user-123';
      const communityId = 'community-456';
      const expectedRoles = { roles: [], permissions: [] };

      service.getUserRolesForCommunity.mockResolvedValue(expectedRoles as any);

      const result = await controller.getUserRolesForCommunity(
        userId,
        communityId,
      );

      expect(result).toEqual(expectedRoles);
      expect(service.getUserRolesForCommunity).toHaveBeenCalledWith(
        userId,
        communityId,
      );
    });
  });

  describe('getUserRolesForChannel', () => {
    it('should get specific user roles for channel', async () => {
      const userId = 'user-789';
      const channelId = 'channel-789';
      const expectedRoles = { roles: [], permissions: [] };

      service.getUserRolesForChannel.mockResolvedValue(expectedRoles as any);

      const result = await controller.getUserRolesForChannel(userId, channelId);

      expect(result).toEqual(expectedRoles);
      expect(service.getUserRolesForChannel).toHaveBeenCalledWith(
        userId,
        channelId,
      );
    });
  });

  describe('getUserInstanceRoles', () => {
    it('should get specific user instance roles', async () => {
      const userId = 'user-999';
      const expectedRoles = { roles: [], permissions: [] };

      instanceService.getUserInstanceRoles.mockResolvedValue(
        expectedRoles as any,
      );

      const result = await controller.getUserInstanceRoles(userId);

      expect(result).toEqual(expectedRoles);
      expect(instanceService.getUserInstanceRoles).toHaveBeenCalledWith(userId);
    });
  });

  describe('getCommunityRoles', () => {
    it('should get all roles for a community', async () => {
      const communityId = 'community-123';
      const expectedRoles = { roles: [] };

      service.getCommunityRoles.mockResolvedValue(expectedRoles as any);

      const result = await controller.getCommunityRoles(communityId);

      expect(result).toEqual(expectedRoles);
      expect(service.getCommunityRoles).toHaveBeenCalledWith(communityId);
    });
  });

  describe('createCommunityRole', () => {
    it('should create a new community role', async () => {
      const communityId = 'community-456';
      const req = { user: { id: 'user-creator', role: 'USER' } } as any;
      const createRoleDto = {
        name: 'Moderator',
        permissions: ['READ_MESSAGE', 'CREATE_MESSAGE'],
      };
      const createdRole = { id: 'role-123', ...createRoleDto };

      service.createCommunityRole.mockResolvedValue(createdRole as any);

      const result = await controller.createCommunityRole(
        communityId,
        createRoleDto as any,
        req,
      );

      expect(result).toEqual(createdRole);
      expect(service.createCommunityRole).toHaveBeenCalledWith(
        communityId,
        createRoleDto,
        'user-creator',
        'USER',
      );
    });
  });

  describe('updateRole', () => {
    it('should update an existing role', async () => {
      const communityId = 'community-456';
      const roleId = 'role-789';
      const req = { user: { id: 'user-updater', role: 'USER' } } as any;
      const updateRoleDto = { name: 'Updated Moderator' };
      const updatedRole = { id: roleId, ...updateRoleDto };

      service.updateRole.mockResolvedValue(updatedRole as any);

      const result = await controller.updateRole(
        communityId,
        roleId,
        updateRoleDto,
        req,
      );

      expect(result).toEqual(updatedRole);
      expect(service.updateRole).toHaveBeenCalledWith(
        roleId,
        communityId,
        updateRoleDto,
        'user-updater',
        'USER',
      );
    });
  });

  describe('deleteRole', () => {
    it('should delete a role', async () => {
      const communityId = 'community-456';
      const roleId = 'role-999';

      service.deleteRole.mockResolvedValue(undefined);

      const result = await controller.deleteRole(communityId, roleId);

      expect(result).toBeUndefined();
      expect(service.deleteRole).toHaveBeenCalledWith(roleId, communityId);
    });
  });

  describe('assignRoleToUser', () => {
    it('should assign a role to a user', async () => {
      const communityId = 'community-111';
      const assignRoleDto = {
        userId: 'user-222',
        roleId: 'role-333',
      };

      service.assignUserToCommunityRole.mockResolvedValue(undefined);

      const result = await controller.assignRoleToUser(
        communityId,
        assignRoleDto,
      );

      expect(result).toBeUndefined();
      expect(service.assignUserToCommunityRole).toHaveBeenCalledWith(
        'user-222',
        communityId,
        'role-333',
      );
    });
  });

  describe('removeRoleFromUser', () => {
    it('should remove a role from a user', async () => {
      const communityId = 'community-444';
      const userId = 'user-555';
      const roleId = 'role-666';

      service.removeUserFromCommunityRole.mockResolvedValue(undefined);

      const result = await controller.removeRoleFromUser(
        communityId,
        userId,
        roleId,
      );

      expect(result).toBeUndefined();
      expect(service.removeUserFromCommunityRole).toHaveBeenCalledWith(
        userId,
        communityId,
        roleId,
      );
    });
  });

  describe('getUsersForRole', () => {
    it('should get all users for a role in a community', async () => {
      const communityId = 'community-888';
      const roleId = 'role-777';
      const expectedUsers = [{ id: 'user-1' }, { id: 'user-2' }];

      service.getUsersForRole.mockResolvedValue(expectedUsers as any);

      const result = await controller.getUsersForRole(communityId, roleId);

      expect(result).toEqual(expectedUsers);
      expect(service.getUsersForRole).toHaveBeenCalledWith(roleId, communityId);
    });
  });
});
