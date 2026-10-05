import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannelMembershipService } from './channel-membership.service';
import { DatabaseService } from '@/database/database.service';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  createMockDatabase,
  UserFactory,
  ChannelFactory,
  CommunityFactory,
  MembershipFactory,
  ChannelMembershipFactory,
  expectNoSensitiveUserFields,
} from '@/test-utils';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('ChannelMembershipService', () => {
  let service: ChannelMembershipService;
  let mockDatabase: any;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(ChannelMembershipService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create channel membership for private channel', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const channel = ChannelFactory.build({
        isPrivate: true,
        communityId: community.id,
      });
      const createDto = { userId: user.id, channelId: channel.id };
      const communityMembership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const channelMembership = ChannelMembershipFactory.build({
        userId: user.id,
        channelId: channel.id,
      });

      mockDatabase.channel.findUnique.mockResolvedValue({
        ...channel,
        community,
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(communityMembership);
      mockDatabase.channelMembership.findUnique.mockResolvedValue(null);
      mockDatabase.channelMembership.create.mockResolvedValue(
        channelMembership,
      );

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      // Existence check must not fetch sensitive user fields at query level
      expect(mockDatabase.user.findUnique).toHaveBeenCalledWith({
        where: { id: user.id },
        select: { id: true },
      });
      expect(mockDatabase.channelMembership.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          channelId: channel.id,
          addedBy: undefined,
        },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.CHANNEL_MEMBERSHIP_CREATED,
        { userId: user.id, channelId: channel.id },
      );
    });

    it('should create channel membership with addedBy', async () => {
      const user = UserFactory.build();
      const adder = UserFactory.build();
      const community = CommunityFactory.build();
      const channel = ChannelFactory.build({
        isPrivate: true,
        communityId: community.id,
      });
      const createDto = { userId: user.id, channelId: channel.id };
      const communityMembership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const channelMembership = ChannelMembershipFactory.build({
        userId: user.id,
        channelId: channel.id,
        addedBy: adder.id,
      });

      mockDatabase.channel.findUnique.mockResolvedValue({
        ...channel,
        community,
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(communityMembership);
      mockDatabase.channelMembership.findUnique.mockResolvedValue(null);
      mockDatabase.channelMembership.create.mockResolvedValue(
        channelMembership,
      );

      const result = await service.create(createDto, adder.id);

      expect(result).toBeDefined();
      expect(mockDatabase.channelMembership.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          channelId: channel.id,
          addedBy: adder.id,
        },
      });
    });

    it('should throw ForbiddenException for public channel', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const channel = ChannelFactory.build({
        isPrivate: false,
        communityId: community.id,
      });
      const createDto = { userId: user.id, channelId: channel.id };

      mockDatabase.channel.findUnique.mockResolvedValue({
        ...channel,
        community,
      });

      await expect(service.create(createDto)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'Cannot manage membership for public channels',
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      const community = CommunityFactory.build();
      const channel = ChannelFactory.build({
        isPrivate: true,
        communityId: community.id,
      });
      const createDto = {
        userId: 'non-existent-user',
        channelId: channel.id,
      };

      mockDatabase.channel.findUnique.mockResolvedValue({
        ...channel,
        community,
      });
      mockDatabase.user.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto)).rejects.toThrow('User not found');
    });

    it('should throw ForbiddenException when user not community member', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const channel = ChannelFactory.build({
        isPrivate: true,
        communityId: community.id,
      });
      const createDto = { userId: user.id, channelId: channel.id };

      mockDatabase.channel.findUnique.mockResolvedValue({
        ...channel,
        community,
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'User must be a member of the community',
      );
    });

    it('should throw ConflictException when membership already exists', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const channel = ChannelFactory.build({
        isPrivate: true,
        communityId: community.id,
      });
      const createDto = { userId: user.id, channelId: channel.id };
      const communityMembership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const existingChannelMembership = ChannelMembershipFactory.build({
        userId: user.id,
        channelId: channel.id,
      });

      mockDatabase.channel.findUnique.mockResolvedValue({
        ...channel,
        community,
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(communityMembership);
      mockDatabase.channelMembership.findUnique.mockResolvedValue(
        existingChannelMembership,
      );

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'User is already a member of this channel',
      );
    });

    it('should throw NotFoundException when channel not found', async () => {
      const createDto = { userId: 'user-123', channelId: 'nonexistent' };

      mockDatabase.channel.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'Channel not found',
      );
    });

    it('should log successful creation', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const channel = ChannelFactory.build({
        isPrivate: true,
        communityId: community.id,
      });
      const createDto = { userId: user.id, channelId: channel.id };
      const communityMembership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const channelMembership = ChannelMembershipFactory.build({
        userId: user.id,
        channelId: channel.id,
      });

      mockDatabase.channel.findUnique.mockResolvedValue({
        ...channel,
        community,
      });
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(communityMembership);
      mockDatabase.channelMembership.findUnique.mockResolvedValue(null);
      mockDatabase.channelMembership.create.mockResolvedValue(
        channelMembership,
      );

      const loggerLogSpy = jest
        .spyOn(service['logger'], 'log')
        .mockImplementation();

      await service.create(createDto);

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Added user ${user.id}`),
      );

      loggerLogSpy.mockRestore();
    });
  });

  describe('findAllForChannel', () => {
    it('should return all memberships for private channel', async () => {
      const channel = ChannelFactory.build({ isPrivate: true });
      const user1 = UserFactory.build();
      const user2 = UserFactory.build();
      const memberships = [
        {
          ...ChannelMembershipFactory.build({
            channelId: channel.id,
            userId: user1.id,
          }),
          user: user1,
        },
        {
          ...ChannelMembershipFactory.build({
            channelId: channel.id,
            userId: user2.id,
          }),
          user: user2,
        },
      ];

      mockDatabase.channel.findUnique.mockResolvedValue(channel);
      mockDatabase.channelMembership.findMany.mockResolvedValue(memberships);

      const result = await service.findAllForChannel(channel.id);

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(mockDatabase.channelMembership.findMany).toHaveBeenCalledWith({
        where: { channelId: channel.id },
        include: {
          user: { select: PUBLIC_USER_SELECT },
        },
      });
    });

    it('should not leak sensitive user fields even when the query returns a full user row', async () => {
      const channel = ChannelFactory.build({ isPrivate: true });
      const fullUser = UserFactory.buildComplete();
      const memberships = [
        {
          ...ChannelMembershipFactory.build({
            channelId: channel.id,
            userId: fullUser.id,
          }),
          user: fullUser,
        },
      ];

      mockDatabase.channel.findUnique.mockResolvedValue(channel);
      mockDatabase.channelMembership.findMany.mockResolvedValue(memberships);

      const result = await service.findAllForChannel(channel.id);

      expect(result[0].user).toBeDefined();
      expectNoSensitiveUserFields(result[0].user!);
    });

    it('should throw ForbiddenException for public channel', async () => {
      const channel = ChannelFactory.build({ isPrivate: false });

      mockDatabase.channel.findUnique.mockResolvedValue(channel);

      await expect(service.findAllForChannel(channel.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.findAllForChannel(channel.id)).rejects.toThrow(
        'This endpoint is only for private channels',
      );
    });

    it('should return empty array when no memberships exist', async () => {
      const channel = ChannelFactory.build({ isPrivate: true });

      mockDatabase.channel.findUnique.mockResolvedValue(channel);
      mockDatabase.channelMembership.findMany.mockResolvedValue([]);

      const result = await service.findAllForChannel(channel.id);

      expect(result).toEqual([]);
    });

    it('should throw NotFoundException when channel not found', async () => {
      mockDatabase.channel.findUnique.mockResolvedValue(null);

      await expect(service.findAllForChannel('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findAllForChannel('nonexistent')).rejects.toThrow(
        'Channel not found',
      );
    });
  });

  describe('findAllForUser', () => {
    it('should return all private channel memberships for user', async () => {
      const user = UserFactory.build();
      const channel1 = ChannelFactory.build({ isPrivate: true });
      const channel2 = ChannelFactory.build({ isPrivate: true });
      const memberships = [
        {
          ...ChannelMembershipFactory.build({
            userId: user.id,
            channelId: channel1.id,
          }),
          channel: channel1,
        },
        {
          ...ChannelMembershipFactory.build({
            userId: user.id,
            channelId: channel2.id,
          }),
          channel: channel2,
        },
      ];

      mockDatabase.channelMembership.findMany.mockResolvedValue(memberships);

      const result = await service.findAllForUser(user.id);

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(mockDatabase.channelMembership.findMany).toHaveBeenCalledWith({
        where: {
          userId: user.id,
          channel: {
            isPrivate: true,
          },
        },
        include: {
          channel: {
            select: {
              id: true,
              name: true,
              communityId: true,
              isPrivate: true,
            },
          },
        },
      });
    });

    it('should return empty array when no memberships exist', async () => {
      const user = UserFactory.build();
      mockDatabase.channelMembership.findMany.mockResolvedValue([]);

      const result = await service.findAllForUser(user.id);

      expect(result).toEqual([]);
    });

    it('should rethrow errors', async () => {
      const user = UserFactory.build();
      mockDatabase.channelMembership.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(service.findAllForUser(user.id)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('findOne', () => {
    it('should return a specific membership for private channel', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build({ isPrivate: true });
      const membership = {
        ...ChannelMembershipFactory.build({
          userId: user.id,
          channelId: channel.id,
        }),
        channel,
      };

      mockDatabase.channelMembership.findUnique.mockResolvedValue(membership);

      const result = await service.findOne(user.id, channel.id);

      expect(result).toBeDefined();
      expect(mockDatabase.channelMembership.findUnique).toHaveBeenCalledWith({
        where: {
          userId_channelId: {
            userId: user.id,
            channelId: channel.id,
          },
        },
        include: {
          channel: true,
        },
      });
    });

    it('should throw ForbiddenException for public channel membership', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build({ isPrivate: false });
      const membership = {
        ...ChannelMembershipFactory.build({
          userId: user.id,
          channelId: channel.id,
        }),
        channel,
      };

      mockDatabase.channelMembership.findUnique.mockResolvedValue(membership);

      await expect(service.findOne(user.id, channel.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.findOne(user.id, channel.id)).rejects.toThrow(
        'This endpoint is only for private channels',
      );
    });

    it('should throw NotFoundException when membership not found', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build();

      mockDatabase.channelMembership.findUnique.mockResolvedValue(null);

      await expect(service.findOne(user.id, channel.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(user.id, channel.id)).rejects.toThrow(
        'Channel membership not found',
      );
    });
  });

  describe('remove', () => {
    it('should remove membership from private channel', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build({ isPrivate: true });
      const membership = ChannelMembershipFactory.build({
        userId: user.id,
        channelId: channel.id,
      });

      mockDatabase.channel.findUnique.mockResolvedValue(channel);
      mockDatabase.channelMembership.findUnique.mockResolvedValue(membership);
      mockDatabase.channelMembership.delete.mockResolvedValue(membership);

      await service.remove(user.id, channel.id);

      expect(mockDatabase.channelMembership.delete).toHaveBeenCalledWith({
        where: {
          userId_channelId: {
            userId: user.id,
            channelId: channel.id,
          },
        },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.CHANNEL_MEMBERSHIP_REMOVED,
        { userId: user.id, channelId: channel.id },
      );
    });

    it('should throw ForbiddenException for public channel', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build({ isPrivate: false });

      mockDatabase.channel.findUnique.mockResolvedValue(channel);

      await expect(service.remove(user.id, channel.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.remove(user.id, channel.id)).rejects.toThrow(
        'Cannot remove users from public channels',
      );
    });

    it('should throw NotFoundException when membership not found', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build({ isPrivate: true });

      mockDatabase.channel.findUnique.mockResolvedValue(channel);
      mockDatabase.channelMembership.findUnique.mockResolvedValue(null);

      await expect(service.remove(user.id, channel.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove(user.id, channel.id)).rejects.toThrow(
        'Channel membership not found',
      );
    });

    it('should log successful removal', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build({ isPrivate: true });
      const membership = ChannelMembershipFactory.build({
        userId: user.id,
        channelId: channel.id,
      });

      mockDatabase.channel.findUnique.mockResolvedValue(channel);
      mockDatabase.channelMembership.findUnique.mockResolvedValue(membership);
      mockDatabase.channelMembership.delete.mockResolvedValue(membership);

      const loggerLogSpy = jest
        .spyOn(service['logger'], 'log')
        .mockImplementation();

      await service.remove(user.id, channel.id);

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Removed user ${user.id}`),
      );

      loggerLogSpy.mockRestore();
    });
  });
});
