import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { AliasGroupsController } from './alias-groups.controller';
import { AliasGroupsService } from './alias-groups.service';

describe('AliasGroupsController', () => {
  let controller: AliasGroupsController;
  let service: Mocked<AliasGroupsService>;

  const mockGroup = {
    id: 'group-1',
    communityId: 'comm-1',
    name: 'Admins',
    memberCount: 2,
    members: [
      { id: 'user-1', username: 'alice' },
      { id: 'user-2', username: 'bob' },
    ],
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      AliasGroupsController,
    ).compile();

    controller = unit;
    service = unitRef.get(AliasGroupsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCommunityAliasGroups', () => {
    it('passes communityId to the service', async () => {
      service.getCommunityAliasGroups = jest
        .fn()
        .mockResolvedValue([mockGroup]);

      const result = await controller.getCommunityAliasGroups('comm-1');

      expect(service.getCommunityAliasGroups).toHaveBeenCalledWith('comm-1');
      expect(result).toEqual([mockGroup]);
    });
  });

  describe('createAliasGroup', () => {
    it('passes communityId and dto to the service', async () => {
      service.createAliasGroup = jest.fn().mockResolvedValue(mockGroup);
      const dto = { name: 'Admins' };

      const result = await controller.createAliasGroup('comm-1', dto);

      expect(service.createAliasGroup).toHaveBeenCalledWith('comm-1', dto);
      expect(result).toBe(mockGroup);
    });
  });

  describe('getAliasGroup', () => {
    it('passes groupId to the service', async () => {
      service.getAliasGroup = jest.fn().mockResolvedValue(mockGroup);

      const result = await controller.getAliasGroup('group-1');

      expect(service.getAliasGroup).toHaveBeenCalledWith('group-1');
      expect(result).toBe(mockGroup);
    });
  });

  describe('updateAliasGroup', () => {
    it('passes groupId and dto to the service', async () => {
      service.updateAliasGroup = jest
        .fn()
        .mockResolvedValue({ ...mockGroup, name: 'Mods' });
      const dto = { name: 'Mods' };

      const result = await controller.updateAliasGroup('group-1', dto);

      expect(service.updateAliasGroup).toHaveBeenCalledWith('group-1', dto);
      expect(result.name).toBe('Mods');
    });
  });

  describe('deleteAliasGroup', () => {
    it('passes groupId to the service', async () => {
      service.deleteAliasGroup = jest.fn().mockResolvedValue(undefined);

      await controller.deleteAliasGroup('group-1');

      expect(service.deleteAliasGroup).toHaveBeenCalledWith('group-1');
    });
  });

  describe('addMember', () => {
    it('passes groupId and userId to the service', async () => {
      service.addMember = jest.fn().mockResolvedValue(undefined);

      await controller.addMember('group-1', { userId: 'user-3' });

      expect(service.addMember).toHaveBeenCalledWith('group-1', 'user-3');
    });
  });

  describe('removeMember', () => {
    it('passes groupId and userId to the service', async () => {
      service.removeMember = jest.fn().mockResolvedValue(undefined);

      await controller.removeMember('group-1', 'user-2');

      expect(service.removeMember).toHaveBeenCalledWith('group-1', 'user-2');
    });
  });

  describe('updateMembers', () => {
    it('passes groupId and memberIds to the service', async () => {
      service.updateMembers = jest.fn().mockResolvedValue(undefined);

      await controller.updateMembers('group-1', {
        memberIds: ['user-1', 'user-3'],
      });

      expect(service.updateMembers).toHaveBeenCalledWith('group-1', [
        'user-1',
        'user-3',
      ]);
    });
  });
});
