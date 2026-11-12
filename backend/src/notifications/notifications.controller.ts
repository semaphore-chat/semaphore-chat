import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { UpdateChannelOverrideDto } from './dto/update-channel-override.dto';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { SendTestNotificationDto } from './dto/debug-notification.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/types';

import { InstanceRole } from '@prisma/client';
import {
  NotificationDto,
  NotificationListResponseDto,
  UnreadCountResponseDto,
  UserNotificationSettingsDto,
  ChannelNotificationOverrideDto,
  DebugNotificationResponseDto,
  DebugSubscriptionsResponseDto,
  ClearNotificationDataResponseDto,
} from './dto/notification-response.dto';
import { PushNotificationsService } from '@/push-notifications/push-notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  /**
   * Get notifications for current user with pagination
   * GET /notifications?unreadOnly=true&limit=50&offset=0
   */
  @Get()
  @ApiOkResponse({ type: NotificationListResponseDto })
  async getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationListResponseDto> {
    const [notifications, total] = await Promise.all([
      this.notificationsService.getUserNotifications(req.user.id, query),
      this.notificationsService.countUserNotifications(req.user.id, query),
    ]);
    const unreadCount = await this.notificationsService.getUnreadCount(
      req.user.id,
    );

    // Return response matching frontend NotificationListResponse interface
    return {
      notifications: notifications.map(({ channel, ...notification }) => ({
        ...notification,
        communityId: channel?.communityId ?? null,
        channelName: channel?.name ?? null,
      })),
      total,
      unreadCount,
    };
  }

  /**
   * Get unread notification count
   * GET /notifications/unread-count
   */
  @Get('unread-count')
  @ApiOkResponse({ type: UnreadCountResponseDto })
  async getUnreadCount(
    @Req() req: AuthenticatedRequest,
  ): Promise<UnreadCountResponseDto> {
    const count = await this.notificationsService.getUnreadCount(req.user.id);
    return { count };
  }

  /**
   * Mark a notification as read
   * POST /notifications/:id/read
   */
  @Post(':id/read')
  @HttpCode(200)
  @ApiOkResponse({ type: NotificationDto })
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ): Promise<NotificationDto> {
    return this.notificationsService.markAsRead(notificationId, req.user.id);
  }

  /**
   * Mark all notifications as read
   * POST /notifications/read-all
   */
  @Post('read-all')
  @HttpCode(200)
  @ApiOkResponse({ type: UnreadCountResponseDto })
  async markAllAsRead(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ count: number }> {
    return this.notificationsService.markAllAsRead(req.user.id);
  }

  /**
   * Dismiss a notification
   * POST /notifications/:id/dismiss
   */
  @Post(':id/dismiss')
  @HttpCode(200)
  @ApiOkResponse({ type: NotificationDto })
  async dismissNotification(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ): Promise<NotificationDto> {
    return this.notificationsService.dismissNotification(
      notificationId,
      req.user.id,
    );
  }

  /**
   * Delete a notification
   * DELETE /notifications/:id
   */
  @Delete(':id')
  @HttpCode(204)
  async deleteNotification(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ): Promise<void> {
    await this.notificationsService.deleteNotification(
      notificationId,
      req.user.id,
    );
  }

  /**
   * Get user notification settings
   * GET /notifications/settings
   */
  @Get('settings')
  @ApiOkResponse({ type: UserNotificationSettingsDto })
  async getSettings(
    @Req() req: AuthenticatedRequest,
  ): Promise<UserNotificationSettingsDto> {
    return this.notificationsService.getUserSettings(req.user.id);
  }

  /**
   * Update user notification settings
   * PUT /notifications/settings
   */
  @Put('settings')
  @ApiOkResponse({ type: UserNotificationSettingsDto })
  async updateSettings(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateNotificationSettingsDto,
  ): Promise<UserNotificationSettingsDto> {
    return this.notificationsService.updateUserSettings(req.user.id, dto);
  }

  /**
   * Get channel notification override
   * GET /notifications/channels/:channelId/override
   */
  @Get('channels/:channelId/override')
  @ApiOkResponse({ type: ChannelNotificationOverrideDto })
  async getChannelOverride(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelNotificationOverrideDto | null> {
    return this.notificationsService.getChannelOverride(req.user.id, channelId);
  }

  /**
   * Set channel notification override
   * PUT /notifications/channels/:channelId/override
   */
  @Put('channels/:channelId/override')
  @ApiOkResponse({ type: ChannelNotificationOverrideDto })
  async setChannelOverride(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdateChannelOverrideDto,
  ): Promise<ChannelNotificationOverrideDto> {
    return this.notificationsService.setChannelOverride(
      req.user.id,
      channelId,
      dto,
    );
  }

  /**
   * Delete channel notification override
   * DELETE /notifications/channels/:channelId/override
   */
  @Delete('channels/:channelId/override')
  @HttpCode(204)
  async deleteChannelOverride(
    @Req() req: AuthenticatedRequest,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<void> {
    await this.notificationsService.deleteChannelOverride(
      req.user.id,
      channelId,
    );
  }

  // ============================================================================
  // DEBUG ENDPOINTS (Admin only)
  // ============================================================================

  /**
   * Check if user is instance owner (used for debug endpoint access)
   */
  private assertOwner(req: AuthenticatedRequest): void {
    if (req.user.role !== InstanceRole.OWNER) {
      throw new ForbiddenException('Debug endpoints are admin-only');
    }
  }

  /**
   * DEBUG: Send a test notification to the current user
   * POST /notifications/debug/send-test
   * Only available to OWNER users
   */
  @Post('debug/send-test')
  @HttpCode(200)
  @ApiOkResponse({ type: DebugNotificationResponseDto })
  async sendTestNotification(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendTestNotificationDto,
  ): Promise<DebugNotificationResponseDto> {
    this.assertOwner(req);
    const notification = await this.notificationsService.createTestNotification(
      req.user.id,
      dto.type,
    );
    return {
      success: true,
      notification,
      message: `Test ${dto.type} notification created`,
    };
  }

  /**
   * DEBUG: Get all push subscriptions for current user
   * GET /notifications/debug/subscriptions
   * Only available to OWNER users
   */
  @Get('debug/subscriptions')
  @ApiOkResponse({ type: DebugSubscriptionsResponseDto })
  async getDebugSubscriptions(
    @Req() req: AuthenticatedRequest,
  ): Promise<DebugSubscriptionsResponseDto> {
    this.assertOwner(req);
    const subscriptions =
      await this.pushNotificationsService.getUserSubscriptions(req.user.id);
    return {
      subscriptions,
      count: subscriptions.length,
      pushEnabled: this.pushNotificationsService.isEnabled(),
    };
  }

  /**
   * DEBUG: Clear all notification settings for current user
   * DELETE /notifications/debug/clear-all
   * Only available to OWNER users
   */
  @Delete('debug/clear-all')
  @HttpCode(200)
  @ApiOkResponse({ type: ClearNotificationDataResponseDto })
  async clearDebugSettings(
    @Req() req: AuthenticatedRequest,
  ): Promise<ClearNotificationDataResponseDto> {
    this.assertOwner(req);
    const result = await this.notificationsService.clearUserNotificationData(
      req.user.id,
    );
    return {
      success: true,
      ...result,
      message: 'All notification data cleared',
    };
  }
}
