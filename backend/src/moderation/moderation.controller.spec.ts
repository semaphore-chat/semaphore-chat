import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { BadRequestException } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ModerationAction } from '@prisma/client';

describe('ModerationController', () => {
  let controller: ModerationController;
  let moderationService: Mocked<ModerationService>;

  const userId = 'mod-user-123';
  const mockReq = { user: { id: userId } } as any;
  const communityId = 'community-123';
  const targetUserId = 'target-user-456';

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(ModerationController).compile();

    controller = unit;
    moderationService = unitRef.get(ModerationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // =========================================
  // BAN ENDPOINTS
  // =========================================

  describe('banUser', () => {
    it('should ban user and return success', async () => {
      const dto = { reason: 'Spam' };
      moderationService.banUser.mockResolvedValue(undefined);

      const result = await controller.banUser(
        communityId,
        targetUserId,
        dto,
        mockReq,
      );

      expect(result).toEqual({
        success: true,
        message: 'User banned successfully',
      });
      expect(moderationService.banUser).toHaveBeenCalledWith(
        communityId,
        targetUserId,
        userId,
        'Spam',
        undefined,
      );
    });

    it('should pass expiration date when provided', async () => {
      const expiresAt = '2026-12-31T23:59:59Z';
      const dto = { reason: 'Temp ban', expiresAt };
      moderationService.banUser.mockResolvedValue(undefined);

      await controller.banUser(communityId, targetUserId, dto, mockReq);

      expect(moderationService.banUser).toHaveBeenCalledWith(
        communityId,
        targetUserId,
        userId,
        'Temp ban',
        new Date(expiresAt),
      );
    });
  });

  describe('unbanUser', () => {
    it('should unban user and return success', async () => {
      const dto = { reason: 'Appeal accepted' };
      moderationService.unbanUser.mockResolvedValue(undefined);

      const result = await controller.unbanUser(
        communityId,
        targetUserId,
        dto,
        mockReq,
      );

      expect(result).toEqual({
        success: true,
        message: 'User unbanned successfully',
      });
      expect(moderationService.unbanUser).toHaveBeenCalledWith(
        communityId,
        targetUserId,
        userId,
        'Appeal accepted',
        mockReq.user.role,
      );
    });
  });

  describe('getBanList', () => {
    it('should return ban list', async () => {
      const banList = [
        { id: 'ban-1', communityId, userId: 'banned-user' },
      ] as any;
      moderationService.getBanList.mockResolvedValue(banList);

      const result = await controller.getBanList(communityId);

      expect(result).toEqual(banList);
      expect(moderationService.getBanList).toHaveBeenCalledWith(communityId);
    });
  });

  // =========================================
  // KICK ENDPOINT
  // =========================================

  describe('kickUser', () => {
    it('should kick user and return success', async () => {
      const dto = { reason: 'Disruption' };
      moderationService.kickUser.mockResolvedValue(undefined);

      const result = await controller.kickUser(
        communityId,
        targetUserId,
        dto,
        mockReq,
      );

      expect(result).toEqual({
        success: true,
        message: 'User kicked successfully',
      });
      expect(moderationService.kickUser).toHaveBeenCalledWith(
        communityId,
        targetUserId,
        userId,
        'Disruption',
      );
    });
  });

  // =========================================
  // TIMEOUT ENDPOINTS
  // =========================================

  describe('timeoutUser', () => {
    it('should timeout user and return success', async () => {
      const dto = { durationSeconds: 300, reason: 'Cool down' };
      moderationService.timeoutUser.mockResolvedValue(undefined);

      const result = await controller.timeoutUser(
        communityId,
        targetUserId,
        dto,
        mockReq,
      );

      expect(result).toEqual({
        success: true,
        message: 'User timed out successfully',
      });
      expect(moderationService.timeoutUser).toHaveBeenCalledWith(
        communityId,
        targetUserId,
        userId,
        300,
        'Cool down',
      );
    });
  });

  describe('removeTimeout', () => {
    it('should remove timeout and return success', async () => {
      const dto = { reason: 'Forgiven' };
      moderationService.removeTimeout.mockResolvedValue(undefined);

      const result = await controller.removeTimeout(
        communityId,
        targetUserId,
        dto,
        mockReq,
      );

      expect(result).toEqual({
        success: true,
        message: 'Timeout removed successfully',
      });
    });
  });

  describe('getTimeoutList', () => {
    it('should return timeout list', async () => {
      const timeoutList = [
        { id: 'to-1', communityId, userId: 'timed-out-user' },
      ] as any;
      moderationService.getTimeoutList.mockResolvedValue(timeoutList);

      const result = await controller.getTimeoutList(communityId);

      expect(result).toEqual(timeoutList);
    });
  });

  describe('getTimeoutStatus', () => {
    it('should return timeout status for user', async () => {
      const status = { isTimedOut: true, expiresAt: new Date() } as any;
      moderationService.isUserTimedOut.mockResolvedValue(status);

      const result = await controller.getTimeoutStatus(
        communityId,
        targetUserId,
      );

      expect(result).toEqual(status);
      expect(moderationService.isUserTimedOut).toHaveBeenCalledWith(
        communityId,
        targetUserId,
      );
    });
  });

  // =========================================
  // MESSAGE PINNING ENDPOINTS
  // =========================================

  describe('pinMessage', () => {
    it('should pin message and return success', async () => {
      const messageId = 'msg-123';
      const dto = { reason: 'Important announcement' };
      moderationService.pinMessage.mockResolvedValue(undefined);

      const result = await controller.pinMessage(messageId, dto, mockReq);

      expect(result).toEqual({
        success: true,
        message: 'Message pinned successfully',
      });
      expect(moderationService.pinMessage).toHaveBeenCalledWith(
        messageId,
        userId,
        'Important announcement',
      );
    });
  });

  describe('unpinMessage', () => {
    it('should unpin message and return success', async () => {
      const messageId = 'msg-123';
      const dto = { reason: 'No longer relevant' };
      moderationService.unpinMessage.mockResolvedValue(undefined);

      const result = await controller.unpinMessage(messageId, dto, mockReq);

      expect(result).toEqual({
        success: true,
        message: 'Message unpinned successfully',
      });
    });
  });

  describe('getPinnedMessages', () => {
    it('should return pinned messages for channel', async () => {
      const channelId = 'channel-123';
      const pinnedMessages = [{ id: 'msg-1', pinned: true }] as any;
      moderationService.getPinnedMessages.mockResolvedValue(pinnedMessages);

      const result = await controller.getPinnedMessages(channelId);

      expect(result).toEqual(pinnedMessages);
      expect(moderationService.getPinnedMessages).toHaveBeenCalledWith(
        channelId,
      );
    });
  });

  // =========================================
  // MESSAGE DELETION ENDPOINT
  // =========================================

  describe('deleteMessageAsMod', () => {
    it('should delete message and return success', async () => {
      const messageId = 'msg-123';
      const dto = { reason: 'Rule violation' };
      moderationService.deleteMessageAsMod.mockResolvedValue(undefined);

      const result = await controller.deleteMessageAsMod(
        messageId,
        dto,
        mockReq,
      );

      expect(result).toEqual({
        success: true,
        message: 'Message deleted successfully',
      });
      expect(moderationService.deleteMessageAsMod).toHaveBeenCalledWith(
        messageId,
        userId,
        'Rule violation',
      );
    });
  });

  // =========================================
  // MODERATION LOGS ENDPOINT
  // =========================================

  describe('getModerationLogs', () => {
    it('should return logs with default pagination', async () => {
      const mockLogs = { logs: [], total: 0 } as any;
      moderationService.getModerationLogs.mockResolvedValue(mockLogs);

      const result = await controller.getModerationLogs(
        communityId,
        50,
        0,
        undefined,
      );

      expect(result).toEqual(mockLogs);
      expect(moderationService.getModerationLogs).toHaveBeenCalledWith(
        communityId,
        { limit: 50, offset: 0, action: undefined },
      );
    });

    it('should pass action filter when provided', async () => {
      const mockLogs = { logs: [], total: 0 } as any;
      moderationService.getModerationLogs.mockResolvedValue(mockLogs);

      await controller.getModerationLogs(
        communityId,
        20,
        10,
        ModerationAction.BAN_USER,
      );

      expect(moderationService.getModerationLogs).toHaveBeenCalledWith(
        communityId,
        { limit: 20, offset: 10, action: ModerationAction.BAN_USER },
      );
    });

    it('treats an empty action filter as no filter', async () => {
      moderationService.getModerationLogs.mockResolvedValue({
        logs: [],
        total: 0,
      });

      await controller.getModerationLogs(communityId, 50, 0, '');

      expect(moderationService.getModerationLogs).toHaveBeenCalledWith(
        communityId,
        { limit: 50, offset: 0, action: undefined },
      );
    });

    it('rejects an action value the contract does not list (#687)', async () => {
      await expect(
        controller.getModerationLogs(communityId, 50, 0, 'NOT_AN_ACTION'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(moderationService.getModerationLogs).not.toHaveBeenCalled();
    });
  });
});
