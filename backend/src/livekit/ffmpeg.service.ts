import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { StorageService } from '@/storage/storage.service';
import { getErrorMessage } from '@/common/utils/error.utils';
import { FfmpegProvider } from './providers/ffmpeg.provider';

/**
 * FFmpeg Service
 *
 * Provides video processing capabilities using FFmpeg.
 * Primarily used for concatenating HLS segments into MP4 clips.
 */
@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly ffmpegProvider: FfmpegProvider,
  ) {}

  /**
   * Concatenate multiple video segments into a single MP4 file
   *
   * @param segmentPaths - Array of absolute paths to segment files (.ts)
   * @param outputPath - Absolute path for the output MP4 file
   * @param trimOptions - Optional precise trimming within concatenated segments
   * @returns Promise that resolves when concatenation is complete
   *
   * @example
   * ```typescript
   * // Basic concatenation
   * await ffmpegService.concatenateSegments(
   *   ['/out/user1/seg1.ts', '/out/user1/seg2.ts'],
   *   '/uploads/replays/user1/clip.mp4'
   * );
   *
   * // With precise trimming
   * await ffmpegService.concatenateSegments(
   *   ['/out/user1/seg1.ts', '/out/user1/seg2.ts'],
   *   '/uploads/replays/user1/clip.mp4',
   *   { startOffset: 5, duration: 60 } // Skip 5s, output 60s
   * );
   * ```
   */
  async concatenateSegments(
    segmentPaths: string[],
    outputPath: string,
    trimOptions?: {
      startOffset: number; // Seconds to skip into first segment
      duration: number; // Exact output duration in seconds
    },
  ): Promise<void> {
    if (segmentPaths.length === 0) {
      throw new BadRequestException('No segments provided for concatenation');
    }

    const tempDir = `/tmp/replay-concat-${uuidv4()}`;
    const concatFile = path.join(tempDir, 'concat.txt');

    try {
      // Create temp directory
      await this.storageService.ensureDirectory(tempDir);

      // Ensure output directory exists
      await this.storageService.ensureDirectory(path.dirname(outputPath));

      // Create concat demuxer file
      // Format: file '/absolute/path/to/segment.ts'
      const concatContent = segmentPaths
        .map((segmentPath) => `file '${segmentPath}'`)
        .join('\n');

      await this.storageService.writeFile(concatFile, concatContent);

      this.logger.log(
        `Concatenating ${segmentPaths.length} segments to ${outputPath}`,
      );
      if (trimOptions) {
        this.logger.log(
          `Trim options: skip ${trimOptions.startOffset}s, duration ${trimOptions.duration}s`,
        );
      }
      this.logger.debug(`Concat file content:\n${concatContent}`);

      // Force NFS cache refresh by stat()ing each file
      await this.forceNfsCacheRefresh(segmentPaths);

      // Run FFmpeg with retry logic for NFS timing issues
      await this.runFFmpegWithRetry(
        concatFile,
        outputPath,
        segmentPaths,
        trimOptions,
      );

      this.logger.log(`Successfully created clip: ${outputPath}`);
    } finally {
      // Cleanup temp directory
      try {
        await this.storageService.deleteDirectory(tempDir, {
          recursive: true,
          force: true,
        });
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup temp directory ${tempDir}:`,
          cleanupError,
        );
      }
    }
  }

  /**
   * Force NFS cache refresh by stat()ing each file
   *
   * This helps with NFS attribute caching issues where files are visible
   * in directory listings but not yet accessible to FFmpeg.
   *
   * @param filePaths - Array of file paths to stat
   * @private
   */
  private async forceNfsCacheRefresh(filePaths: string[]): Promise<void> {
    this.logger.debug(
      `Forcing NFS cache refresh for ${filePaths.length} files...`,
    );

    const refreshPromises = filePaths.map(async (filePath) => {
      try {
        await this.storageService.getFileStats(filePath);
      } catch {
        // Ignore errors - file might not be accessible yet
        // Retry logic in runFFmpegWithRetry will handle it
      }
    });

    await Promise.all(refreshPromises);
    this.logger.debug('NFS cache refresh completed');
  }

  /**
   * Execute FFmpeg with retry logic for NFS timing issues
   *
   * @param concatFile - Path to concat demuxer text file
   * @param outputPath - Path for output MP4 file
   * @param segmentPaths - Original segment paths for cache refresh on retry
   * @param trimOptions - Optional precise trimming parameters
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @private
   */
  private async runFFmpegWithRetry(
    concatFile: string,
    outputPath: string,
    segmentPaths: string[],
    trimOptions?: { startOffset: number; duration: number },
    maxRetries = 3,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.runFFmpeg(concatFile, outputPath, trimOptions);
        if (attempt > 1) {
          this.logger.log(`FFmpeg succeeded on attempt ${attempt}`);
        }
        return; // Success!
      } catch (error) {
        lastError = error as Error;
        // Check for NFS timing issues - files not yet visible
        const errorMessage = (error as Error).message || '';
        const isNfsError =
          errorMessage.includes('Impossible to open') ||
          errorMessage.includes('Invalid data found when processing input');

        if (isNfsError && attempt < maxRetries) {
          const delayMs = 2000; // 2 seconds for NFS cache refresh
          this.logger.warn(
            `FFmpeg NFS timing issue (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          // Force NFS cache refresh before retry
          await this.forceNfsCacheRefresh(segmentPaths);
        } else if (attempt >= maxRetries) {
          this.logger.error(
            `FFmpeg failed after ${maxRetries} attempts: ${errorMessage}`,
          );
          throw error;
        } else {
          // Non-NFS error, throw immediately
          throw error;
        }
      }
    }

    throw lastError!;
  }

  /**
   * Execute FFmpeg command with concat demuxer
   *
   * @param concatFile - Path to concat demuxer text file
   * @param outputPath - Path for output MP4 file
   * @param trimOptions - Optional precise trimming parameters
   * @private
   */
  private async runFFmpeg(
    concatFile: string,
    outputPath: string,
    trimOptions?: { startOffset: number; duration: number },
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const inputOptions = [
        '-f',
        'concat', // Use concat demuxer
        '-safe',
        '0', // Allow absolute paths
      ];

      const outputOptions = [
        '-c',
        'copy', // Stream copy (no re-encoding)
        '-movflags',
        '+faststart', // Optimize for web playback
        '-avoid_negative_ts',
        'make_zero', // Normalize timestamps so output starts at 0
      ];

      // Add trim options if provided
      if (trimOptions) {
        // -ss before input is faster but less accurate; after input is frame-accurate
        // Using after input for precision
        outputOptions.unshift('-ss', String(trimOptions.startOffset));
        outputOptions.push('-t', String(trimOptions.duration));
      }

      const command = this.ffmpegProvider
        .createCommand()
        .input(concatFile)
        .inputOptions(...inputOptions)
        .outputOptions(...outputOptions)
        .output(outputPath)
        .on('start', (commandLine) => {
          this.logger.debug(`FFmpeg command: ${String(commandLine)}`);
        })
        .on('progress', (progress) => {
          const progressData = progress as { percent?: number };
          if (progressData.percent) {
            this.logger.debug(
              `Processing: ${Math.round(progressData.percent)}%`,
            );
          }
        })
        .on('end', () => {
          this.logger.debug('FFmpeg processing completed');
          resolve();
        })
        .on('error', (err, _stdout, stderr) => {
          const error = err as Error;
          this.logger.error('FFmpeg error:', error.message);
          this.logger.error('FFmpeg stderr:', stderr);
          // Include stderr in error message so retry logic can detect NFS issues
          reject(
            new Error(`FFmpeg failed: ${error.message}\n${String(stderr)}`),
          );
        });

      // Set a timeout to prevent hung processes (10 minutes max)
      const timeout = setTimeout(
        () => {
          command.kill('SIGKILL');
          reject(new Error('FFmpeg process timed out after 10 minutes'));
        },
        10 * 60 * 1000,
      );

      command.on('end', () => clearTimeout(timeout));
      command.on('error', () => clearTimeout(timeout));

      command.run();
    });
  }

  /**
   * Get actual video duration from file using FFprobe
   *
   * @param filePath - Path to video file
   * @returns Duration in seconds
   */
  async getVideoDuration(filePath: string): Promise<number> {
    try {
      const metadata = await this.ffmpegProvider.ffprobe(filePath);
      const duration = metadata?.format?.duration || 0;
      this.logger.debug(`Video duration: ${duration}s`);
      return duration;
    } catch (err) {
      this.logger.error(
        `Failed to probe video duration: ${getErrorMessage(err)}`,
      );
      throw new InternalServerErrorException(
        `FFprobe failed: ${getErrorMessage(err)}`,
      );
    }
  }

  /**
   * Get estimated duration from segment count
   *
   * @param segmentCount - Number of segments
   * @param segmentDurationSeconds - Duration of each segment (default: 10s)
   * @returns Estimated total duration in seconds
   */
  getEstimatedDuration(
    segmentCount: number,
    segmentDurationSeconds: number = 10,
  ): number {
    return segmentCount * segmentDurationSeconds;
  }

  /**
   * Get estimated file size from duration
   *
   * @param durationSeconds - Duration in seconds
   * @param bitrateKbps - Estimated bitrate in kbps (default: 6000 for H.264 720p30)
   * @returns Estimated file size in bytes
   */
  getEstimatedFileSize(
    durationSeconds: number,
    bitrateKbps: number = 6000,
  ): number {
    // Size (bytes) = (bitrate * duration) / 8
    return Math.ceil((bitrateKbps * 1000 * durationSeconds) / 8);
  }
}
