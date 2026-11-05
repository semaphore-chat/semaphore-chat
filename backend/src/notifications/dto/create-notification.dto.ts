import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { NotificationType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationTypeValues } from '@/common/enums/swagger-enums';

export class CreateNotificationDto {
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: NotificationTypeValues, enumName: 'NotificationType' })
  @IsNotEmpty()
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsUUID()
  @IsOptional()
  messageId?: string;

  @IsUUID()
  @IsOptional()
  channelId?: string;

  @IsUUID()
  @IsOptional()
  directMessageGroupId?: string;

  @IsUUID()
  authorId: string;

  @IsUUID()
  @IsOptional()
  parentMessageId?: string;
}
