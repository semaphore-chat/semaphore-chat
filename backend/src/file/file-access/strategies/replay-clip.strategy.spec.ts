import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ForbiddenException } from '@nestjs/common';
import { ReplayClipAccessStrategy } from './replay-clip.strategy';
import { DatabaseService } from '@/database/database.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { createMockDatabase } from '@/test-utils';

describe('ReplayClipAccessStrategy', () => {
  let strategy: ReplayClipAccessStrategy;
  let mockDatabase: any;
  let channelAccessService: Mocked<ChannelAccessService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(ReplayClipAccessStrategy)
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
    describe('owner access', () => {
      it('should grant access when user is the clip owner', async () => {
        const userId = 'user-123';
        const clipOwnerId = 'user-123';
        const fileId = 'file-456';

        const result = await strategy.checkAccess(userId, clipOwnerId, fileId);

        expect(result).toBe(true);
        // Should not need to check database when user is owner
        expect(mockDatabase.replayClip.findFirst).not.toHaveBeenCalled();
        expect(mockDatabase.message.findMany).not.toHaveBeenCalled();
      });
    });

    describe('public clip access', () => {
      it('should grant access when clip is public', async () => {
        const userId = 'user-123';
        const clipOwnerId = 'user-456'; // Different owner
        const fileId = 'file-789';

        mockDatabase.replayClip.findFirst.mockResolvedValue({
          isPublic: true,
        });

        const result = await strategy.checkAccess(userId, clipOwnerId, fileId);

        expect(result).toBe(true);
        expect(mockDatabase.replayClip.findFirst).toHaveBeenCalledWith({
          where: { fileId },
          select: { isPublic: true },
        });
        // Should not check message access when clip is public
        expect(mockDatabase.message.findMany).not.toHaveBeenCalled();
      });

      it('should continue checking when clip is not public', async () => {
        const userId = 'user-123';
        const clipOwnerId = 'user-456';
        const fileId = 'file-789';

        mockDatabase.replayClip.findFirst.mockResolvedValue({
          isPublic: false,
        });
        mockDatabase.message.findMany.mockResolvedValue([]);

        await expect(
          strategy.checkAccess(userId, clipOwnerId, fileId),
        ).rejects.toThrow(ForbiddenException);

        expect(mockDatabase.message.findMany).toHaveBeenCalled();
      });

      it('should handle clip not found in database', async () => {
        const userId = 'user-123';
        const clipOwnerId = 'user-456';
        const fileId = 'file-789';

        mockDatabase.replayClip.findFirst.mockResolvedValue(null);
        mockDatabase.message.findMany.mockResolvedValue([]);

        await expect(
          strategy.checkAccess(userId, clipOwnerId, fileId),
        ).rejects.toThrow(ForbiddenException);
      });
    });

    describe('message-based access', () => {
      beforeEach(() => {
        mockDatabase.replayClip.findFirst.mockResolvedValue({
          isPublic: false,
        });
      });

      it('should deny access when file is not attached to any message', async () => {
        mockDatabase.message.findMany.mockResolvedValue([]);

        await expect(
          strategy.checkAccess('user-123', 'user-456', 'file-789'),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          strategy.checkAccess('user-123', 'user-456', 'file-789'),
        ).rejects.toThrow('Access denied');
      });

      describe('channel message access', () => {
        it('should grant access when the user can view the channel', async () => {
          mockDatabase.message.findMany.mockResolvedValue([
            {
              id: 'message-1',
              channelId: 'channel-1',
              directMessageGroupId: null,
            },
          ]);
          channelAccessService.canViewChannel.mockResolvedValue(true);

          const result = await strategy.checkAccess(
            'user-123',
            'user-456',
            'file-789',
          );

          expect(result).toBe(true);
          expect(channelAccessService.canViewChannel).toHaveBeenCalledWith(
            'user-123',
            'channel-1',
          );
        });

        it('should deny access when the user cannot view the channel', async () => {
          mockDatabase.message.findMany.mockResolvedValue([
            {
              id: 'message-1',
              channelId: 'channel-1',
              directMessageGroupId: null,
            },
          ]);
          channelAccessService.canViewChannel.mockResolvedValue(false);

          await expect(
            strategy.checkAccess('user-123', 'user-456', 'file-789'),
          ).rejects.toThrow(ForbiddenException);
        });

        it('should handle channel not found', async () => {
          const message = {
            id: 'message-1',
            channelId: 'channel-1',
            directMessageGroupId: null,
          };

          mockDatabase.message.findMany.mockResolvedValue([message]);
          mockDatabase.channel.findUnique.mockResolvedValue(null);

          await expect(
            strategy.checkAccess('user-123', 'user-456', 'file-789'),
          ).rejects.toThrow(ForbiddenException);
        });
      });

      describe('DM group message access', () => {
        it('should grant access when user is DM group member', async () => {
          const message = {
            id: 'message-1',
            channelId: null,
            directMessageGroupId: 'dm-group-1',
          };

          mockDatabase.message.findMany.mockResolvedValue([message]);
          mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue({
            groupId: 'dm-group-1',
            userId: 'user-123',
          });

          const result = await strategy.checkAccess(
            'user-123',
            'user-456',
            'file-789',
          );

          expect(result).toBe(true);
          expect(
            mockDatabase.directMessageGroupMember.findUnique,
          ).toHaveBeenCalledWith({
            where: {
              groupId_userId: {
                groupId: 'dm-group-1',
                userId: 'user-123',
              },
            },
          });
        });

        it('should deny access when user is not DM group member', async () => {
          const message = {
            id: 'message-1',
            channelId: null,
            directMessageGroupId: 'dm-group-1',
          };

          mockDatabase.message.findMany.mockResolvedValue([message]);
          mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue(
            null,
          );

          await expect(
            strategy.checkAccess('user-123', 'user-456', 'file-789'),
          ).rejects.toThrow(ForbiddenException);
        });
      });

      describe('multiple messages', () => {
        it('should grant access if user has access to any message containing the file', async () => {
          const messages = [
            {
              id: 'message-1',
              channelId: 'channel-1',
              directMessageGroupId: null,
            },
            {
              id: 'message-2',
              channelId: 'channel-2',
              directMessageGroupId: null,
            },
          ];

          const channel1 = {
            id: 'channel-1',
            communityId: 'community-1',
            isPrivate: false,
          };

          const channel2 = {
            id: 'channel-2',
            communityId: 'community-2',
            isPrivate: false,
          };

          mockDatabase.message.findMany.mockResolvedValue(messages);
          mockDatabase.channel.findUnique
            .mockResolvedValueOnce(channel1)
            .mockResolvedValueOnce(channel2);
          channelAccessService.canViewChannel
            .mockResolvedValueOnce(false) // Can't view the first channel
            .mockResolvedValueOnce(true); // Can view the second

          const result = await strategy.checkAccess(
            'user-123',
            'user-456',
            'file-789',
          );

          expect(result).toBe(true);
        });

        it('should deny access if user has no access to any message', async () => {
          const messages = [
            {
              id: 'message-1',
              channelId: 'channel-1',
              directMessageGroupId: null,
            },
            {
              id: 'message-2',
              channelId: null,
              directMessageGroupId: 'dm-group-1',
            },
          ];

          const channel1 = {
            id: 'channel-1',
            communityId: 'community-1',
            isPrivate: false,
          };

          mockDatabase.message.findMany.mockResolvedValue(messages);
          mockDatabase.channel.findUnique.mockResolvedValue(channel1);
          channelAccessService.canViewChannel.mockResolvedValue(false);
          mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue(
            null,
          );

          await expect(
            strategy.checkAccess('user-123', 'user-456', 'file-789'),
          ).rejects.toThrow(ForbiddenException);
        });

        it('should continue checking when membership check throws error', async () => {
          const messages = [
            {
              id: 'message-1',
              channelId: 'channel-1',
              directMessageGroupId: null,
            },
            {
              id: 'message-2',
              channelId: null,
              directMessageGroupId: 'dm-group-1',
            },
          ];

          const channel1 = {
            id: 'channel-1',
            communityId: 'community-1',
            isPrivate: false,
          };

          mockDatabase.message.findMany.mockResolvedValue(messages);
          mockDatabase.channel.findUnique.mockResolvedValue(channel1);
          // First check throws error
          channelAccessService.canViewChannel.mockRejectedValueOnce(
            new Error('Database error'),
          );
          // Second check succeeds
          mockDatabase.directMessageGroupMember.findUnique.mockResolvedValue({
            groupId: 'dm-group-1',
            userId: 'user-123',
          });

          const result = await strategy.checkAccess(
            'user-123',
            'user-456',
            'file-789',
          );

          expect(result).toBe(true);
        });
      });
    });
  });
});
