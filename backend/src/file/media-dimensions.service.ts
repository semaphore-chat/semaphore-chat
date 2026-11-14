import { Injectable, Logger } from '@nestjs/common';
import {
  FfmpegProvider,
  FfprobeStream,
  FfprobeStreams,
} from '@/livekit/providers/ffmpeg.provider';
import {
  exceedsMediaPixelCap,
  readImageSizeFromFile,
} from '@/common/utils/image-header.util';
import { mediaProcessSlots } from '@/common/utils/process-slots.util';

/** The pixels an attachment occupies once displayed. */
export interface MediaDimensions {
  width: number;
  height: number;
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

    // Never decode an image the header says is over the pixel cap (upload
    // validation refuses these; this guards every other caller).
    if (mimeType.toLowerCase().startsWith('image/')) {
      const size = await readImageSizeFromFile(filePath);
      if (exceedsMediaPixelCap(size)) {
        this.logger.debug(
          `Not probing ${size!.width}×${size!.height} image ${filePath}: over the pixel cap`,
        );
        return null;
      }
    }

    try {
      // The provider kills ffprobe at the limit, so a hung probe on a bad
      // file cannot pile up processes behind abandoned uploads; the slot
      // bounds how many decodes run at once.
      const probe = await mediaProcessSlots.run(() =>
        this.ffmpegProvider.probeStreams(filePath, timeoutMs),
      );

      const dimensions = this.fromStreams(probe);
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
    }
  }

  /** Only images and videos have dimensions; SVG is resolution-independent. */
  private isMeasurable(mimeType: string): boolean {
    const type = mimeType.toLowerCase();
    if (type === 'image/svg+xml') return false;
    return type.startsWith('image/') || type.startsWith('video/');
  }

  private fromStreams(probe: FfprobeStreams): MediaDimensions | null {
    const streams = probe?.streams ?? [];
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
  private rotationOf(stream: FfprobeStream): number {
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
