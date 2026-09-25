import { Injectable } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';

/**
 * Interface for FFmpeg command that can be chained
 */
export interface FfmpegCommand {
  input: (source: string) => FfmpegCommand;
  inputOptions: (...options: string[]) => FfmpegCommand;
  outputOptions: (...options: string[]) => FfmpegCommand;
  output: (target: string) => FfmpegCommand;
  on: (event: string, callback: (...args: unknown[]) => void) => FfmpegCommand;
  run: () => void;
  kill: (signal?: string) => void;
}

/**
 * FFmpeg Provider
 *
 * Wraps fluent-ffmpeg to enable proper dependency injection and testability.
 * This abstraction allows services to use FFmpeg without directly importing
 * the library, making unit tests cleaner and more reliable.
 */
@Injectable()
export class FfmpegProvider {
  /**
   * Create a new FFmpeg command instance
   */
  createCommand(): FfmpegCommand {
    return ffmpeg();
  }

  /**
   * Probe media file to get metadata
   *
   * @param filePath - Path to media file
   * @returns Promise with ffprobe metadata
   */
  ffprobe(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err as Error);
        } else {
          resolve(metadata);
        }
      });
    });
  }
}
