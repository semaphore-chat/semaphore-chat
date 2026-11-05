import { ModerationAction, Prisma, InstanceRole } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  ModerationActionValues,
  InstanceRoleValues,
} from '@/common/enums/swagger-enums';
import { MessageDto } from '@/messages/dto/message-response.dto';

export { SuccessMessageDto } from '@/common/dto/common-response.dto';

export class ModerationUserDto {
  id: string;
  username: string;
  @ApiProperty({ enum: InstanceRoleValues, enumName: 'InstanceRole' })
  role: InstanceRole;
  avatarUrl: string | null;
  bannerUrl: string | null;
  lastSeen: Date | null;
  displayName: string | null;
  bio: string | null;
  status: string | null;
}

export class PinnedMessageAuthorDto {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** A pinned message, with the author details the pins panel shows. */
export class PinnedMessageDto extends MessageDto {
  author: PinnedMessageAuthorDto | null;
}

export class CommunityBanDto {
  id: string;
  communityId: string;
  userId: string;
  moderatorId: string | null;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
  @ApiProperty({ type: ModerationUserDto, nullable: true })
  user: ModerationUserDto | null;
  @ApiProperty({ type: ModerationUserDto, nullable: true })
  moderator: ModerationUserDto | null;
}

export class CommunityTimeoutDto {
  id: string;
  communityId: string;
  userId: string;
  moderatorId: string | null;
  reason: string | null;
  createdAt: Date;
  expiresAt: Date;
  @ApiProperty({ type: ModerationUserDto, nullable: true })
  user: ModerationUserDto | null;
  @ApiProperty({ type: ModerationUserDto, nullable: true })
  moderator: ModerationUserDto | null;
}

export class ModerationLogDto {
  id: string;
  communityId: string;
  moderatorId: string | null;
  targetUserId: string | null;
  @ApiProperty({ enum: ModerationActionValues, enumName: 'ModerationAction' })
  action: ModerationAction;
  reason: string | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  @ApiProperty({ type: ModerationUserDto, nullable: true })
  moderator: ModerationUserDto | null;
  @ApiProperty({ type: ModerationUserDto, nullable: true })
  targetUser: ModerationUserDto | null;
}

export class TimeoutStatusResponseDto {
  isTimedOut: boolean;
  expiresAt?: Date;
}

export class ModerationLogsResponseDto {
  logs: ModerationLogDto[];
  @ApiProperty({ type: 'integer' })
  total: number;
}
