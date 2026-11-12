import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AliasGroupsService } from './alias-groups.service';
import { DatabaseService } from '@/database/database.service';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  createMockDatabase,
  UserFactory,
  CommunityFactory,
  MembershipFactory,
  AliasGroupFactory,
  AliasGroupMemberFactory,
} from '@/test-utils';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('AliasGroupsService', () => {
  let service: AliasGroupsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(AliasGroupsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCommunityAliasGroups', () => {
    it('should return all alias groups for a community with member counts', async () => {
      const community = CommunityFactory.build();
      const groups = [
        {
          ...AliasGroupFactory.build({ communityId: community.id }),
          _count: { members: 3 },
        },
        {
          ...AliasGroupFactory.build({ communityId: community.id }),
          _count: { members: 5 },
        },
      ];

      mockDatabase.aliasGroup.findMany.mockResolvedValue(groups);

      const result = await service.getCommunityAliasGroups(community.id);

      expect(result).toHaveLength(2);
      expect(result[0].memberCount).toBe(3);
      expect(result[1].memberCount).toBe(5);
      expect(mockDatabase.aliasGroup.findMany).toHaveBeenCalledWith({
        where: { communityId: community.id },
        include: { _count: { select: { members: true } } },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array when no groups exist', async () => {
      const community = CommunityFactory.build();
      mockDatabase.aliasGroup.findMany.mockResolvedValue([]);

      const result = await service.getCommunityAliasGroups(community.id);

      expect(result).toEqual([]);
    });
  });

  describe('getAliasGroup', () => {
    it('should return group with full member details', async () => {
      const user = UserFactory.build();
      const group = AliasGroupFactory.build();
      const groupWithMembers = {
        ...group,
        members: [
          {
            ...AliasGroupMemberFactory.build({
              aliasGroupId: group.id,
              userId: user.id,
            }),
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            },
          },
        ],
      };

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(groupWithMembers);

      const result = await service.getAliasGroup(group.id);

      expect(result.id).toBe(group.id);
      expect(result.memberCount).toBe(1);
      expect(result.members[0].id).toBe(user.id);
    });

    it('should throw NotFoundException when group not found', async () => {
      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);

      await expect(service.getAliasGroup('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createAliasGroup', () => {
    it('should create a new alias group without members', async () => {
      const community = CommunityFactory.build();
      const group = AliasGroupFactory.build({
        communityId: community.id,
        name: 'designers',
      });
      const groupWithMembers = { ...group, members: [] };

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);
      mockDatabase.aliasGroup.create.mockResolvedValue(groupWithMembers);

      const result = await service.createAliasGroup(community.id, {
        name: 'designers',
      });

      expect(result.name).toBe('designers');
      expect(result.memberCount).toBe(0);
      expect(mockDatabase.aliasGroup.create).toHaveBeenCalled();
    });

    it('should create group with initial members', async () => {
      const community = CommunityFactory.build();
      const user1 = UserFactory.build();
      const user2 = UserFactory.build();
      const group = AliasGroupFactory.build({
        communityId: community.id,
        name: 'team',
      });

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);
      mockDatabase.membership.findMany.mockResolvedValue([
        MembershipFactory.build({
          communityId: community.id,
          userId: user1.id,
        }),
        MembershipFactory.build({
          communityId: community.id,
          userId: user2.id,
        }),
      ]);
      mockDatabase.aliasGroup.create.mockResolvedValue({
        ...group,
        members: [
          {
            user: {
              id: user1.id,
              username: user1.username,
              displayName: null,
              avatarUrl: null,
            },
          },
          {
            user: {
              id: user2.id,
              username: user2.username,
              displayName: null,
              avatarUrl: null,
            },
          },
        ],
      });

      const result = await service.createAliasGroup(community.id, {
        name: 'team',
        memberIds: [user1.id, user2.id],
      });

      expect(result.memberCount).toBe(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.ALIAS_GROUP_CREATED,
        {
          aliasGroupId: group.id,
          memberIds: [user1.id, user2.id],
          communityId: community.id,
        },
      );
    });

    it('should throw ConflictException when group name already exists', async () => {
      const community = CommunityFactory.build();
      const existingGroup = AliasGroupFactory.build({
        communityId: community.id,
        name: 'designers',
      });

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(existingGroup);

      await expect(
        service.createAliasGroup(community.id, { name: 'designers' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for invalid member IDs', async () => {
      const community = CommunityFactory.build();

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);
      mockDatabase.membership.findMany.mockResolvedValue([]); // No valid members

      await expect(
        service.createAliasGroup(community.id, {
          name: 'team',
          memberIds: ['invalid-user-id'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateAliasGroup', () => {
    it('should update group name', async () => {
      const group = AliasGroupFactory.build({ name: 'old-name' });
      const updatedGroup = { ...group, name: 'new-name', members: [] };

      mockDatabase.aliasGroup.findUnique
        .mockResolvedValueOnce(group) // First call for existence check
        .mockResolvedValueOnce(null); // Second call for name conflict check
      mockDatabase.aliasGroup.update.mockResolvedValue(updatedGroup);

      const result = await service.updateAliasGroup(group.id, {
        name: 'new-name',
      });

      expect(result.name).toBe('new-name');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.ALIAS_GROUP_UPDATED,
        { aliasGroupId: group.id, communityId: group.communityId },
      );
    });

    it('should throw NotFoundException when group not found', async () => {
      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAliasGroup('non-existent-id', { name: 'new-name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when new name already exists', async () => {
      const group = AliasGroupFactory.build({ name: 'old-name' });
      const existingGroup = AliasGroupFactory.build({
        communityId: group.communityId,
        name: 'new-name',
      });

      mockDatabase.aliasGroup.findUnique
        .mockResolvedValueOnce(group)
        .mockResolvedValueOnce(existingGroup);

      await expect(
        service.updateAliasGroup(group.id, { name: 'new-name' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteAliasGroup', () => {
    it('should delete group and all memberships', async () => {
      const group = AliasGroupFactory.build();

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(group);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      mockDatabase.aliasGroupMember.deleteMany.mockResolvedValue({ count: 3 });
      mockDatabase.aliasGroup.delete.mockResolvedValue(group);

      await service.deleteAliasGroup(group.id);

      expect(mockDatabase.aliasGroupMember.deleteMany).toHaveBeenCalledWith({
        where: { aliasGroupId: group.id },
      });
      expect(mockDatabase.aliasGroup.delete).toHaveBeenCalledWith({
        where: { id: group.id },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.ALIAS_GROUP_DELETED,
        {
          aliasGroupId: group.id,
          memberIds: ['user-1', 'user-2'],
          communityId: group.communityId,
        },
      );
    });

    it('should throw NotFoundException when group not found', async () => {
      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);

      await expect(service.deleteAliasGroup('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('addMember', () => {
    it('should add a new member to the group', async () => {
      const group = AliasGroupFactory.build();
      const user = UserFactory.build();

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(group);
      mockDatabase.membership.findUnique.mockResolvedValue(
        MembershipFactory.build({
          communityId: group.communityId,
          userId: user.id,
        }),
      );
      mockDatabase.aliasGroupMember.findUnique.mockResolvedValue(null);
      mockDatabase.aliasGroupMember.create.mockResolvedValue(
        AliasGroupMemberFactory.build({
          aliasGroupId: group.id,
          userId: user.id,
        }),
      );

      await service.addMember(group.id, user.id);

      expect(mockDatabase.aliasGroupMember.create).toHaveBeenCalledWith({
        data: { aliasGroupId: group.id, userId: user.id },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.ALIAS_GROUP_MEMBER_ADDED,
        {
          aliasGroupId: group.id,
          userId: user.id,
          communityId: group.communityId,
        },
      );
    });

    it('should throw NotFoundException when group not found', async () => {
      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember('non-existent-id', 'user-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user not in community', async () => {
      const group = AliasGroupFactory.build();

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(group);
      mockDatabase.membership.findUnique.mockResolvedValue(null);

      await expect(service.addMember(group.id, 'user-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException when user already in group', async () => {
      const group = AliasGroupFactory.build();
      const user = UserFactory.build();

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(group);
      mockDatabase.membership.findUnique.mockResolvedValue(
        MembershipFactory.build({
          communityId: group.communityId,
          userId: user.id,
        }),
      );
      mockDatabase.aliasGroupMember.findUnique.mockResolvedValue(
        AliasGroupMemberFactory.build({
          aliasGroupId: group.id,
          userId: user.id,
        }),
      );

      await expect(service.addMember(group.id, user.id)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('removeMember', () => {
    it('should remove a member from the group', async () => {
      const group = AliasGroupFactory.build();
      const user = UserFactory.build();
      const member = AliasGroupMemberFactory.build({
        aliasGroupId: group.id,
        userId: user.id,
      });

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(group);
      mockDatabase.aliasGroupMember.findUnique.mockResolvedValue(member);
      mockDatabase.aliasGroupMember.delete.mockResolvedValue(member);

      await service.removeMember(group.id, user.id);

      expect(mockDatabase.aliasGroupMember.delete).toHaveBeenCalledWith({
        where: { id: member.id },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.ALIAS_GROUP_MEMBER_REMOVED,
        {
          aliasGroupId: group.id,
          userId: user.id,
          communityId: group.communityId,
        },
      );
    });

    it('should throw NotFoundException when member not found', async () => {
      mockDatabase.aliasGroup.findUnique.mockResolvedValue(
        AliasGroupFactory.build({ id: 'group-id' }),
      );
      mockDatabase.aliasGroupMember.findUnique.mockResolvedValue(null);

      await expect(service.removeMember('group-id', 'user-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateMembers', () => {
    it('should replace all members', async () => {
      const group = AliasGroupFactory.build();
      const user1 = UserFactory.build();
      const user2 = UserFactory.build();

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(group);
      mockDatabase.membership.findMany.mockResolvedValue([
        MembershipFactory.build({
          communityId: group.communityId,
          userId: user1.id,
        }),
        MembershipFactory.build({
          communityId: group.communityId,
          userId: user2.id,
        }),
      ]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.$transaction.mockResolvedValue(undefined);

      await service.updateMembers(group.id, [user1.id, user2.id]);

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.ALIAS_GROUP_MEMBERS_UPDATED,
        {
          aliasGroupId: group.id,
          addedUserIds: [user1.id, user2.id],
          removedUserIds: [],
          communityId: group.communityId,
        },
      );
    });

    it('should throw NotFoundException when group not found', async () => {
      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMembers('non-existent-id', []),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid member IDs', async () => {
      const group = AliasGroupFactory.build();

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(group);
      mockDatabase.membership.findMany.mockResolvedValue([]);

      await expect(
        service.updateMembers(group.id, ['invalid-user-id']),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAliasGroupByName', () => {
    it('should return group by name', async () => {
      const group = AliasGroupFactory.build({ name: 'designers' });
      const groupWithMembers = { ...group, members: [] };

      mockDatabase.aliasGroup.findUnique.mockResolvedValue(groupWithMembers);

      const result = await service.getAliasGroupByName(
        group.communityId,
        'designers',
      );

      expect(result?.name).toBe('designers');
    });

    it('should return null when group not found', async () => {
      mockDatabase.aliasGroup.findUnique.mockResolvedValue(null);

      const result = await service.getAliasGroupByName(
        'community-id',
        'non-existent',
      );

      expect(result).toBeNull();
    });
  });

  describe('getAliasGroupMemberIds', () => {
    it('should return all member user IDs', async () => {
      const user1 = UserFactory.build();
      const user2 = UserFactory.build();

      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([
        { userId: user1.id },
        { userId: user2.id },
      ]);

      const result = await service.getAliasGroupMemberIds('group-id');

      expect(result).toEqual([user1.id, user2.id]);
    });
  });

  describe('isUserInAliasGroups', () => {
    it('should return true when user is in one of the groups', async () => {
      const member = AliasGroupMemberFactory.build();

      mockDatabase.aliasGroupMember.findFirst.mockResolvedValue(member);

      const result = await service.isUserInAliasGroups('user-id', [
        'group-1',
        'group-2',
      ]);

      expect(result).toBe(true);
    });

    it('should return false when user is not in any group', async () => {
      mockDatabase.aliasGroupMember.findFirst.mockResolvedValue(null);

      const result = await service.isUserInAliasGroups('user-id', ['group-1']);

      expect(result).toBe(false);
    });

    it('should return false for empty group list', async () => {
      const result = await service.isUserInAliasGroups('user-id', []);

      expect(result).toBe(false);
    });
  });
});
