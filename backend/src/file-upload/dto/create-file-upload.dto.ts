import { ResourceType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ResourceTypeValues } from '@/common/enums/swagger-enums';

export class CreateFileUploadDto {
  @ApiProperty({ enum: ResourceTypeValues, enumName: 'ResourceType' })
  @IsEnum(ResourceType)
  resourceType: ResourceType;

  @IsOptional()
  @IsString()
  resourceId?: string | null;
}
