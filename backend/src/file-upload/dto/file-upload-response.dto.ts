import { FileType, StorageType, ResourceType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  FileTypeValues,
  ResourceTypeValues,
  StorageTypeValues,
} from '@/common/enums/swagger-enums';

export class FileUploadResponseDto {
  id: string;
  filename: string;
  mimeType: string;
  @ApiProperty({ enum: FileTypeValues, enumName: 'FileType' })
  fileType: FileType;
  @ApiProperty({ type: 'integer', format: 'int64' })
  size: number;
  /**
   * Display width in pixels, for images and videos; null when unknown.
   */
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  width?: number | null;
  /**
   * Display height in pixels, for images and videos; null when unknown.
   */
  @ApiPropertyOptional({ type: 'integer', nullable: true })
  height?: number | null;
  checksum: string;
  uploadedById: string | null;
  uploadedAt: Date;
  deletedAt: Date | null;
  @ApiProperty({ enum: ResourceTypeValues, enumName: 'ResourceType' })
  resourceType: ResourceType;
  fileUserId: string | null;
  fileCommunityId: string | null;
  fileMessageId: string | null;
  @ApiProperty({ enum: StorageTypeValues, enumName: 'StorageType' })
  storageType: StorageType;

  @Exclude()
  storagePath: string;

  @Exclude()
  thumbnailPath: string | null;

  constructor(partial: Partial<FileUploadResponseDto>) {
    Object.assign(this, partial);
  }
}
