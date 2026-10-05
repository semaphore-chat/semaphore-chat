import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { RoomsService } from './rooms.service';
import { DatabaseService } from '@/database/database.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { createMockDatabase } from '@/test-utils';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';

describe('RoomsService', () => {
  let service: RoomsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let channelAccessService: Mocked<ChannelAccessService>;

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

    const { unit, unitRef } = await TestBed.solitary(RoomsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    channelAccessService = unitRef.get(ChannelAccessService);
    channelAccessService.visibleChannelIds.mockResolvedValue([]);
    mockDatabase.membership.findMany.mockResolvedValue([]);
    mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
    mockDatabase.aliasGroupMember.findMany.mockResolvedValue([]);
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

      await service.joinAllUserRooms(client);

      expect(client.join).toHaveBeenCalledWith(`user:${userId}`);
    });

    it('should join community rooms and every channel the user can see', async () => {
      const userId = 'user-123';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'community-1' },
        { communityId: 'community-2' },
      ]);
      channelAccessService.visibleChannelIds.mockResolvedValue([
        'ch-1',
        'ch-2',
        'private-1',
      ]);

      await service.joinAllUserRooms(client);

      expect(client.join).toHaveBeenCalledWith('community:community-1');
      expect(client.join).toHaveBeenCalledWith('community:community-2');
      // One visibility query across all the user's communities: a channel
      // membership left in a community the user was removed from must not
      // rejoin its room (ChannelAccessService checks community membership)
      expect(channelAccessService.visibleChannelIds).toHaveBeenCalledTimes(1);
      expect(channelAccessService.visibleChannelIds).toHaveBeenCalledWith(
        userId,
        ['community-1', 'community-2'],
      );
      expect(client.join).toHaveBeenCalledWith('ch-1');
      expect(client.join).toHaveBeenCalledWith('ch-2');
      expect(client.join).toHaveBeenCalledWith('private-1');
    });

    it('does not read channels or channel memberships itself', async () => {
      const client = createMockClient('user-123');
      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'community-1' },
      ]);

      await service.joinAllUserRooms(client);

      expect(mockDatabase.channel.findMany).not.toHaveBeenCalled();
      expect(mockDatabase.channelMembership.findMany).not.toHaveBeenCalled();
    });

    it('should join all DM groups and alias groups with correct query args', async () => {
      const userId = 'user-123';
      const client = createMockClient(userId);

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

    it('joins only the personal room when the user has no communities', async () => {
      const userId = 'user-no-communities';
      const client = createMockClient(userId);

      await service.joinAllUserRooms(client);

      expect(client.join).toHaveBeenCalledTimes(1);
      expect(client.join).toHaveBeenCalledWith(`user:${userId}`);
    });

    it('should join all room types in a single call', async () => {
      const userId = 'user-all';
      const client = createMockClient(userId);

      mockDatabase.membership.findMany.mockResolvedValue([
        { communityId: 'c-1' },
      ]);
      channelAccessService.visibleChannelIds.mockResolvedValue([
        'pub-1',
        'priv-1',
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
