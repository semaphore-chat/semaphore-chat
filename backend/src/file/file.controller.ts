import {
  Controller,
  Get,
  NotFoundException,
  NotImplementedException,
  Param,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { FileService } from './file.service';
import { SignedUrlService } from './signed-url.service';
import { StorageType } from '@prisma/client';
import { createReadStream } from 'fs';

import { FileAccessGuard } from '@/file/file-access/file-access.guard';
import { FileAuthGuard } from '@/file/file-auth.guard';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';
import { Public } from '@/auth/public.decorator';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';
import { AuthenticatedRequest } from '@/types';

@Controller('file')
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly signedUrlService: SignedUrlService,
  ) {}

  @Get(':id/signed-url')
  @UseGuards(JwtAuthGuard, FileAccessGuard)
  async getSignedUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ url: string; expiresAt: string }> {
    const file = await this.fileService.findOne(id);
    if (!file) {
      throw new NotFoundException('File not found');
    }

    const { url, expiresAt } = this.signedUrlService.generateSignedUrl(
      `/api/file/${id}`,
      id,
      req.user.id,
    );

    return { url, expiresAt: expiresAt.toISOString() };
  }

  @Public()
  @Get(':id/metadata')
  @UseGuards(OptionalJwtAuthGuard, FileAuthGuard, FileAccessGuard)
  @ApiOkResponse({ type: FileMetadataResponseDto })
  async getFileMetadata(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FileMetadataResponseDto> {
    const file = await this.fileService.findOne(id);
    if (!file) {
      throw new NotFoundException('File not found');
    }

    return {
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      fileType: file.fileType,
      size: file.size,
      hasThumbnail: !!file.thumbnailPath,
    };
  }

  @Public()
  @Get(':id/thumbnail')
  @UseGuards(OptionalJwtAuthGuard, FileAuthGuard, FileAccessGuard)
  async getFileThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.fileService.findOne(id);
    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (!file.thumbnailPath) {
      throw new NotFoundException('No thumbnail available for this file');
    }

    const stream = createReadStream(file.thumbnailPath);

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=86400', // Thumbnails are immutable, cache 24h in user's browser
      'Cross-Origin-Resource-Policy': 'cross-origin', // Allow Electron (different origin) to load
    });

    return new StreamableFile(stream);
  }

  @Public()
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard, FileAuthGuard, FileAccessGuard)
  async getFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.fileService.findOne(id);
    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.storageType !== StorageType.LOCAL) {
      throw new NotImplementedException(
        'Only local file storage is supported at this time',
      );
    }

    // Sanitize filename for Content-Disposition header (RFC 5987)
    const sanitizedFilename = file.filename.replace(/["\\\n\r]/g, '_');
    const encodedFilename = encodeURIComponent(file.filename);

    // Force download for MIME types that can execute scripts
    const dangerousMimeTypes = [
      'image/svg+xml',
      'text/html',
      'application/xhtml+xml',
    ];
    const disposition = dangerousMimeTypes.includes(file.mimeType)
      ? 'attachment'
      : 'inline';

    const fileSize = file.size;
    const rangeHeader = req.headers.range;

    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${disposition}; filename="${sanitizedFilename}"; filename*=UTF-8''${encodedFilename}`,
      'Cross-Origin-Resource-Policy': 'cross-origin', // Allow Electron (different origin) to load
    });

    // Handle Range requests for streaming
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        // Validate range: reject only when start is beyond EOF or inverted
        if (start >= fileSize || start > end) {
          res.status(416).set({
            'Content-Range': `bytes */${fileSize}`,
          });
          return new StreamableFile(Buffer.alloc(0));
        }

        // Clamp end to file boundary (per RFC 7233 §2.1)
        const clampedEnd = Math.min(end, fileSize - 1);
        const chunkSize = clampedEnd - start + 1;
        const stream = createReadStream(file.storagePath, {
          start,
          end: clampedEnd,
        });

        res.status(206).set({
          'Content-Type': file.mimeType,
          'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
          'Content-Length': chunkSize,
        });

        return new StreamableFile(stream);
      }
    }

    // No Range header — serve full file
    const stream = createReadStream(file.storagePath);

    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': fileSize,
    });

    return new StreamableFile(stream);
  }
}
