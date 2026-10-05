import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MessageAttachmentStrategy } from './message-attachment.strategy';
import { DatabaseService } from '@/database/database.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { createMockDatabase } from '@/test-utils';

describe('MessageAttachmentStrategy', () => {
  let strategy: MessageAttachmentStrategy;
  let mockDatabase: any;
  let channelAccessService: Mocked<ChannelAccessService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(MessageAttachmentStrategy)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    strategy = unit;
    channelAccessService = unitRef.get(ChannelAccessService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('checkAccess', () => {
    it('should throw NotFoundException when message not found', async () => {
      mockDatabase.message.findUnique.mockResolvedValue(null);

      await expect(
        strategy.checkAccess('user-123', 'message-456', 'file-789'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        strategy.checkAccess('user-123', 'message-456', 'file-789'),
      ).rejects.toThrow('Message not found');
    });

    it('grants access to a channel message when the user can view the channel', async () => {
      mockDatabase.message.findUnique.mockResolvedValue({
        id: 'message-1',
        channelId: 'channel-1',
        directMessageGroupId: null,
      });
      mockDatabase.channel.findUnique.mockResolvedValue({ id: 'channel-1' });
      channelAccessService.canViewChannel.mockResolvedValue(true);

      const result = await strategy.checkAccess(
        'user-1',
        'message-1',
        'file-1',
      );

      expect(result).toBe(true);
      expect(channelAccessService.canViewChannel).toHaveBeenCalledWith(
        'user-1',
        'channel-1',
      );
    });

    it('denies access when the user cannot view the channel (private non-member, non-member of the community)', async () => {
      mockDatabase.message.findUnique.mockResolvedValue({
        id: 'message-1',
        channelId: 'channel-1',
        directMessageGroupId: null,
      });
      mockDatabase.channel.findUnique.mockResolvedValue({ id: 'channel-1' });
      channelAccessService.canViewChannel.mockResolvedValue(false);

      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow(
        'You must be able to view this channel to access this file',
      );
    });

    it('should grant access for DM group message when user is group member', async () => {
      const message = {
        id: 'message-1',
        channelId: null,
        directMessageGroupId: 'dm-group-1',
      };

      const dmMembership = {
        groupId: 'dm-group-1',
        userId: 'user-1',
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue(
        dmMembership,
      );

      const result = await strategy.checkAccess(
        'user-1',
        'message-1',
        'file-1',
      );

      expect(result).toBe(true);
      expect(
        mockDatabase.directMessageGroupMember.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          groupId_userId: {
            groupId: 'dm-group-1',
            userId: 'user-1',
          },
        },
      });
    });

    it('should throw ForbiddenException for DM group when user is not group member', async () => {
      const message = {
        id: 'message-1',
        channelId: null,
        directMessageGroupId: 'dm-group-1',
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue(null);

      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow(
        'You must be a member of this conversation to access this file',
      );
    });

    it('should throw ForbiddenException when message has no channel or DM group', async () => {
      const message = {
        id: 'message-1',
        channelId: null,
        directMessageGroupId: null,
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);

      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow('Access denied');
    });

    it('should throw NotFoundException when channel not found', async () => {
      const message = {
        id: 'message-1',
        channelId: 'channel-1',
        directMessageGroupId: null,
      };

      mockDatabase.message.findUnique.mockResolvedValue(message);
      mockDatabase.channel.findUnique.mockResolvedValue(null);

      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        strategy.checkAccess('user-1', 'message-1', 'file-1'),
      ).rejects.toThrow('Channel not found');
    });
  });
});
