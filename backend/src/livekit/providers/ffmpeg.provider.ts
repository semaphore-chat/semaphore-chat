import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import * as ffmpeg from 'fluent-ffmpeg';
import { MEDIA_MAX_PIXELS } from '@/common/constants/media-limits.constant';

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

/** The `-show_streams` fields the backend reads. */
export interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: Record<string, string | undefined>;
  side_data_list?: Array<{ rotation?: number | string } | undefined>;
}

/** The parsed output of `ffprobe -print_format json -show_streams`. */
export interface FfprobeStreams {
  streams: FfprobeStream[];
}

/**
 * A decoder option that makes FFmpeg refuse frames over the pixel cap
 * instead of allocating them: a 2 MB PNG can otherwise decode to 2 GB.
 */
const MAX_PIXELS_OPTION = ['-max_pixels', String(MEDIA_MAX_PIXELS)];

/** ffprobe's JSON for a file's streams is small; cap it anyway. */
const FFPROBE_MAX_BUFFER = 1024 * 1024;

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
      ffmpeg.ffprobe(filePath, MAX_PIXELS_OPTION, (err, metadata) => {
        if (err) {
          reject(err as Error);
        } else {
          resolve(metadata);
        }
      });
    });
  }

  /**
   * Probe a media file's streams, killing ffprobe once `timeoutMs` passes.
   *
   * fluent-ffmpeg's ffprobe() cannot be stopped from outside, so a probe that
   * hangs on a bad file would outlive the caller. This runs the same binary
   * (`FFPROBE_PATH` when set, otherwise `ffprobe` from `PATH`) directly.
   *
   * @param filePath - Path to media file, passed as its own argument
   * @param timeoutMs - Time after which ffprobe is killed with SIGKILL
   * @returns Promise with the parsed `-show_streams` output
   */
  probeStreams(filePath: string, timeoutMs: number): Promise<FfprobeStreams> {
    // `Promise.withResolvers` is not in this tsconfig's lib target.
    return new Promise<FfprobeStreams>((resolve, reject) => {
      execFile(
        process.env.FFPROBE_PATH?.trim() || 'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_streams',
          ...MAX_PIXELS_OPTION,
          filePath,
        ],
        {
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: FFPROBE_MAX_BUFFER,
        },
        (error, stdout) => {
          if (error) {
            reject(
              error.killed
                ? new Error(`ffprobe timed out after ${timeoutMs} ms`)
                : error,
            );
            return;
          }

          try {
            const parsed = JSON.parse(stdout) as {
              streams?: FfprobeStream[];
            };
            resolve({
              streams: Array.isArray(parsed?.streams) ? parsed.streams : [],
            });
          } catch {
            reject(new Error('ffprobe returned unparsable output'));
          }
        },
      );
    });
  }
}
