import { ChannelPreset, ChannelType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  ChannelPresetValues,
  ChannelTypeValues,
} from '@/common/enums/swagger-enums';

export class ChannelDto {
  id: string;
  name: string;
  communityId: string;
  createdAt: Date;
  @ApiProperty({ enum: ChannelTypeValues, enumName: 'ChannelType' })
  type: ChannelType;
  @ApiProperty({ type: 'integer' })
  position: number;
  @ApiProperty({ type: 'integer' })
  slowmodeSeconds: number;
  isPrivate: boolean;
  /** Display label for the permission preset (enforcement uses overwrites). */
  @ApiProperty({ enum: ChannelPresetValues, enumName: 'ChannelPreset' })
  preset: ChannelPreset;
}
