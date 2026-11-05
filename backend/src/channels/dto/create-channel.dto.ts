import { $Enums } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelTypeValues } from '@/common/enums/swagger-enums';

export class CreateChannelDto {
  @IsBoolean()
  @IsNotEmpty()
  isPrivate: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsUUID()
  communityId: string;

  @ApiProperty({ enum: ChannelTypeValues, enumName: 'ChannelType' })
  @IsEnum($Enums.ChannelType)
  type: $Enums.ChannelType;

  @IsNumber()
  @IsOptional()
  @ApiPropertyOptional({ type: 'integer' })
  position?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(21600) // Max 6 hours
  @ApiPropertyOptional({ type: 'integer' })
  slowmodeSeconds?: number;
}
