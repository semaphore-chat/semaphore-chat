import { ApiProperty } from '@nestjs/swagger';
import { CreateFileUploadDto } from './create-file-upload.dto';

/**
 * The multipart request body of POST /file-upload: the binary file plus the
 * target resource fields of CreateFileUploadDto.
 */
export class UploadFileBodyDto extends CreateFileUploadDto {
  @ApiProperty({ type: 'string', format: 'binary' })
  file: Express.Multer.File;
}
