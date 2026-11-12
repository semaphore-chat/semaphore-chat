import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { FfprobeData } from 'fluent-ffmpeg';
import { FfmpegProvider } from '@/livekit/providers/ffmpeg.provider';

/** The pixels an attachment occupies once displayed. */
export interface MediaDimensions {
  width: number;
  height: number;
}

/** The ffprobe stream fields dimensions are read from. */
interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: Record<string, string | undefined>;
  side_data_list?: Array<{ rotation?: number | string } | undefined>;
}

/** Upper bound for one probe, matching the timeout style of the FFmpeg runs. */
const MEDIA_PROBE_TIMEOUT_MS = 10 * 1000;

/**
 * Reads an image's or video's display dimensions with the bundled ffprobe.
 *
 * Best-effort by design: an upload must never fail because its dimensions
 * could not be read, so every failure comes back as null. Clients use the
 * values only to reserve the attachment's box before it loads.
 */
@Injectable()
export class MediaDimensionsService {
  private readonly logger = new Logger(MediaDimensionsService.name);

  constructor(private readonly ffmpegProvider: FfmpegProvider) {}

  /**
   * Dimensions of a local media file as displayed, or null when the file is
   * not an image or video, or the probe failed or timed out.
   *
   * @param timeoutMs - upper bound for the probe; tests use a short one
   */
  async read(
    filePath: string,
    mimeType: string,
    timeoutMs: number = MEDIA_PROBE_TIMEOUT_MS,
  ): Promise<MediaDimensions | null> {
    if (!this.isMeasurable(mimeType)) return null;

    const probe = this.ffmpegProvider.ffprobe(filePath);
    // Same bounded-work style as the FFmpeg runs, without holding the
    // process open for a probe that never answers.
    const abort = new AbortController();
    const timedOut = delay(timeoutMs, null, {
      ref: false,
      signal: abort.signal,
    }).then(() => {
      throw new Error(`ffprobe timed out after ${timeoutMs} ms`);
    });

    try {
      const metadata = await Promise.race([probe, timedOut]);

      const dimensions = this.fromMetadata(metadata);
      if (!dimensions) {
        this.logger.debug(
          `ffprobe reported no dimensions for ${mimeType} file ${filePath}`,
        );
      }
      return dimensions;
    } catch (error) {
      this.logger.debug(
        `Could not read dimensions for ${mimeType} file ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    } finally {
      abort.abort();
    }
  }

  /** Only images and videos have dimensions; SVG is resolution-independent. */
  private isMeasurable(mimeType: string): boolean {
    const type = mimeType.toLowerCase();
    if (type === 'image/svg+xml') return false;
    return type.startsWith('image/') || type.startsWith('video/');
  }

  private fromMetadata(metadata: FfprobeData): MediaDimensions | null {
    const streams = (metadata?.streams ?? []) as unknown as ProbeStream[];
    const stream =
      streams.find(
        (candidate) =>
          (candidate.codec_type === 'video' ||
            candidate.codec_type === 'image') &&
          this.positive(candidate.width) &&
          this.positive(candidate.height),
      ) ??
      streams.find(
        (candidate) =>
          this.positive(candidate.width) && this.positive(candidate.height),
      );
    if (!stream) return null;

    const width = Math.round(stream.width as number);
    const height = Math.round(stream.height as number);
    // ffprobe reports the coded size; a 90/270 rotation turns the displayed
    // box on its side (portrait phone videos and photos).
    const rotation = this.rotationOf(stream);
    const portrait = rotation === 90 || rotation === 270;
    return portrait ? { width: height, height: width } : { width, height };
  }

  /** The rotation ffprobe reports, normalised to 0, 90, 180 or 270. */
  private rotationOf(stream: ProbeStream): number {
    const fromSideData = stream.side_data_list
      ?.map((entry) => entry?.rotation)
      .find((rotation) => rotation !== undefined);
    const raw = fromSideData ?? stream.tags?.rotate;
    if (raw === undefined) return 0;

    const degrees = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(degrees)) return 0;
    return ((Math.round(degrees) % 360) + 360) % 360;
  }

  private positive(value: number | undefined): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }
}
