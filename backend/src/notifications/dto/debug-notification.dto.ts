import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NotificationType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationTypeValues } from '@/common/enums/swagger-enums';

/**
 * DTO for sending test notifications (debug only)
 * Used by admin users to test notification delivery
 */
export class SendTestNotificationDto {
  @ApiProperty({ enum: NotificationTypeValues, enumName: 'NotificationType' })
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsOptional()
  @IsString()
  customMessage?: string;
}
