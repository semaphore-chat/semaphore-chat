import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/types';
import { SuccessMessageDto } from '@/common/dto/common-response.dto';
import { PushNotificationsService } from './push-notifications.service';
import { SubscribePushDto, UnsubscribePushDto } from './dto/subscribe.dto';
import {
  VapidPublicKeyResponseDto,
  PushStatusResponseDto,
  PushSubscriptionInfoDto,
  TestPushResponseDto,
} from './dto/push-notifications-response.dto';
import { InstanceRole } from '@prisma/client';

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushNotificationsController {
  constructor(
    private readonly pushNotificationsService: PushNotificationsService,
  ) {}

  /**
   * Get the VAPID public key for client subscription
   * Returns null if push notifications are not configured
   */
  @Get('vapid-public-key')
  @ApiOkResponse({ type: VapidPublicKeyResponseDto })
  getVapidPublicKey(): VapidPublicKeyResponseDto {
    const publicKey = this.pushNotificationsService.getVapidPublicKey();
    return {
      publicKey,
      enabled: this.pushNotificationsService.isEnabled(),
    };
  }

  /**
   * Subscribe to push notifications
   */
  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SuccessMessageDto })
  async subscribe(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubscribePushDto,
  ): Promise<SuccessMessageDto> {
    if (!this.pushNotificationsService.isEnabled()) {
      throw new NotFoundException(
        'Push notifications are not configured on this instance',
      );
    }

    await this.pushNotificationsService.subscribe(req.user.id, dto);
    return {
      success: true,
      message: 'Successfully subscribed to push notifications',
    };
  }

  /**
   * Unsubscribe from push notifications
   */
  @Delete('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SuccessMessageDto })
  async unsubscribe(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UnsubscribePushDto,
  ): Promise<SuccessMessageDto> {
    await this.pushNotificationsService.unsubscribe(req.user.id, dto.endpoint);
    return {
      success: true,
      message: 'Successfully unsubscribed from push notifications',
    };
  }

  /**
   * Get current push subscription status
   */
  @Get('status')
  @ApiOkResponse({ type: PushStatusResponseDto })
  async getStatus(
    @Req() req: AuthenticatedRequest,
  ): Promise<PushStatusResponseDto> {
    const subscriptions =
      await this.pushNotificationsService.getUserSubscriptions(req.user.id);
    return {
      enabled: this.pushNotificationsService.isEnabled(),
      subscriptionCount: subscriptions.length,
    };
  }

  /**
   * The current user's push subscriptions, so they can see what still
   * receives their notifications.
   */
  @Get('subscriptions')
  @ApiOkResponse({ type: [PushSubscriptionInfoDto] })
  listSubscriptions(
    @Req() req: AuthenticatedRequest,
  ): Promise<PushSubscriptionInfoDto[]> {
    return this.pushNotificationsService.listUserSubscriptions(req.user.id);
  }

  /**
   * Revoke one of the current user's push subscriptions
   */
  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SuccessMessageDto })
  async revokeSubscription(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SuccessMessageDto> {
    await this.pushNotificationsService.revokeSubscription(req.user.id, id);
    return { success: true, message: 'Push subscription revoked' };
  }

  /**
   * Send a test push notification to the current user
   * POST /push/test
   * Any authenticated user can test their own push notifications
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TestPushResponseDto })
  async sendTestPushToSelf(
    @Req() req: AuthenticatedRequest,
  ): Promise<TestPushResponseDto> {
    if (!this.pushNotificationsService.isEnabled()) {
      throw new NotFoundException(
        'Push notifications are not configured on this instance. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env',
      );
    }

    const result = await this.pushNotificationsService.sendToUser(req.user.id, {
      title: 'Test Push Notification',
      body: 'Push notifications are working! You will receive notifications for mentions and messages.',
      tag: `test-${Date.now()}`,
      data: {
        type: 'TEST',
      },
    });

    return {
      success: result.sent > 0,
      sent: result.sent,
      failed: result.failed,
      message:
        result.sent > 0
          ? `Push notification sent to ${result.sent} device(s)`
          : 'No active push subscriptions found',
    };
  }

  // ============================================================================
  // DEBUG ENDPOINTS (Admin only)
  // ============================================================================

  /**
   * DEBUG: Send a test push notification to the current user
   * POST /push/debug/send-test
   * Only available to OWNER users
   */
  @Post('debug/send-test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TestPushResponseDto })
  async sendTestPush(
    @Req() req: AuthenticatedRequest,
  ): Promise<TestPushResponseDto> {
    if (req.user.role !== InstanceRole.OWNER) {
      throw new ForbiddenException('Debug endpoints are admin-only');
    }

    if (!this.pushNotificationsService.isEnabled()) {
      throw new NotFoundException(
        'Push notifications are not configured on this instance. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env',
      );
    }

    const result = await this.pushNotificationsService.sendToUser(req.user.id, {
      title: 'Test Push Notification',
      body: 'This is a test push notification from the debug panel.',
      tag: `debug-test-${Date.now()}`,
      data: {
        type: 'DEBUG',
      },
    });

    return {
      success: result.sent > 0,
      sent: result.sent,
      failed: result.failed,
      message:
        result.sent > 0
          ? `Push notification sent to ${result.sent} device(s)`
          : 'No active push subscriptions found',
    };
  }
}
