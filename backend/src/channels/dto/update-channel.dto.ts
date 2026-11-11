import {
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(21600) // Max 6 hours
  @ApiPropertyOptional({ type: 'integer' })
  slowmodeSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ type: 'integer' })
  position?: number;
}
