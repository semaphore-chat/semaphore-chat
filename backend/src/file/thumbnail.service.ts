import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { StorageService, StorageType } from '@/storage/storage.service';
import {
  FfmpegCommand,
  FfmpegProvider,
} from '@/livekit/providers/ffmpeg.provider';
import type { MediaDimensions } from './media-dimensions.service';

/**
 * Thumbnails are JPEGs whose longest side is at most this many pixels,
 * matching the width video thumbnails have always been scaled to. Images
 * that already fit are left alone (clients show the original).
 */
const THUMBNAIL_MAX_DIMENSION = 480;

/** A single frame (or image) decodes in well under this; a stuck process is killed. */
const THUMBNAIL_TIMEOUT_MS = 30_000;

/**
 * Fits the frame inside a 480×480 box without cropping and, because the
 * source dimensions are part of the expressions, without ever upscaling.
 * Works for both orientations (the box is a bound, not a target size).
 */
const IMAGE_THUMBNAIL_SCALE = `scale='min(${THUMBNAIL_MAX_DIMENSION},iw)':'min(${THUMBNAIL_MAX_DIMENSION},ih)':force_original_aspect_ratio=decrease`;

/** Writes one JPEG frame from `inputPath` to `outputPath`. */
type ThumbnailExtraction = (
  inputPath: string,
  outputPath: string,
) => Promise<void>;

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);
  private readonly uploadsDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    private readonly ffmpegProvider: FfmpegProvider,
  ) {
    this.uploadsDir =
      this.configService.get<string>('FILE_UPLOAD_DEST') || './uploads';
  }

  /**
   * Generate a JPEG thumbnail from a video file using FFmpeg.
   * Extracts a single frame at ~1 second, scaled to 480px wide.
   *
   * ffmpeg always needs a local filesystem path to write to. For LOCAL
   * storage that's simply the final thumbnail location (unchanged, single
   * write). For S3, extraction still lands in a local scratch file next to
   * it, which is then streamed up to the object store and removed — the
   * returned value is the S3 KEY, not a local path.
   *
   * @param filePath - Absolute path to the uploaded video file (always local — multer staging)
   * @param fileId - Database file ID (used for naming the thumbnail)
   * @param storageType - Where the parent `File` record lives; defaults to LOCAL
   * @returns The thumbnail path/key on success, or null on failure (non-fatal)
   */
  async generateVideoThumbnail(
    filePath: string,
    fileId: string,
    storageType: StorageType = StorageType.LOCAL,
  ): Promise<string | null> {
    return this.generateThumbnail(
      filePath,
      fileId,
      storageType,
      (inputPath, outputPath) =>
        this.runThumbnailExtraction(inputPath, outputPath, (command) =>
          command
            .input(inputPath)
            .inputOptions('-ss', '1') // Seek to 1 second (fast, before decoding)
            .outputOptions(
              '-vframes',
              '1', // Extract single frame
              '-vf',
              'scale=480:-1', // Scale to 480px wide, preserve aspect ratio
              '-f',
              'image2', // Output as image
              '-q:v',
              '5', // JPEG quality (2=best, 31=worst)
            ),
        ),
    );
  }

  /**
   * Generate a JPEG thumbnail from a raster image using FFmpeg.
   *
   * ffmpeg applies the EXIF orientation while decoding (autorotate is on by
   * default and is never disabled here, because rotated phone photos are the
   * common case) and `-map_metadata -1` keeps that EXIF out of the output,
   * otherwise browsers would rotate the already-rotated thumbnail again.
   * The frame is fitted into a 480×480 box on its longest side, so portrait
   * and landscape images both stay bounded, and small images are never
   * enlarged.
   *
   * Best-effort: a non-raster MIME type, an image whose longest side is
   * already within the bound, a decode failure, or a storage failure all
   * return null and leave the upload without a thumbnail.
   *
   * @param dimensions - Display dimensions already read at upload time (after
   *   EXIF rotation); when both are within the bound no thumbnail is worth
   *   generating. Unknown dimensions still get a (non-upscaling) attempt.
   */
  async generateImageThumbnail(
    filePath: string,
    fileId: string,
    storageType: StorageType = StorageType.LOCAL,
    mimeType = '',
    dimensions?: MediaDimensions | null,
  ): Promise<string | null> {
    if (!this.isRasterImage(mimeType)) {
      this.logger.debug(
        `Skipping thumbnail for file ${fileId}: ${mimeType || 'unknown type'} is not a raster image`,
      );
      return null;
    }

    if (this.fitsWithinBound(dimensions)) {
      this.logger.debug(
        `Skipping thumbnail for file ${fileId}: ${dimensions.width}×${dimensions.height} already fits ${THUMBNAIL_MAX_DIMENSION}px`,
      );
      return null;
    }

    return this.generateThumbnail(
      filePath,
      fileId,
      storageType,
      (inputPath, outputPath) =>
        this.runThumbnailExtraction(inputPath, outputPath, (command) =>
          // ffmpeg's default autorotate applies the EXIF orientation; it is
          // not disabled here, so rotated phone photos come out upright.
          command.input(inputPath).outputOptions(
            '-frames:v',
            '1',
            '-vf',
            IMAGE_THUMBNAIL_SCALE,
            '-map_metadata',
            '-1', // No EXIF (orientation) in the thumbnail
            '-f',
            'image2',
            '-q:v',
            '5',
          ),
        ),
    );
  }

  /** SVG is resolution-independent; everything else under `image/` is raster data. */
  private isRasterImage(mimeType: string): boolean {
    const type = (mimeType ?? '').toLowerCase();
    return type.startsWith('image/') && !type.startsWith('image/svg');
  }

  /** True when both known display dimensions are at or below the bound. */
  private fitsWithinBound(
    dimensions?: MediaDimensions | null,
  ): dimensions is MediaDimensions {
    if (!dimensions) return false;
    return (
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      Math.max(dimensions.width, dimensions.height) <= THUMBNAIL_MAX_DIMENSION
    );
  }

  /**
   * Shared LOCAL/S3 write path: extraction always targets a local path, and
   * non-LOCAL storage then streams that file into the object store.
   */
  private async generateThumbnail(
    filePath: string,
    fileId: string,
    storageType: StorageType,
    extract: ThumbnailExtraction,
  ): Promise<string | null> {
    const thumbnailDir = path.join(this.uploadsDir, 'thumbnails');

    if (storageType !== StorageType.LOCAL) {
      return this.generateAndUploadThumbnail(
        filePath,
        fileId,
        storageType,
        thumbnailDir,
        extract,
      );
    }

    const thumbnailPath = path.join(thumbnailDir, `${fileId}.jpg`);

    try {
      await this.storageService.ensureDirectory(thumbnailDir);

      await extract(filePath, thumbnailPath);

      this.logger.log(`Generated thumbnail for file ${fileId}`);
      return thumbnailPath;
    } catch (error) {
      this.logger.warn(
        `Failed to generate thumbnail for file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Non-LOCAL variant: extract to a local scratch file, upload it to the
   * resolved provider, then remove the scratch copy regardless of outcome.
   */
  private async generateAndUploadThumbnail(
    filePath: string,
    fileId: string,
    storageType: StorageType,
    thumbnailDir: string,
    extract: ThumbnailExtraction,
  ): Promise<string | null> {
    const scratchPath = path.join(thumbnailDir, `${fileId}.jpg.tmp`);
    const key = `thumbnails/${fileId}.jpg`;

    try {
      await this.storageService.ensureDirectory(thumbnailDir);
      await extract(filePath, scratchPath);

      const provider = this.storageService.getProvider(storageType);
      await provider.writeStream(
        key,
        this.storageService.createReadStream(scratchPath),
        { contentType: 'image/jpeg' },
      );

      this.logger.log(`Generated and uploaded thumbnail for file ${fileId}`);
      return key;
    } catch (error) {
      this.logger.warn(
        `Failed to generate thumbnail for file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      // Best-effort scratch-file cleanup — non-fatal even if extraction
      // never produced the file.
      await this.storageService.deleteFile(scratchPath).catch(() => undefined);
    }
  }

  private runThumbnailExtraction(
    inputPath: string,
    outputPath: string,
    configure: (command: FfmpegCommand) => FfmpegCommand,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const command = configure(this.ffmpegProvider.createCommand())
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => {
          reject(
            new Error(
              `FFmpeg thumbnail extraction failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        });

      // Timeout: 30 seconds should be more than enough for a single frame,
      // and the process is killed rather than left running behind the upload.
      const timeout = setTimeout(() => {
        command.kill('SIGKILL');
        reject(
          new Error(
            `Thumbnail generation timed out after ${THUMBNAIL_TIMEOUT_MS / 1000} seconds`,
          ),
        );
      }, THUMBNAIL_TIMEOUT_MS);

      command.on('end', () => clearTimeout(timeout));
      command.on('error', () => clearTimeout(timeout));

      command.run();
    });
  }
}
