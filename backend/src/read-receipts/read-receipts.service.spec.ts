import { TestBed } from '@suites/unit';
import { ReadReceiptsService } from './read-receipts.service';
import { DatabaseService } from '@/database/database.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  createMockDatabase,
  ReadReceiptFactory,
  MessageFactory,
  ChannelFactory,
  DirectMessageGroupFactory,
  MembershipFactory,
} from '@/test-utils';
import { MarkAsReadDto } from './dto/mark-as-read.dto';

const EXCLUDE_THREAD_REPLIES = { parentMessageId: null };

describe('ReadReceiptsService', () => {
  let service: ReadReceiptsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit } = await TestBed.solitary(ReadReceiptsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('markAsRead', () => {
    const userId = 'user-123';
    const channelId = 'channel-123';
    const dmGroupId = 'dm-group-123';
    const messageId = 'message-123';

    it('should create a read receipt for a channel', async () => {
      const message = MessageFactory.build({ id: messageId, channelId });
      const readReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: messageId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: messageId,
        channelId,
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.readReceipt.findFirst.mockResolvedValue(null);
      mockDatabase.readReceipt.create.mockResolvedValue(readReceipt);

      const result = await service.markAsRead(userId, dto);

      expect(result).toEqual(readReceipt);
      expect(mockDatabase.message.findUnique).toHaveBeenCalledWith({
        where: { id: messageId },
      });
      expect(mockDatabase.readReceipt.create).toHaveBeenCalledWith({
        data: {
          userId,
          channelId,
          lastReadMessageId: messageId,
          lastReadAt: expect.any(Date),
        },
      });
    });

    it('should create a read receipt for a DM group', async () => {
      const message = MessageFactory.buildDirectMessage({
        id: messageId,
        directMessageGroupId: dmGroupId,
      });
      const readReceipt = ReadReceiptFactory.buildForDirectMessageGroup({
        userId,
        directMessageGroupId: dmGroupId,
        lastReadMessageId: messageId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: messageId,
        directMessageGroupId: dmGroupId,
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.readReceipt.findFirst.mockResolvedValue(null);
      mockDatabase.readReceipt.create.mockResolvedValue(readReceipt);

      const result = await service.markAsRead(userId, dto);

      expect(result).toEqual(readReceipt);
      expect(mockDatabase.readReceipt.create).toHaveBeenCalledWith({
        data: {
          userId,
          directMessageGroupId: dmGroupId,
          lastReadMessageId: messageId,
          lastReadAt: expect.any(Date),
        },
      });
    });

    it('should update existing read receipt for a channel', async () => {
      const newMessageId = 'message-456';
      const message = MessageFactory.build({
        id: newMessageId,
        channelId,
        sentAt: new Date('2024-01-02'),
      });
      const existingReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: messageId,
      });
      const currentWatermarkMessage = MessageFactory.build({
        id: messageId,
        channelId,
        sentAt: new Date('2024-01-01'),
      });
      const updatedReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: newMessageId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: newMessageId,
        channelId,
      };

      mockDatabase.message.findUnique
        .mockResolvedValueOnce(message) // Validate incoming message
        .mockResolvedValueOnce(currentWatermarkMessage); // Fetch current watermark
      mockDatabase.readReceipt.findFirst.mockResolvedValue(existingReceipt);
      mockDatabase.readReceipt.update.mockResolvedValue(updatedReceipt);

      const result = await service.markAsRead(userId, dto);

      expect(result).toEqual(updatedReceipt);
      expect(mockDatabase.readReceipt.update).toHaveBeenCalledWith({
        where: { id: existingReceipt.id },
        data: {
          lastReadMessageId: newMessageId,
          lastReadAt: expect.any(Date),
        },
      });
    });

    it('should throw BadRequestException when neither channelId nor directMessageGroupId is provided', async () => {
      const dto: MarkAsReadDto = {
        lastReadMessageId: messageId,
      };

      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        'Must provide exactly one of channelId or directMessageGroupId',
      );
    });

    it('should throw BadRequestException when both channelId and directMessageGroupId are provided', async () => {
      const dto: MarkAsReadDto = {
        lastReadMessageId: messageId,
        channelId,
        directMessageGroupId: dmGroupId,
      };

      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when message does not exist', async () => {
      const dto: MarkAsReadDto = {
        lastReadMessageId: messageId,
        channelId,
      };

      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        'Message not found',
      );
    });

    it('should throw BadRequestException when message does not belong to the specified channel', async () => {
      const wrongChannelId = 'wrong-channel-123';
      const message = MessageFactory.build({
        id: messageId,
        channelId: wrongChannelId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: messageId,
        channelId,
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);

      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        'Message does not belong to the specified channel or DM group',
      );
    });

    it('should not regress watermark when new message is older than current watermark', async () => {
      const olderMessageId = 'message-older';
      const currentMessageId = 'message-current';
      const olderMessage = MessageFactory.build({
        id: olderMessageId,
        channelId,
        sentAt: new Date('2024-01-01'),
      });
      const currentWatermarkMessage = MessageFactory.build({
        id: currentMessageId,
        channelId,
        sentAt: new Date('2024-01-02'),
      });
      const existingReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: currentMessageId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: olderMessageId,
        channelId,
      };

      mockDatabase.message.findUnique
        .mockResolvedValueOnce(olderMessage) // Validate incoming message
        .mockResolvedValueOnce(currentWatermarkMessage); // Fetch current watermark message
      mockDatabase.readReceipt.findFirst.mockResolvedValue(existingReceipt);

      const result = await service.markAsRead(userId, dto);

      expect(result).toEqual(existingReceipt);
      expect(mockDatabase.readReceipt.update).not.toHaveBeenCalled();
      expect(mockDatabase.readReceipt.create).not.toHaveBeenCalled();
    });

    it('should advance watermark when new message is newer than current watermark', async () => {
      const newerMessageId = 'message-newer';
      const currentMessageId = 'message-current';
      const newerMessage = MessageFactory.build({
        id: newerMessageId,
        channelId,
        sentAt: new Date('2024-01-03'),
      });
      const currentWatermarkMessage = MessageFactory.build({
        id: currentMessageId,
        channelId,
        sentAt: new Date('2024-01-02'),
      });
      const existingReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: currentMessageId,
      });
      const updatedReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: newerMessageId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: newerMessageId,
        channelId,
      };

      mockDatabase.message.findUnique
        .mockResolvedValueOnce(newerMessage) // Validate incoming message
        .mockResolvedValueOnce(currentWatermarkMessage); // Fetch current watermark message
      mockDatabase.readReceipt.findFirst.mockResolvedValue(existingReceipt);
      mockDatabase.readReceipt.update.mockResolvedValue(updatedReceipt);

      const result = await service.markAsRead(userId, dto);

      expect(result).toEqual(updatedReceipt);
      expect(mockDatabase.readReceipt.update).toHaveBeenCalledWith({
        where: { id: existingReceipt.id },
        data: {
          lastReadMessageId: newerMessageId,
          lastReadAt: expect.any(Date),
        },
      });
    });

    it('should advance watermark when current watermark message was deleted', async () => {
      const newMessageId = 'message-new';
      const deletedMessageId = 'message-deleted';
      const newMessage = MessageFactory.build({
        id: newMessageId,
        channelId,
        sentAt: new Date('2024-01-01'),
      });
      const existingReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: deletedMessageId,
      });
      const updatedReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: newMessageId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: newMessageId,
        channelId,
      };

      mockDatabase.message.findUnique
        .mockResolvedValueOnce(newMessage) // Validate incoming message
        .mockResolvedValueOnce(null); // Current watermark message was deleted
      mockDatabase.readReceipt.findFirst.mockResolvedValue(existingReceipt);
      mockDatabase.readReceipt.update.mockResolvedValue(updatedReceipt);

      const result = await service.markAsRead(userId, dto);

      expect(result).toEqual(updatedReceipt);
      expect(mockDatabase.readReceipt.update).toHaveBeenCalledWith({
        where: { id: existingReceipt.id },
        data: {
          lastReadMessageId: newMessageId,
          lastReadAt: expect.any(Date),
        },
      });
    });

    it('should throw BadRequestException when message does not belong to the specified DM group', async () => {
      const wrongDmGroupId = 'wrong-dm-group-123';
      const message = MessageFactory.buildDirectMessage({
        id: messageId,
        directMessageGroupId: wrongDmGroupId,
      });

      const dto: MarkAsReadDto = {
        lastReadMessageId: messageId,
        directMessageGroupId: dmGroupId,
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);

      await expect(service.markAsRead(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getUnreadCount', () => {
    const userId = 'user-123';
    const channelId = 'channel-123';
    const dmGroupId = 'dm-group-123';

    it('should return unread count for a channel with existing read receipt', async () => {
      const lastReadMessageId = 'message-100';
      const lastReadMessage = MessageFactory.build({
        id: lastReadMessageId,
        channelId,
        sentAt: new Date('2024-01-01'),
      });
      const readReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId,
      });

      mockDatabase.readReceipt.findFirst.mockResolvedValue(readReceipt);
      mockDatabase.message.findUnique.mockResolvedValue(lastReadMessage);
      mockDatabase.message.count.mockResolvedValue(5);
      mockDatabase.notification.count.mockResolvedValue(2);

      const result = await service.getUnreadCount(userId, channelId);

      expect(result).toEqual({
        channelId,
        directMessageGroupId: undefined,
        unreadCount: 5,
        mentionCount: 2,
        lastReadMessageId,
        lastReadAt: readReceipt.lastReadAt,
      });
      expect(mockDatabase.message.count).toHaveBeenCalledWith({
        where: {
          channelId,
          sentAt: { gt: lastReadMessage.sentAt },
          ...EXCLUDE_THREAD_REPLIES,
        },
      });
      expect(mockDatabase.notification.count).toHaveBeenCalledWith({
        where: {
          userId,
          read: false,
          dismissed: false,
          channelId,
          type: { in: ['USER_MENTION', 'SPECIAL_MENTION'] },
        },
      });
    });

    it('should return unread count for a DM group with existing read receipt', async () => {
      const lastReadMessageId = 'message-200';
      const lastReadMessage = MessageFactory.buildDirectMessage({
        id: lastReadMessageId,
        directMessageGroupId: dmGroupId,
        sentAt: new Date('2024-01-01'),
      });
      const readReceipt = ReadReceiptFactory.buildForDirectMessageGroup({
        userId,
        directMessageGroupId: dmGroupId,
        lastReadMessageId,
      });

      mockDatabase.readReceipt.findFirst.mockResolvedValue(readReceipt);
      mockDatabase.message.findUnique.mockResolvedValue(lastReadMessage);
      mockDatabase.message.count.mockResolvedValue(3);
      mockDatabase.notification.count.mockResolvedValue(1);

      const result = await service.getUnreadCount(userId, undefined, dmGroupId);

      expect(result).toEqual({
        channelId: undefined,
        directMessageGroupId: dmGroupId,
        unreadCount: 3,
        mentionCount: 1,
        lastReadMessageId,
        lastReadAt: readReceipt.lastReadAt,
      });
      expect(mockDatabase.notification.count).toHaveBeenCalledWith({
        where: {
          userId,
          read: false,
          dismissed: false,
          directMessageGroupId: dmGroupId,
          type: { in: ['USER_MENTION', 'SPECIAL_MENTION', 'DIRECT_MESSAGE'] },
        },
      });
    });

    it('should return total message count when no read receipt exists', async () => {
      mockDatabase.readReceipt.findFirst.mockResolvedValue(null);
      mockDatabase.message.count.mockResolvedValue(10);
      mockDatabase.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount(userId, channelId);

      expect(result).toEqual({
        channelId,
        directMessageGroupId: undefined,
        unreadCount: 10,
        mentionCount: 0,
      });
      expect(mockDatabase.message.count).toHaveBeenCalledWith({
        where: { channelId, ...EXCLUDE_THREAD_REPLIES },
      });
    });

    it('should return total message count when last read message was deleted', async () => {
      const lastReadMessageId = 'deleted-message';
      const readReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId,
      });

      mockDatabase.readReceipt.findFirst.mockResolvedValue(readReceipt);
      mockDatabase.message.findUnique.mockResolvedValue(null);
      mockDatabase.message.count.mockResolvedValue(15);
      mockDatabase.notification.count.mockResolvedValue(3);

      const result = await service.getUnreadCount(userId, channelId);

      expect(result).toEqual({
        channelId,
        directMessageGroupId: undefined,
        unreadCount: 15,
        mentionCount: 3,
      });
    });

    it('should throw BadRequestException when neither channelId nor directMessageGroupId is provided', async () => {
      await expect(service.getUnreadCount(userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when both channelId and directMessageGroupId are provided', async () => {
      await expect(
        service.getUnreadCount(userId, channelId, dmGroupId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should exclude thread replies from unread counts', async () => {
      const lastReadMessageId = 'message-100';
      const lastReadMessage = MessageFactory.build({
        id: lastReadMessageId,
        channelId,
        sentAt: new Date('2024-01-01'),
      });
      const readReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId,
      });

      mockDatabase.readReceipt.findFirst.mockResolvedValue(readReceipt);
      mockDatabase.message.findUnique.mockResolvedValue(lastReadMessage);
      mockDatabase.message.count.mockResolvedValue(3);
      mockDatabase.notification.count.mockResolvedValue(0);

      await service.getUnreadCount(userId, channelId);

      expect(mockDatabase.message.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          parentMessageId: null,
        }),
      });
    });
  });

  describe('getUnreadCounts', () => {
    const userId = 'user-123';

    it('should return unread counts for all channels and DM groups', async () => {
      const communityId = 'community-123';
      const channelId1 = 'channel-1';
      const channelId2 = 'channel-2';
      const dmGroupId1 = 'dm-group-1';

      const channel1 = ChannelFactory.build({ id: channelId1 });
      const channel2 = ChannelFactory.build({ id: channelId2 });
      const membership = {
        ...MembershipFactory.build({
          userId,
          communityId,
        }),
        community: {
          id: communityId,
          channels: [channel1, channel2],
        },
      } as any;
      const dmGroup = DirectMessageGroupFactory.build({ id: dmGroupId1 });

      const readReceipt1 = ReadReceiptFactory.buildForChannel({
        userId,
        channelId: channelId1,
        lastReadMessageId: 'msg-1',
      });
      const lastReadMessage1 = MessageFactory.build({
        id: 'msg-1',
        channelId: channelId1,
        sentAt: new Date('2024-01-01'),
      });

      mockDatabase.readReceipt.findMany.mockResolvedValue([readReceipt1]);
      mockDatabase.membership.findMany.mockResolvedValue([membership]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId, groupId: dmGroupId1, group: dmGroup } as any,
      ]);
      // notification.groupBy for mention counts
      mockDatabase.notification.groupBy
        .mockResolvedValueOnce([
          { channelId: channelId1, _count: { channelId: 1 } },
        ])
        .mockResolvedValueOnce([
          {
            directMessageGroupId: dmGroupId1,
            _count: { directMessageGroupId: 2 },
          },
        ]);
      mockDatabase.message.findMany.mockResolvedValue([lastReadMessage1]);
      mockDatabase.message.groupBy
        .mockResolvedValueOnce([
          { channelId: channelId2, _count: { channelId: 5 } },
        ])
        .mockResolvedValueOnce([
          {
            directMessageGroupId: dmGroupId1,
            _count: { directMessageGroupId: 3 },
          },
        ]);
      mockDatabase.message.count.mockResolvedValue(2);

      const result = await service.getUnreadCounts(userId);

      expect(result).toHaveLength(3);
      expect(result).toContainEqual({
        channelId: channelId2,
        unreadCount: 5,
        mentionCount: 0,
      });
      expect(result).toContainEqual({
        directMessageGroupId: dmGroupId1,
        unreadCount: 3,
        mentionCount: 2,
      });
      expect(mockDatabase.message.groupBy).toHaveBeenCalledTimes(2);
    });

    it('should handle channels without read receipts', async () => {
      const communityId = 'community-123';
      const channelId = 'channel-no-receipt';
      const channel = ChannelFactory.build({ id: channelId });
      const membership = {
        ...MembershipFactory.build({
          userId,
          communityId,
        }),
        community: {
          id: communityId,
          channels: [channel],
        },
      } as any;

      mockDatabase.readReceipt.findMany.mockResolvedValue([]);
      mockDatabase.membership.findMany.mockResolvedValue([membership]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.notification.groupBy.mockResolvedValueOnce([
        { channelId, _count: { channelId: 1 } },
      ]);
      mockDatabase.message.findMany.mockResolvedValue([]);
      mockDatabase.message.groupBy
        .mockResolvedValueOnce([{ channelId, _count: { channelId: 10 } }])
        .mockResolvedValueOnce([]);

      const result = await service.getUnreadCounts(userId);

      expect(result).toContainEqual({
        channelId,
        unreadCount: 10,
        mentionCount: 1,
      });
    });

    it('should handle DM groups without read receipts', async () => {
      const dmGroupId = 'dm-group-no-receipt';
      const dmGroup = DirectMessageGroupFactory.build({ id: dmGroupId });

      mockDatabase.readReceipt.findMany.mockResolvedValue([]);
      mockDatabase.membership.findMany.mockResolvedValue([]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([
        { userId, groupId: dmGroupId, group: dmGroup } as any,
      ]);
      mockDatabase.notification.groupBy.mockResolvedValueOnce([
        {
          directMessageGroupId: dmGroupId,
          _count: { directMessageGroupId: 4 },
        },
      ]);
      mockDatabase.message.findMany.mockResolvedValue([]);
      // Since there are no channels, the first groupBy won't be called
      // Only the DM groupBy will be called
      mockDatabase.message.groupBy.mockResolvedValueOnce([
        {
          directMessageGroupId: dmGroupId,
          _count: { directMessageGroupId: 7 },
        },
      ]);

      const result = await service.getUnreadCounts(userId);

      expect(result).toContainEqual({
        directMessageGroupId: dmGroupId,
        unreadCount: 7,
        mentionCount: 4,
      });
    });

    it('should handle deleted last read messages', async () => {
      const communityId = 'community-123';
      const channelId = 'channel-deleted-msg';
      const channel = ChannelFactory.build({ id: channelId });
      const membership = {
        ...MembershipFactory.build({
          userId,
          communityId,
        }),
        community: {
          id: communityId,
          channels: [channel],
        },
      } as any;
      const readReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId: 'deleted-msg',
      });

      mockDatabase.readReceipt.findMany.mockResolvedValue([readReceipt]);
      mockDatabase.membership.findMany.mockResolvedValue([membership]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.notification.groupBy.mockResolvedValueOnce([
        { channelId, _count: { channelId: 2 } },
      ]);
      mockDatabase.message.findMany.mockResolvedValue([]); // No last read message found
      // The channel HAS a read receipt, so channelsWithoutReceipt is empty.
      // The Promise.all groupBy calls skip (empty arrays → Promise.resolve([])).
      // The first actual groupBy call is for channelReceiptsWithoutTimestamp (deleted message).
      mockDatabase.message.groupBy.mockResolvedValue([
        { channelId, _count: { channelId: 20 } },
      ]);

      const result = await service.getUnreadCounts(userId);

      expect(result).toContainEqual({
        channelId,
        unreadCount: 20,
        mentionCount: 2,
      });
    });

    it('should batch queries efficiently (no N+1 problem)', async () => {
      const communityId = 'community-123';
      const channelIds = ['ch-1', 'ch-2', 'ch-3'];
      const channels = channelIds.map((id) => ChannelFactory.build({ id }));
      const membership = {
        ...MembershipFactory.build({
          userId,
          communityId,
        }),
        community: {
          id: communityId,
          channels,
        },
      } as any;

      mockDatabase.readReceipt.findMany.mockResolvedValue([]);
      mockDatabase.membership.findMany.mockResolvedValue([membership]);
      mockDatabase.directMessageGroupMember.findMany.mockResolvedValue([]);
      mockDatabase.notification.groupBy.mockResolvedValueOnce([]);
      mockDatabase.message.findMany.mockResolvedValue([]);
      mockDatabase.message.groupBy
        .mockResolvedValueOnce(
          channelIds.map((id) => ({
            channelId: id,
            _count: { channelId: 5 },
          })),
        )
        .mockResolvedValueOnce([]);

      await service.getUnreadCounts(userId);

      // Should use groupBy for batch counting instead of individual counts
      expect(mockDatabase.message.groupBy).toHaveBeenCalledWith({
        by: ['channelId'],
        where: { channelId: { in: channelIds }, ...EXCLUDE_THREAD_REPLIES },
        _count: { channelId: true },
      });
      // Should NOT call count for each channel individually
      expect(mockDatabase.message.count).not.toHaveBeenCalled();
    });
  });

  describe('getLastReadMessageId', () => {
    const userId = 'user-123';
    const channelId = 'channel-123';
    const dmGroupId = 'dm-group-123';

    it('should return last read message ID for a channel', async () => {
      const lastReadMessageId = 'message-123';
      const readReceipt = ReadReceiptFactory.buildForChannel({
        userId,
        channelId,
        lastReadMessageId,
      });

      mockDatabase.readReceipt.findFirst.mockResolvedValue(readReceipt);

      const result = await service.getLastReadMessageId(userId, channelId);

      expect(result).toBe(lastReadMessageId);
      expect(mockDatabase.readReceipt.findFirst).toHaveBeenCalledWith({
        where: { userId, channelId },
      });
    });

    it('should return last read message ID for a DM group', async () => {
      const lastReadMessageId = 'message-456';
      const readReceipt = ReadReceiptFactory.buildForDirectMessageGroup({
        userId,
        directMessageGroupId: dmGroupId,
        lastReadMessageId,
      });

      mockDatabase.readReceipt.findFirst.mockResolvedValue(readReceipt);

      const result = await service.getLastReadMessageId(
        userId,
        undefined,
        dmGroupId,
      );

      expect(result).toBe(lastReadMessageId);
    });

    it('should return null when no read receipt exists', async () => {
      mockDatabase.readReceipt.findFirst.mockResolvedValue(null);

      const result = await service.getLastReadMessageId(userId, channelId);

      expect(result).toBeNull();
    });

    it('should throw BadRequestException when neither channelId nor directMessageGroupId is provided', async () => {
      await expect(service.getLastReadMessageId(userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when both channelId and directMessageGroupId are provided', async () => {
      await expect(
        service.getLastReadMessageId(userId, channelId, dmGroupId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDmPeerReads', () => {
    const userId = 'user-123';
    const dmGroupId = 'dm-group-123';

    it('should return peer watermarks excluding the requesting user', async () => {
      const peerReads = [
        { userId: 'peer-1', lastReadAt: new Date('2024-01-15') },
        { userId: 'peer-2', lastReadAt: new Date('2024-01-16') },
      ];

      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId: dmGroupId,
        userId,
      });
      mockDatabase.readReceipt.findMany.mockResolvedValue(peerReads);

      const result = await service.getDmPeerReads(userId, dmGroupId);

      expect(result).toEqual(peerReads);
      expect(
        mockDatabase.directMessageGroupMember.findFirst,
      ).toHaveBeenCalledWith({
        where: { groupId: dmGroupId, userId },
      });
      expect(mockDatabase.readReceipt.findMany).toHaveBeenCalledWith({
        where: { directMessageGroupId: dmGroupId, userId: { not: userId } },
        select: { userId: true, lastReadAt: true },
      });
    });

    it('should return empty array when no peers have read receipts', async () => {
      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId: dmGroupId,
        userId,
      });
      mockDatabase.readReceipt.findMany.mockResolvedValue([]);

      const result = await service.getDmPeerReads(userId, dmGroupId);

      expect(result).toEqual([]);
    });

    it('should return multiple peer watermarks for group DMs', async () => {
      const peerReads = [
        { userId: 'peer-1', lastReadAt: new Date('2024-01-15') },
        { userId: 'peer-2', lastReadAt: new Date('2024-01-16') },
        { userId: 'peer-3', lastReadAt: new Date('2024-01-17') },
      ];

      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId: dmGroupId,
        userId,
      });
      mockDatabase.readReceipt.findMany.mockResolvedValue(peerReads);

      const result = await service.getDmPeerReads(userId, dmGroupId);

      expect(result).toHaveLength(3);
    });

    it('should throw ForbiddenException when user is not a member', async () => {
      mockDatabase.directMessageGroupMember.findFirst.mockResolvedValue(null);

      await expect(
        service.getDmPeerReads(userId, dmGroupId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.getDmPeerReads(userId, dmGroupId),
      ).rejects.toThrow('You are not a member of this DM group');
    });
  });

  describe('getMessageReaders', () => {
    const channelId = 'channel-123';
    const messageId = 'message-789';
    const sentAt = new Date('2024-01-15');

    const message = {
      sentAt,
      channelId,
      directMessageGroupId: null,
    };

    const readReceipts = [
      {
        userId: 'user-123',
        channelId,
        lastReadMessageId: messageId,
        lastReadAt: sentAt,
        user: {
          id: 'user-123',
          username: 'self',
          displayName: 'Self',
          avatarUrl: null,
        },
      },
      {
        userId: 'user-456',
        channelId,
        lastReadMessageId: messageId,
        lastReadAt: sentAt,
        user: {
          id: 'user-456',
          username: 'other',
          displayName: 'Other',
          avatarUrl: null,
        },
      },
    ];

    it('should return readers who have read the message', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.readReceipt.findMany.mockResolvedValue(readReceipts);

      const result = await service.getMessageReaders(messageId, channelId);

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        {
          userId: 'user-123',
          username: 'self',
          displayName: 'Self',
          avatarUrl: null,
          readAt: sentAt,
        },
        {
          userId: 'user-456',
          username: 'other',
          displayName: 'Other',
          avatarUrl: null,
          readAt: sentAt,
        },
      ]);
      expect(mockDatabase.message.findUnique).toHaveBeenCalledWith({
        where: { id: messageId },
        select: { sentAt: true, channelId: true, directMessageGroupId: true },
      });
      expect(mockDatabase.readReceipt.findMany).toHaveBeenCalledWith({
        where: {
          channelId,
          lastReadAt: { gte: sentAt },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      });
    });

    it('should exclude the requesting user from readers', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.readReceipt.findMany.mockResolvedValue(readReceipts);

      const result = await service.getMessageReaders(
        messageId,
        channelId,
        undefined,
        'user-123',
      );

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('user-456');
      expect(result).toEqual([
        {
          userId: 'user-456',
          username: 'other',
          displayName: 'Other',
          avatarUrl: null,
          readAt: sentAt,
        },
      ]);
    });

    it('should return all readers when excludeUserId is not provided', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.readReceipt.findMany.mockResolvedValue(readReceipts);

      const result = await service.getMessageReaders(messageId, channelId);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.userId)).toEqual(['user-123', 'user-456']);
    });
  });
});
