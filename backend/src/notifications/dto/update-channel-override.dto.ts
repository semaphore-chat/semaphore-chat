import { IsNotEmpty, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationLevelValues } from '@/common/enums/swagger-enums';

export class UpdateChannelOverrideDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['all', 'mentions', 'none'])
  @ApiProperty({
    enum: NotificationLevelValues,
    enumName: 'NotificationLevel',
  })
  level: string;
}
