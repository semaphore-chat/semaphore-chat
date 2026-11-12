import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { ChannelDto } from '@/channels/dto/channel-response.dto';
import { NotificationTypeValues } from '@/common/enums/swagger-enums';
import {
  NotificationAuthorDto,
  NotificationMessageDto,
} from '@/notifications/dto/notification-response.dto';
import { VoicePresenceUserDto } from '@/voice-presence/dto/voice-presence-response.dto';

/** Payloads of the socket events outside messaging, in the same document as REST. */

const SESSION_TERMINATED_REASONS = [
  'TOKEN_EXPIRED',
  'LOGGED_OUT',
  'SESSION_REVOKED',
  'PASSWORD_CHANGED',
  'ACCOUNT_BANNED',
  'ACCOUNT_DELETED',
] as const;
export type SessionTerminatedReasonValue =
  (typeof SESSION_TERMINATED_REASONS)[number];

export class TokenExpiringPayloadDto {
  /** When the socket's current access token expires. */
  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: string;
}

export class SessionTerminatedPayloadDto {
  /**
   * Why the server ended the session, right before it disconnects the socket.
   * TOKEN_EXPIRED: a refreshed token is enough to reconnect. LOGGED_OUT,
   * SESSION_REVOKED, PASSWORD_CHANGED: refreshing fails unless the client holds
   * another valid session. ACCOUNT_BANNED, ACCOUNT_DELETED: the account can no
   * longer sign in.
   */
  @ApiProperty({
    enum: SESSION_TERMINATED_REASONS,
    enumName: 'SessionTerminatedReason',
  })
  reason: SessionTerminatedReasonValue;
}

export class DesktopSignInPayloadDto {
  /** Where the desktop app signed in from, as the server saw it. */
  @ApiProperty({ type: String, nullable: true })
  ipAddress: string | null;

  /** When the desktop app signed in. */
  @ApiProperty({ type: String, format: 'date-time' })
  signedInAt: string;
}

/** The acknowledgement of REAUTHENTICATE. */
export class ReauthenticateResultDto {
  ok: boolean;
  /** Set when ok: when the new access token expires. */
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  expiresAt?: string;
  /** Set when not ok. */
  @ApiPropertyOptional({
    enum: ['AUTH_FAILED'],
    enumName: 'ReauthenticateError',
  })
  error?: 'AUTH_FAILED';
}

export class ReadReceiptUpdatedPayloadDto {
  channelId: string | null;
  directMessageGroupId: string | null;
  lastReadMessageId: string;
  @ApiProperty({ type: String, format: 'date-time' })
  lastReadAt: string;
  /** The reader's details are set on the DM room broadcast, not on self-sync. */
  @ApiPropertyOptional()
  userId?: string;
  @ApiPropertyOptional()
  username?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  displayName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  avatarUrl?: string | null;
}

export class NewNotificationPayloadDto {
  notificationId: string;
  @ApiProperty({ enum: NotificationTypeValues, enumName: 'NotificationType' })
  type: NotificationType;
  messageId: string | null;
  channelId: string | null;
  communityId: string | null;
  channelName: string | null;
  directMessageGroupId: string | null;
  authorId: string;
  @ApiProperty({ type: NotificationAuthorDto, nullable: true })
  author: NotificationAuthorDto | null;
  @ApiProperty({ type: NotificationMessageDto, nullable: true })
  message: NotificationMessageDto | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
  read: boolean;
}

export class NotificationReadPayloadDto {
  notificationId: string;
}

/** USER_ONLINE and USER_OFFLINE. */
export class UserPresencePayloadDto {
  userId: string;
  @ApiPropertyOptional()
  username?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  displayName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  avatarUrl?: string | null;
}

export class UserTypingPayloadDto {
  userId: string;
  @ApiPropertyOptional()
  channelId?: string;
  @ApiPropertyOptional()
  directMessageGroupId?: string;
  isTyping: boolean;
}

