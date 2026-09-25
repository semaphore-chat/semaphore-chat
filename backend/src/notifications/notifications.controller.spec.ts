import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ForbiddenException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from '@/push-notifications/push-notifications.service';
import { InstanceRole } from '@prisma/client';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let notificationsService: Mocked<NotificationsService>;
  let pushNotificationsService: Mocked<PushNotificationsService>;

  const userId = 'user-123';
  const mockReq = { user: { id: userId, role: InstanceRole.USER } } as any;
  const ownerReq = { user: { id: userId, role: InstanceRole.OWNER } } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      NotificationsController,
    ).compile();

    controller = unit;
    notificationsService = unitRef.get(NotificationsService);
    pushNotificationsService = unitRef.get(PushNotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getNotifications', () => {
    it('should return notifications with unread count', async () => {
      const mockNotifications = [
        {
          id: 'n-1',
          type: 'MENTION',
          read: false,
          channel: { communityId: 'c-1' },
        },
      ] as any;

      notificationsService.getUserNotifications.mockResolvedValue(
        mockNotifications,
      );
      notificationsService.getUnreadCount.mockResolvedValue(5);

      const query = { unreadOnly: false, limit: 50, offset: 0 };
      const result = await controller.getNotifications(mockReq, query);

      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].communityId).toBe('c-1');
      expect(result.unreadCount).toBe(5);
      expect(notificationsService.getUserNotifications).toHaveBeenCalledWith(
        userId,
        query,
      );
    });

    it('should handle null channel gracefully', async () => {
      const mockNotifications = [
        { id: 'n-1', type: 'DM', read: false, channel: null },
      ] as any;

      notificationsService.getUserNotifications.mockResolvedValue(
        mockNotifications,
      );
      notificationsService.getUnreadCount.mockResolvedValue(1);

      const result = await controller.getNotifications(mockReq, {});

      expect(result.notifications[0].communityId).toBeNull();
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count', async () => {
      notificationsService.getUnreadCount.mockResolvedValue(42);

      const result = await controller.getUnreadCount(mockReq);

      expect(result).toEqual({ count: 42 });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notificationId = 'n-123';
      const mockNotification = { id: notificationId, read: true } as any;

      notificationsService.markAsRead.mockResolvedValue(mockNotification);

      const result = await controller.markAsRead(mockReq, notificationId);

      expect(result).toEqual(mockNotification);
      expect(notificationsService.markAsRead).toHaveBeenCalledWith(
        notificationId,
        userId,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all as read and return count', async () => {
      notificationsService.markAllAsRead.mockResolvedValue({ count: 10 });

      const result = await controller.markAllAsRead(mockReq);

      expect(result).toEqual({ count: 10 });
    });
  });

  describe('dismissNotification', () => {
    it('should dismiss notification', async () => {
      const notificationId = 'n-123';
      const mockNotification = {
        id: notificationId,
        dismissed: true,
      } as any;

      notificationsService.dismissNotification.mockResolvedValue(
        mockNotification,
      );

      const result = await controller.dismissNotification(
        mockReq,
        notificationId,
      );

      expect(result).toEqual(mockNotification);
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification', async () => {
      const notificationId = 'n-123';
      notificationsService.deleteNotification.mockResolvedValue(undefined);

      await controller.deleteNotification(mockReq, notificationId);

      expect(notificationsService.deleteNotification).toHaveBeenCalledWith(
        notificationId,
        userId,
      );
    });
  });

  describe('getSettings', () => {
    it('should return user notification settings', async () => {
      const mockSettings = { userId, muteAll: false } as any;
      notificationsService.getUserSettings.mockResolvedValue(mockSettings);

      const result = await controller.getSettings(mockReq);

      expect(result).toEqual(mockSettings);
    });
  });

  describe('updateSettings', () => {
    it('should update and return settings', async () => {
      const dto = { muteAll: true };
      const mockSettings = { userId, muteAll: true } as any;
      notificationsService.updateUserSettings.mockResolvedValue(mockSettings);

      const result = await controller.updateSettings(mockReq, dto as any);

      expect(result).toEqual(mockSettings);
      expect(notificationsService.updateUserSettings).toHaveBeenCalledWith(
        userId,
        dto,
      );
    });
  });

  describe('getChannelOverride', () => {
    it('should return channel override', async () => {
      const channelId = 'ch-123';
      const mockOverride = { channelId, muted: true } as any;
      notificationsService.getChannelOverride.mockResolvedValue(mockOverride);

      const result = await controller.getChannelOverride(mockReq, channelId);

      expect(result).toEqual(mockOverride);
    });
  });

  describe('setChannelOverride', () => {
    it('should set and return channel override', async () => {
      const channelId = 'ch-123';
      const dto = { muted: true };
      const mockOverride = { channelId, muted: true } as any;
      notificationsService.setChannelOverride.mockResolvedValue(mockOverride);

      const result = await controller.setChannelOverride(
        mockReq,
        channelId,
        dto as any,
      );

      expect(result).toEqual(mockOverride);
    });
  });

  describe('deleteChannelOverride', () => {
    it('should delete channel override', async () => {
      const channelId = 'ch-123';
      notificationsService.deleteChannelOverride.mockResolvedValue(undefined);

      await controller.deleteChannelOverride(mockReq, channelId);

      expect(notificationsService.deleteChannelOverride).toHaveBeenCalledWith(
        userId,
        channelId,
      );
    });
  });

  // ============================================================================
  // DEBUG ENDPOINTS (Admin only)
  // ============================================================================

  describe('sendTestNotification', () => {
    it('should create test notification for owner', async () => {
      const dto = { type: 'MENTION' };
      const mockNotification = { id: 'n-test', type: 'MENTION' } as any;

      notificationsService.createTestNotification.mockResolvedValue(
        mockNotification,
      );

      const result = await controller.sendTestNotification(
        ownerReq,
        dto as any,
      );

      expect(result.success).toBe(true);
      expect(result.notification).toEqual(mockNotification);
    });

    it('should throw ForbiddenException for non-owner', async () => {
      const dto = { type: 'MENTION' };

      await expect(
        controller.sendTestNotification(mockReq, dto as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getDebugSubscriptions', () => {
    it('should return subscriptions for owner', async () => {
      const mockSubs = [{ id: 'sub-1' }] as any;
      pushNotificationsService.getUserSubscriptions.mockResolvedValue(mockSubs);
      pushNotificationsService.isEnabled.mockReturnValue(true);

      const result = await controller.getDebugSubscriptions(ownerReq);

      expect(result.subscriptions).toEqual(mockSubs);
      expect(result.count).toBe(1);
      expect(result.pushEnabled).toBe(true);
    });

    it('should throw ForbiddenException for non-owner', async () => {
      await expect(controller.getDebugSubscriptions(mockReq)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('clearDebugSettings', () => {
    it('should clear data for owner', async () => {
      const mockResult = {
        notificationsDeleted: 5,
        settingsDeleted: 1,
        overridesDeleted: 2,
      };
      notificationsService.clearUserNotificationData.mockResolvedValue(
        mockResult,
      );

      const result = await controller.clearDebugSettings(ownerReq);

      expect(result.success).toBe(true);
      expect(result.message).toBe('All notification data cleared');
    });

    it('should throw ForbiddenException for non-owner', async () => {
      await expect(controller.clearDebugSettings(mockReq)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
