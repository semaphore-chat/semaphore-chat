import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  ChannelPreset,
  ChannelType,
  OverwriteTarget,
  RbacActions,
} from '@prisma/client';
import {
  ChannelPresetValues,
  ChannelTypeValues,
  OverwriteTargetValues,
  RbacActionsValues,
} from '@/common/enums/swagger-enums';

export class ChannelOverwriteDto {
  @ApiProperty({ enum: OverwriteTargetValues })
  targetType: OverwriteTarget;

  @ApiProperty({ type: String, nullable: true })
  roleId: string | null;

  @ApiProperty({ enum: RbacActionsValues, isArray: true })
  allow: RbacActions[];

  @ApiProperty({ enum: RbacActionsValues, isArray: true })
  deny: RbacActions[];
}

export class ChannelOverwritesDto {
  channelId: string;

  @ApiProperty({ enum: ChannelPresetValues })
  preset: ChannelPreset;

  @ApiProperty({ type: [ChannelOverwriteDto] })
  overwrites: ChannelOverwriteDto[];
}

/** One channel in the management listing (shown even if not viewable). */
export class ManagedChannelDto extends ChannelOverwritesDto {
  name: string;
  @ApiProperty({ enum: ChannelTypeValues })
  type: ChannelType;
  isPrivate: boolean;
  position: number;
}

export class ReplaceOverwriteInputDto {
  /** EVERYONE or ROLE. MEMBER overwrites exist in the data model only. */
  @ApiProperty({ enum: OverwriteTargetValues })
  @IsEnum(OverwriteTarget)
  targetType: OverwriteTarget;

  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  roleId?: string | null;

  @ApiProperty({ enum: RbacActionsValues, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(RbacActionsValues, { each: true })
  allow: RbacActions[];

  @ApiProperty({ enum: RbacActionsValues, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(RbacActionsValues, { each: true })
  deny: RbacActions[];
}

export class ReplaceChannelOverwritesDto {
  @ApiProperty({ enum: ChannelPresetValues })
  @IsEnum(ChannelPreset)
  preset: ChannelPreset;

  @ApiProperty({ type: [ReplaceOverwriteInputDto] })
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => ReplaceOverwriteInputDto)
  overwrites: ReplaceOverwriteInputDto[];
}
