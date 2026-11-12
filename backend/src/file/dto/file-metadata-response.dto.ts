import { FileType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FileTypeValues } from '@/common/enums/swagger-enums';

export class FileMetadataResponseDto {
  id: string;
  filename: string;
  mimeType: string;
  @ApiProperty({ enum: FileTypeValues, enumName: 'FileType' })
  fileType: FileType;
  @ApiProperty({ type: 'integer', format: 'int64' })
  size: number;
  hasThumbnail: boolean;
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
}
