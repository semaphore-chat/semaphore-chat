import { FileType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
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
}
