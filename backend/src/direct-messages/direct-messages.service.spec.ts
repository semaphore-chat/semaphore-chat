import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DirectMessagesService } from './direct-messages.service';
import { DatabaseService } from '@/database/database.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  createMockDatabase,
  UserFactory,
  DirectMessageGroupFactory,
  MessageFactory,
} from '@/test-utils';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('DirectMessagesService', () => {
  let service: DirectMessagesService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(DirectMessagesService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findUserDmGroups', () => {
    it('should return all DM groups for a user', async () => {
      const user = UserFactory.build();
      const createdAt = new Date();
      const lastMessage = MessageFactory.buildDirectMessage({
        directMessageGroupId: 'dm-1',
      });

      // Mock the batched query approach
      // Step 1: Return group IDs
      mockDatabase.directMessageGroupMember.findMany
        .mockResolvedValueOnce([{ groupId: 'dm-1' }])
        // Step 2 (parallel): Return members with users
        .mockResolvedValueOnce([
          {
            groupId: 'dm-1',
            userId: user.id,
            id: 'membership-1',
            joinedAt: new Date(),
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            },
          },
        ]);

      // Groups query
      mockDatabase.directMessageGroup.findMany.mockResolvedValue([
        {
          id: 'dm-1',
          name: null,
          isGroup: false,
          createdAt,
        },
      ]);

      // Messages query
      mockDatabase.message.findMany.mockResolvedValue([lastMessage]);

      const result = await service.findUserDmGroups(user.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('dm-1');
      expect(result[0].isGroup).toBe(false);
      expect(result[0].members).toHaveLength(1);
      expect(result[0].lastMessage).toBeDefined();
    });

    it('should return empty array when user has no DM groups', async () => {
      const user = UserFactory.build();
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);

      const result = await service.findUserDmGroups(user.id);

      expect(result).toEqual([]);
    });

    it('should handle last message being null', async () => {
      const user = UserFactory.build();
      const createdAt = new Date();

      // Mock the batched query approach
      mockDatabase.directMessageGroupMember.findMany
        .mockResolvedValueOnce([{ groupId: 'dm-1' }])
        .mockResolvedValueOnce([
          {
            groupId: 'dm-1',
            userId: user.id,
            id: 'membership-1',
            joinedAt: new Date(),
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            },
          },
        ]);

      mockDatabase.directMessageGroup.findMany.mockResolvedValue([
        {
          id: 'dm-1',
          name: null,
          isGroup: false,
          createdAt,
        },
      ]);

      // No messages
      mockDatabase.message.findMany.mockResolvedValue([]);

      const result = await service.findUserDmGroups(user.id);

      expect(result[0].lastMessage).toBeNull();
    });

    it('should sort groups by most recent message first, falling back to createdAt', async () => {
      const user = UserFactory.build();

      const jan1 = new Date('2025-01-01T00:00:00Z');
      const feb1 = new Date('2025-02-01T00:00:00Z');
      const feb15 = new Date('2025-02-15T00:00:00Z');
      const mar1 = new Date('2025-03-01T00:00:00Z');
      const mar15 = new Date('2025-03-15T00:00:00Z');

      const msgA = MessageFactory.buildDirectMessage({
        directMessageGroupId: 'dm-A',
        sentAt: mar1,
      });
      const msgB = MessageFactory.buildDirectMessage({
        directMessageGroupId: 'dm-B',
        sentAt: feb15,
      });

      mockDatabase.directMessageGroupMember.findMany
        .mockResolvedValueOnce([
          { groupId: 'dm-A' },
          { groupId: 'dm-B' },
          { groupId: 'dm-C' },
        ])
        .mockResolvedValueOnce([]);

      mockDatabase.directMessageGroup.findMany.mockResolvedValue([
        { id: 'dm-C', name: null, isGroup: false, createdAt: mar15 },
        { id: 'dm-B', name: null, isGroup: false, createdAt: feb1 },
        { id: 'dm-A', name: null, isGroup: false, createdAt: jan1 },
      ]);

      mockDatabase.message.findMany.mockResolvedValue([msgA, msgB]);

      const result = await service.findUserDmGroups(user.id);

      expect(result.map((g) => g.id)).toEqual(['dm-C', 'dm-A', 'dm-B']);
    });

    it('should rethrow errors', async () => {
      const user = UserFactory.build();
      mockDatabase.directMessageGroupMember.findMany.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(service.findUserDmGroups(user.id)).rejects.toThrow(
        'DB error',
      );
    });
  });

  describe('createDmGroup', () => {
    it('should create a 1:1 DM group', async () => {
      const creator = UserFactory.build();
      const otherUser = UserFactory.build();
      const createDto = { userIds: [otherUser.id] };

      const createdGroup = {
        id: 'dm-new',
        name: null,
        isGroup: false,
        createdAt: new Date(),
        members: [
          {
            userId: creator.id,
            user: {
              id: creator.id,
              username: creator.username,
              displayName: creator.displayName,
              avatarUrl: creator.avatarUrl,
            },
          },
          {
            userId: otherUser.id,
            user: {
              id: otherUser.id,
              username: otherUser.username,
              displayName: otherUser.displayName,
              avatarUrl: otherUser.avatarUrl,
            },
          },
        ],
        messages: [],
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(null); // No existing DM
      mockDatabase.directMessageGroup.create.mockResolvedValue(createdGroup);

      const result = await service.createDmGroup(createDto, creator.id);

      expect(result.id).toBe('dm-new');
      expect(result.isGroup).toBe(false);
      expect(mockDatabase.directMessageGroup.create).toHaveBeenCalledWith({
        data: {
          name: undefined,
          isGroup: false,
          members: {
            create: expect.arrayContaining([
              { userId: creator.id },
              { userId: otherUser.id },
            ]),
          },
        },
        include: expect.any(Object),
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.DM_GROUP_CREATED,
        {
          groupId: 'dm-new',
          memberIds: expect.arrayContaining([creator.id, otherUser.id]),
        },
      );
    });

    it('should return existing 1:1 DM if it already exists', async () => {
      const creator = UserFactory.build();
      const otherUser = UserFactory.build();
      const createDto = { userIds: [otherUser.id] };

      const existingGroup = {
        id: 'dm-existing',
        name: null,
        isGroup: false,
        createdAt: new Date(),
        members: [
          {
            userId: creator.id,
            user: {
              id: creator.id,
              username: creator.username,
              displayName: creator.displayName,
              avatarUrl: creator.avatarUrl,
            },
          },
          {
            userId: otherUser.id,
            user: {
              id: otherUser.id,
              username: otherUser.username,
              displayName: otherUser.displayName,
              avatarUrl: otherUser.avatarUrl,
            },
          },
        ],
        messages: [],
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(
        existingGroup,
      );

      const result = await service.createDmGroup(createDto, creator.id);

      expect(result.id).toBe('dm-existing');
      expect(mockDatabase.directMessageGroup.create).not.toHaveBeenCalled();
    });

    it('should create a group DM with multiple users', async () => {
      const creator = UserFactory.build();
      const user2 = UserFactory.build();
      const user3 = UserFactory.build();
      const createDto = { userIds: [user2.id, user3.id], name: 'Test Group' };

      const createdGroup = {
        id: 'group-new',
        name: 'Test Group',
        isGroup: true,
        createdAt: new Date(),
        members: [
          {
            userId: creator.id,
            user: {
              id: creator.id,
              username: creator.username,
              displayName: creator.displayName,
              avatarUrl: creator.avatarUrl,
            },
          },
          {
            userId: user2.id,
            user: {
              id: user2.id,
              username: user2.username,
              displayName: user2.displayName,
              avatarUrl: user2.avatarUrl,
            },
          },
          {
            userId: user3.id,
            user: {
              id: user3.id,
              username: user3.username,
              displayName: user3.displayName,
              avatarUrl: user3.avatarUrl,
            },
          },
        ],
        messages: [],
      };

      mockDatabase.directMessageGroup.create.mockResolvedValue(createdGroup);

      const result = await service.createDmGroup(createDto, creator.id);

      expect(result.id).toBe('group-new');
      expect(result.isGroup).toBe(true);
      expect(result.name).toBe('Test Group');
    });

    it('should include creator in members list automatically', async () => {
      const creator = UserFactory.build();
      const otherUser = UserFactory.build();
      const createDto = { userIds: [otherUser.id] };

      const createdGroup = {
        ...DirectMessageGroupFactory.build(),
        members: [],
        messages: [],
      };
      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(null);
      mockDatabase.directMessageGroup.create.mockResolvedValue(createdGroup);

      await service.createDmGroup(createDto, creator.id);

      expect(mockDatabase.directMessageGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            members: {
              create: expect.arrayContaining([
                { userId: creator.id },
                { userId: otherUser.id },
              ]),
            },
          }),
        }),
      );
    });

    it('should handle explicit isGroup flag', async () => {
      const creator = UserFactory.build();
      const otherUser = UserFactory.build();
      const createDto = {
        userIds: [otherUser.id],
        isGroup: true,
        name: 'Forced Group',
      };

      const createdGroup = {
        id: 'forced-group',
        name: 'Forced Group',
        isGroup: true,
        createdAt: new Date(),
        members: [],
        messages: [],
      };

      mockDatabase.directMessageGroup.create.mockResolvedValue(createdGroup);

      const result = await service.createDmGroup(createDto, creator.id);

      expect(result.isGroup).toBe(true);
    });

    it('should rethrow errors', async () => {
      const creator = UserFactory.build();
      const createDto = { userIds: ['other-id'] };

      mockDatabase.directMessageGroup.findFirst.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.createDmGroup(createDto, creator.id),
      ).rejects.toThrow('DB error');
    });
  });

  describe('findDmGroup', () => {
    it('should return DM group for authorized member', async () => {
      const user = UserFactory.build();
      const groupId = 'dm-123';
      const membership = { groupId, userId: user.id };
      const dmGroup = {
        id: groupId,
        name: null,
        isGroup: false,
        createdAt: new Date(),
        members: [
          {
            userId: user.id,
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            },
          },
        ],
        messages: [],
      };

      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue(
        membership,
      );
      mockDatabase.directMessageGroup.findUnique.mockResolvedValue(dmGroup);

      const result = await service.findDmGroup(groupId, user.id);

      expect(result.id).toBe(groupId);
      expect(
        mockDatabase.directMessageGroupMember.findFirst,
      ).toHaveBeenCalledWith({
        where: { groupId, userId: user.id },
      });
    });

    it('should throw ForbiddenException when user is not a member', async () => {
      const user = UserFactory.build();
      const groupId = 'dm-123';

      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue(null);

      await expect(service.findDmGroup(groupId, user.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.findDmGroup(groupId, user.id)).rejects.toThrow(
        'You are not a member of this DM group',
      );
    });

    it('should throw NotFoundException when group not found', async () => {
      const user = UserFactory.build();
      const groupId = 'nonexistent';

      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId,
        userId: user.id,
      });
      mockDatabase.directMessageGroup.findUnique.mockResolvedValue(null);

      await expect(service.findDmGroup(groupId, user.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findDmGroup(groupId, user.id)).rejects.toThrow(
        'DM group not found',
      );
    });
  });

  describe('addMembers', () => {
    it('should add new members to a group DM', async () => {
      const user = UserFactory.build();
      const newUser = UserFactory.build();
      const groupId = 'group-123';
      const addDto = { userIds: [newUser.id] };

      const dmGroup = {
        id: groupId,
        isGroup: true,
        members: [{ userId: user.id }],
      };

      const updatedGroup = {
        id: groupId,
        name: 'Test Group',
        isGroup: true,
        createdAt: new Date(),
        members: [
          {
            userId: user.id,
            user: {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            },
          },
          {
            userId: newUser.id,
            user: {
              id: newUser.id,
              username: newUser.username,
              displayName: newUser.displayName,
              avatarUrl: newUser.avatarUrl,
            },
          },
        ],
        messages: [],
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(dmGroup);
      mockDatabase.directMessageGroupMember.create.mockResolvedValue({});
      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId,
        userId: user.id,
      });
      mockDatabase.directMessageGroup.findUnique.mockResolvedValue(
        updatedGroup,
      );

      const result = await service.addMembers(groupId, addDto, user.id);

      expect(mockDatabase.directMessageGroupMember.create).toHaveBeenCalledWith(
        {
          data: { groupId, userId: newUser.id },
        },
      );
      expect(result.members).toHaveLength(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.DM_GROUP_MEMBER_ADDED,
        { groupId, userIds: [newUser.id] },
      );
    });

    it('should throw ForbiddenException when user is not a member', async () => {
      const user = UserFactory.build();
      const groupId = 'group-123';
      const addDto = { userIds: ['new-user-id'] };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.addMembers(groupId, addDto, user.id),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.addMembers(groupId, addDto, user.id),
      ).rejects.toThrow('You are not a member of this DM group');
    });

    it('should throw ForbiddenException when trying to add to 1:1 DM', async () => {
      const user = UserFactory.build();
      const groupId = 'dm-1on1';
      const addDto = { userIds: ['new-user-id'] };

      const dmGroup = {
        id: groupId,
        isGroup: false,
        members: [{ userId: user.id }],
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(dmGroup);

      await expect(
        service.addMembers(groupId, addDto, user.id),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.addMembers(groupId, addDto, user.id),
      ).rejects.toThrow('Cannot add members to a 1:1 DM');
    });

    it('refuses an addition that would take the group above 20 members', async () => {
      const user = UserFactory.build();
      const newUser = UserFactory.build();
      const groupId = 'group-123';
      const dmGroup = {
        id: groupId,
        isGroup: true,
        members: Array.from({ length: 20 }, (_, i) => ({
          userId: i === 0 ? user.id : `member-${i}`,
        })),
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(dmGroup);

      await expect(
        service.addMembers(groupId, { userIds: [newUser.id] }, user.id),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockDatabase.directMessageGroupMember.create,
      ).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('allows an addition that takes the group to exactly 20 members', async () => {
      const user = UserFactory.build();
      const newUser = UserFactory.build();
      const groupId = 'group-123';
      const dmGroup = {
        id: groupId,
        isGroup: true,
        members: Array.from({ length: 19 }, (_, i) => ({
          userId: i === 0 ? user.id : `member-${i}`,
        })),
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(dmGroup);
      mockDatabase.directMessageGroupMember.create.mockResolvedValue({});
      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId,
        userId: user.id,
      });
      mockDatabase.directMessageGroup.findUnique.mockResolvedValue({
        id: groupId,
        name: 'Test Group',
        isGroup: true,
        createdAt: new Date(),
        members: [],
        messages: [],
      });

      await service.addMembers(groupId, { userIds: [newUser.id] }, user.id);

      expect(mockDatabase.directMessageGroupMember.create).toHaveBeenCalledWith(
        {
          data: { groupId, userId: newUser.id },
        },
      );
    });

    it('should ignore duplicate member errors', async () => {
      const user = UserFactory.build();
      const newUser = UserFactory.build();
      const groupId = 'group-123';
      const addDto = { userIds: [newUser.id] };

      const dmGroup = {
        id: groupId,
        isGroup: true,
        members: [{ userId: user.id }],
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(dmGroup);
      mockDatabase.directMessageGroupMember.create.mockRejectedValue(
        new Error('Duplicate key'),
      );
      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId,
        userId: user.id,
      });
      mockDatabase.directMessageGroup.findUnique.mockResolvedValue({
        id: groupId,
        name: null,
        isGroup: true,
        createdAt: new Date(),
        members: [],
        messages: [],
      });

      await expect(
        service.addMembers(groupId, addDto, user.id),
      ).resolves.not.toThrow();
    });

    it('should add multiple members at once', async () => {
      const user = UserFactory.build();
      const newUser1 = UserFactory.build();
      const newUser2 = UserFactory.build();
      const groupId = 'group-123';
      const addDto = { userIds: [newUser1.id, newUser2.id] };

      const dmGroup = {
        id: groupId,
        isGroup: true,
        members: [{ userId: user.id }],
      };

      mockDatabase.directMessageGroup.findFirst.mockResolvedValue(dmGroup);
      mockDatabase.directMessageGroupMember.create.mockResolvedValue({});
      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId,
        userId: user.id,
      });
      mockDatabase.directMessageGroup.findUnique.mockResolvedValue({
        id: groupId,
        name: 'Test Group',
        isGroup: true,
        createdAt: new Date(),
        members: [],
        messages: [],
      });

      await service.addMembers(groupId, addDto, user.id);

      expect(
        mockDatabase.directMessageGroupMember.create,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('leaveDmGroup', () => {
    it('should remove user from DM group', async () => {
      const user = UserFactory.build();
      const groupId = 'dm-123';

      mockDatabase.directMessageGroupMember.delete.mockResolvedValue({});

      await service.leaveDmGroup(groupId, user.id);

      expect(mockDatabase.directMessageGroupMember.delete).toHaveBeenCalledWith(
        {
          where: {
            groupId_userId: {
              groupId,
              userId: user.id,
            },
          },
        },
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.DM_GROUP_MEMBER_LEFT,
        { groupId, userId: user.id },
      );
    });

    it('should rethrow errors', async () => {
      const user = UserFactory.build();
      const groupId = 'dm-123';

      mockDatabase.directMessageGroupMember.delete.mockRejectedValue(
        new Error('Delete failed'),
      );

      await expect(service.leaveDmGroup(groupId, user.id)).rejects.toThrow(
        'Delete failed',
      );
    });
  });
});
