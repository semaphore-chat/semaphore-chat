import { TestBed } from '@suites/unit';
import { RoomsService } from './rooms.service';
import { DatabaseService } from '@/database/database.service';
import { createMockDatabase } from '@/test-utils';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';

describe('RoomsService', () => {
  let service: RoomsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  const createMockClient = (userId: string): AuthenticatedSocket => {
    return {
      id: 'socket-123',
      handshake: {
        user: { id: userId },
      },
      join: jest.fn().mockResolvedValue(undefined),
      rooms: new Set(['room-1', 'room-2']),
    } as unknown as AuthenticatedSocket;
  };

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit } = await TestBed.solitary(RoomsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('joinAllUserRooms', () => {
    it('should join user to their personal room', async () => {
      const userId = 'user-123';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);

      await service.joinAllUserRooms(client);

      expect(client.join).toHaveBeenCalledWith(`user:${userId}`);
    });

    it('should join community rooms and all public channels across all communities', async () => {
      const userId = 'user-123';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'community-1' },
        { communityId: 'community-2' },
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([
        { id: 'ch-1' },
        { id: 'ch-2' },
        { id: 'ch-3' },
      ]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);

      await service.joinAllUserRooms(client);

      // Community rooms
      expect(client.join).toHaveBeenCalledWith('community:community-1');
      expect(client.join).toHaveBeenCalledWith('community:community-2');
      // Public channels
      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: {
          communityId: { in: ['community-1', 'community-2'] },
          isPrivate: false,
        },
        select: { id: true },
      });
      expect(client.join).toHaveBeenCalledWith('ch-1');
      expect(client.join).toHaveBeenCalledWith('ch-2');
      expect(client.join).toHaveBeenCalledWith('ch-3');
    });

    it('should join all private channels with membership', async () => {
      const userId = 'user-123';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'community-1' },
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([
        { channelId: 'private-1' },
        { channelId: 'private-2' },
      ]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);

      await service.joinAllUserRooms(client);

      expect(mockDatabase.channelMembership.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          // Only in communities the user is still a member of
          channel: { isPrivate: true, communityId: { in: ['community-1'] } },
        },
        select: { channelId: true },
      });
      expect(client.join).toHaveBeenCalledWith('private-1');
      expect(client.join).toHaveBeenCalledWith('private-2');
    });

    it('should join all DM groups and alias groups with correct query args', async () => {
      const userId = 'user-123';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { groupId: 'dm-1' },
        { groupId: 'dm-2' },
      ]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([
        { aliasGroupId: 'alias-1' },
      ]);

      await service.joinAllUserRooms(client);

      expect(
        mockDatabase.directMessageGroupMember.findMany,
      ).toHaveBeenCalledWith({
        where: { userId },
        select: { groupId: true },
      });
      expect(mockDatabase.aliasGroupMember.findMany).toHaveBeenCalledWith({
        where: { userId, aliasGroup: { communityId: { in: [] } } },
        select: { aliasGroupId: true },
      });
      expect(client.join).toHaveBeenCalledWith('dm:dm-1');
      expect(client.join).toHaveBeenCalledWith('dm:dm-2');
      expect(client.join).toHaveBeenCalledWith('alias-1');
    });

    it('should query channels across multiple communities in a single batch', async () => {
      const userId = 'user-multi';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'c-1' },
        { communityId: 'c-2' },
        { communityId: 'c-3' },
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([
        { id: 'c1-ch1' },
        { id: 'c2-ch1' },
        { id: 'c3-ch1' },
        { id: 'c3-ch2' },
      ]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);

      await service.joinAllUserRooms(client);

      // Verify single batch query with all community IDs
      expect(mockDatabase.channel.findMany).toHaveBeenCalledTimes(1);
      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: {
          communityId: { in: ['c-1', 'c-2', 'c-3'] },
          isPrivate: false,
        },
        select: { id: true },
      });
      // personal + 3 community rooms + 4 public channels = 8
      expect(client.join).toHaveBeenCalledTimes(8);
      expect(client.join).toHaveBeenCalledWith('community:c-1');
      expect(client.join).toHaveBeenCalledWith('community:c-2');
      expect(client.join).toHaveBeenCalledWith('community:c-3');
      expect(client.join).toHaveBeenCalledWith('c1-ch1');
      expect(client.join).toHaveBeenCalledWith('c2-ch1');
      expect(client.join).toHaveBeenCalledWith('c3-ch1');
      expect(client.join).toHaveBeenCalledWith('c3-ch2');
    });

    it("should query private channels of all the user's communities in one query", async () => {
      const userId = 'user-priv';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'c-1' },
        { communityId: 'c-2' },
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([
        { channelId: 'priv-from-c1' },
        { channelId: 'priv-from-c2' },
      ]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);

      await service.joinAllUserRooms(client);

      // One query across communities, limited to those the user is still a
      // member of: a channel membership left behind in a community the user
      // was removed or banned from must not rejoin its room
      expect(mockDatabase.channelMembership.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          channel: { isPrivate: true, communityId: { in: ['c-1', 'c-2'] } },
        },
        select: { channelId: true },
      });
      expect(client.join).toHaveBeenCalledWith('priv-from-c1');
      expect(client.join).toHaveBeenCalledWith('priv-from-c2');
    });

    it('should skip channel query when user has no community memberships', async () => {
      const userId = 'user-no-communities';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);

      await service.joinAllUserRooms(client);

      expect(mockDatabase.channel.findMany).not.toHaveBeenCalled();
      // Only personal room
      expect(client.join).toHaveBeenCalledTimes(1);
      expect(client.join).toHaveBeenCalledWith(`user:${userId}`);
    });

    it('should join all room types in a single call', async () => {
      const userId = 'user-all';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'c-1' },
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([{ id: 'pub-1' }]);
      mockDatabase.channelMembership.findMany.mockResolvedValue([
        { channelId: 'priv-1' },
      ]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { groupId: 'dm-1' },
      ]);
      mockDatabase.aliasGroupMember.findMany.mockResolvedValue([
        { aliasGroupId: 'alias-1' },
      ]);

      await service.joinAllUserRooms(client);

      // personal + 1 community room + 1 public + 1 private + 1 DM + 1 alias = 6
      expect(client.join).toHaveBeenCalledTimes(6);
      expect(client.join).toHaveBeenCalledWith(`user:${userId}`);
      expect(client.join).toHaveBeenCalledWith('community:c-1');
      expect(client.join).toHaveBeenCalledWith('pub-1');
      expect(client.join).toHaveBeenCalledWith('priv-1');
      expect(client.join).toHaveBeenCalledWith('dm:dm-1');
      expect(client.join).toHaveBeenCalledWith('alias-1');
    });
  });
});
