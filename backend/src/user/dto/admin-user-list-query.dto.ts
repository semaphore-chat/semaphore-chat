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

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  banned?: 'true' | 'false';

  @ApiPropertyOptional({ enum: InstanceRoleValues })
  @IsOptional()
  @IsEnum(InstanceRole)
  role?: InstanceRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
