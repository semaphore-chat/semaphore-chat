import { NotificationType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationTypeValues } from '@/common/enums/swagger-enums';
import { SpanDto } from '@/messages/dto/message-response.dto';

export class UserNotificationSettingsDto {
  id: string;
  userId: string;
  desktopEnabled: boolean;
  playSound: boolean;
  soundType: string;
  doNotDisturb: boolean;
  dndStartTime: string | null;
  dndEndTime: string | null;
  dndTimezone: string | null;
  defaultChannelLevel: string;
  dmNotifications: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ChannelNotificationOverrideDto {
  id: string;
  userId: string;
  channelId: string;
  level: string;
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationAuthorDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export class NotificationMessageDto {
  id: string;
  @ApiProperty({ type: [SpanDto] })
  spans: SpanDto[];
  channelId: string | null;
  directMessageGroupId: string | null;
}

export class NotificationDto {
  id: string;
  userId: string;
  @ApiProperty({ enum: NotificationTypeValues, enumName: 'NotificationType' })
  type: NotificationType;
  messageId: string | null;
  channelId: string | null;
  directMessageGroupId: string | null;
  communityId?: string | null;
  /** The channel's name, for clients showing it without the channel list. */
  @ApiPropertyOptional({ type: String, nullable: true })
  channelName?: string | null;
  authorId: string;
  parentMessageId: string | null;
  read: boolean;
  dismissed: boolean;
  createdAt: Date;
  author?: NotificationAuthorDto;
  message?: NotificationMessageDto | null;
}

export class NotificationListResponseDto {
  notifications: NotificationDto[];
  @ApiProperty({ type: 'integer' })
  total: number;
  @ApiProperty({ type: 'integer' })
  unreadCount: number;
}

export class UnreadCountResponseDto {
  @ApiProperty({ type: 'integer' })
  count: number;
}

export class DebugNotificationResponseDto {
  success: boolean;
  notification: NotificationDto;
  message: string;
}

export class DebugPushSubscriptionDto {
  id: string;
  endpoint: string;
  userAgent?: string | null;
  createdAt: Date;
}

export class DebugSubscriptionsResponseDto {
  @ApiProperty({ type: [DebugPushSubscriptionDto] })
  subscriptions: DebugPushSubscriptionDto[];
  @ApiProperty({ type: 'integer' })
  count: number;
  pushEnabled: boolean;
}

export class ClearNotificationDataResponseDto {
  success: boolean;
  @ApiProperty({ type: 'integer' })
  notificationsDeleted: number;
  @ApiProperty({ type: 'integer' })
  settingsDeleted: number;
  @ApiProperty({ type: 'integer' })
  overridesDeleted: number;
  message: string;
}
