import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InstanceRole } from '@prisma/client';
import { InstanceRoleValues } from '@/common/enums/swagger-enums';

export class AdminUserListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 50,
    type: 'integer',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  continuationToken?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], enumName: 'BooleanString' })
  @IsOptional()
  @IsIn(['true', 'false'])
  banned?: 'true' | 'false';

  @ApiPropertyOptional({ enum: InstanceRoleValues, enumName: 'InstanceRole' })
  @IsOptional()
  @IsEnum(InstanceRole)
  role?: InstanceRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
