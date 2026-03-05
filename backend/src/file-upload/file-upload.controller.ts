import {
  Controller,
  Post,
  Body,
  Param,
  Delete,
  UseInterceptors,
  ClassSerializerInterceptor,
  UploadedFile,
  ParseFilePipe,
  FileTypeValidator,
  HttpStatus,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { FileUploadService } from './file-upload.service';
import { CreateFileUploadDto } from './dto/create-file-upload.dto';
import { FileInterceptor } from '@nestjs/platform-express';

import { MimeTypeAwareSizeValidator } from './validators/mime-type-aware-size.validator';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/types';
import { FileUploadResponseDto } from './dto/file-upload-response.dto';

@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('file-upload')
export class FileUploadController {
  constructor(private readonly fileUploadService: FileUploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiCreatedResponse({ type: FileUploadResponseDto })
  uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MimeTypeAwareSizeValidator({}),
          new FileTypeValidator({
            fileType: /^(image|video|audio|application|text)/,
            skipMagicNumbersValidation: true,
          }),
        ],
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    )
    file: Express.Multer.File,
    @Body() body: CreateFileUploadDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<FileUploadResponseDto> {
    return this.fileUploadService.uploadFile(file, body, req.user);
  }

  @Delete(':id')
  @ApiOkResponse({ type: FileUploadResponseDto })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<FileUploadResponseDto> {
    return this.fileUploadService.remove(id, req.user.id);
  }
}
