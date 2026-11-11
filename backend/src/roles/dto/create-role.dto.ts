import {
  IsString,
  IsArray,
  ArrayMinSize,
  MaxLength,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { RbacActions } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RbacActionsValues } from '@/common/enums/swagger-enums';

export class CreateRoleDto {
  @IsString()
  @MaxLength(50, { message: 'Role name must not exceed 50 characters' })
  name: string;

  @ApiProperty({
    enum: RbacActionsValues,
    enumName: 'RbacAction',
    isArray: true,
  })
  @IsArray()
  @IsEnum(RbacActions, { each: true })
  @ArrayMinSize(1, { message: 'Role must have at least one permission' })
  actions: RbacActions[];

  @ApiPropertyOptional({
    description: 'Position for ordering (lower = higher priority)',
    type: 'integer',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  position?: number;
}