export class VoiceChannelUserJoinedPayloadDto {
  channelId: string;
  user: VoicePresenceUserDto;
}

export class VoiceChannelUserLeftPayloadDto {
  channelId: string;
  userId: string;
  user: VoicePresenceUserDto;
}

export class VoiceChannelUserUpdatedPayloadDto {
  channelId: string;
  userId: string;
  user: VoicePresenceUserDto;
}

export class DmVoiceCallStarterDto {
  id: string;
  username: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  displayName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  avatarUrl?: string | null;
}

export class DmVoiceCallStartedPayloadDto {
  dmGroupId: string;
  startedBy: string;
  starter: DmVoiceCallStarterDto;
}

export class DmVoiceUserJoinedPayloadDto {
  dmGroupId: string;
  user: VoicePresenceUserDto;
}

export class DmVoiceUserLeftPayloadDto {
  dmGroupId: string;
  userId: string;
  user: VoicePresenceUserDto;
}

export class DmVoiceCallDeclinedPayloadDto {
  dmGroupId: string;
  userId: string;
}

export class DmVoiceCallEndedPayloadDto {
  dmGroupId: string;
}

export class ReplayBufferStoppedPayloadDto {
  sessionId: string;
  egressId: string;
  channelId: string;
}

export class ReplayBufferFailedPayloadDto {
  sessionId: string;
  egressId: string;
  channelId: string;
  error: string;
}

export class EgressSegmentsReadyPayloadDto {
  sessionId: string;
  channelId: string;
}

export class ChannelsReorderedPayloadDto {
  communityId: string;
  channels: ChannelDto[];
}

export class ChannelCreatedPayloadDto {
  communityId: string;
  channel: ChannelDto;
}

export class ChannelUpdatedPayloadDto {
  communityId: string;
  channel: ChannelDto;
}

export class ChannelPermissionsUpdatedPayloadDto {
  communityId: string;
  channelId: string;
}

export class ChannelDeletedPayloadDto {
  communityId: string;
  channelId: string;
}

export class UserBannedPayloadDto {
  communityId: string;
  userId: string;
  moderatorId: string;
  @ApiPropertyOptional()
  reason?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  expiresAt?: string;
}

export class UserKickedPayloadDto {
  communityId: string;
  userId: string;
  moderatorId: string;
  @ApiPropertyOptional()
  reason?: string;
}

export class UserTimedOutPayloadDto {
  communityId: string;
  userId: string;
  moderatorId: string;
  @ApiPropertyOptional()
  reason?: string;
  @ApiProperty({ type: 'integer' })
  durationSeconds: number;
  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: string;
}

export class TimeoutRemovedPayloadDto {
  communityId: string;
  userId: string;
  moderatorId: string;
  @ApiPropertyOptional()
  reason?: string;
}

export class MemberAddedToCommunityPayloadDto {
  communityId: string;
  userId: string;
}

export class CommunityUpdatedPayloadDto {
  communityId: string;
  name: string;
  description: string | null;
  avatar: string | null;
  banner: string | null;
}

export class CommunityDeletedPayloadDto {
  communityId: string;
}

export class RoleCreatedPayloadDto {
  communityId: string;
  roleId: string;
  roleName: string;
}

export class RoleUpdatedPayloadDto {
  communityId: string;
  roleId: string;
  roleName: string;
}

export class RoleDeletedPayloadDto {
  communityId: string;
  roleId: string;
}

export class RoleAssignedPayloadDto {
  communityId: string;
  userId: string;
  roleId: string;
  roleName: string;
}

export class RoleUnassignedPayloadDto {
  communityId: string;
  userId: string;
  roleId: string;
}

export class UserProfileUpdatedPayloadDto {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
}

/** PRESENCE_ONLINE: `idle` when the client is connecting while idle. */
export class PresenceOnlineDto {
  @ApiPropertyOptional()
  idle?: boolean;
}
