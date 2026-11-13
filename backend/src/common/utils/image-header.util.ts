import { open } from 'fs/promises';
import {
  IMAGE_HEADER_MAX_BYTES,
  MEDIA_MAX_PIXELS,
} from '@/common/constants/media-limits.constant';

/** An image's stored pixel size, as its header declares it. */
export interface ImageSize {
  width: number;
  height: number;
}

/**
 * The pixel size a PNG, GIF, WebP or JPEG header declares, read without
 * decoding anything, so an image too large to decode safely can be refused
 * before ffprobe or ffmpeg runs.
 *
 * The bytes are untrusted: this never throws, and returns null for anything
 * it cannot read (another format, a truncated or malformed header, or a zero
 * dimension). Unknown sizes are still bounded by the `-max_pixels` limit the
 * FFmpeg calls pass.
 */
export function readImageSize(bytes: Buffer): ImageSize | null {
  try {
    const size =
      readPngSize(bytes) ??
      readGifSize(bytes) ??
      readWebpSize(bytes) ??
      readJpegSize(bytes);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * {@link readImageSize} for a file on disk, reading at most
 * `IMAGE_HEADER_MAX_BYTES` from its start. Null when the file can't be read.
 */
export async function readImageSizeFromFile(
  filePath: string,
): Promise<ImageSize | null> {
  try {
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(IMAGE_HEADER_MAX_BYTES);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        IMAGE_HEADER_MAX_BYTES,
        0,
      );
      return readImageSize(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Whether a known size is over the decode cap; an unknown size is not. */
export function exceedsMediaPixelCap(size: ImageSize | null): boolean {
  return size !== null && size.width * size.height > MEDIA_MAX_PIXELS;
}

const latin1 = (b: Buffer, start: number, end: number): string =>
  b.length >= end ? b.toString('latin1', start, end) : '';

const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';

/** PNG: the IHDR chunk, which must come first, holds 32-bit width and height. */
function readPngSize(b: Buffer): ImageSize | null {
  if (latin1(b, 0, 8) !== PNG_SIGNATURE) return null;
  if (b.length < 24 || latin1(b, 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Size in bytes of a GIF colour table whose presence/size sit in `packed`. */
const gifColorTableBytes = (packed: number): number =>
  packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0;

/**
 * GIF: the logical screen, grown to fit every image descriptor found within
 * the bytes given (a frame may be declared larger than the screen). The
 * walk stops at the trailer, at an unknown block or at the end of the bytes.
 */
function readGifSize(b: Buffer): ImageSize | null {
  const signature = latin1(b, 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  if (b.length < 10) return null;

  let width = b.readUInt16LE(6);
  let height = b.readUInt16LE(8);
  if (b.length < 13) return { width, height };

  /** Offset after the data sub-blocks starting at `i`, or -1 if truncated. */
  const skipSubBlocks = (i: number): number => {
    while (i < b.length) {
      const size = b[i];
      i += 1;
      if (size === 0) return i;
      i += size;
    }
    return -1;
  };

  let i = 13 + gifColorTableBytes(b[10]);
  while (i >= 0 && i < b.length) {
    const block = b[i];
    if (block === 0x21) {
      // Extension: introducer, label, then data sub-blocks
      i = skipSubBlocks(i + 2);
    } else if (block === 0x2c) {
      if (i + 10 > b.length) break;
      const left = b.readUInt16LE(i + 1);
      const top = b.readUInt16LE(i + 3);
      width = Math.max(width, left + b.readUInt16LE(i + 5));
      height = Math.max(height, top + b.readUInt16LE(i + 7));
      // Descriptor, local colour table, LZW minimum code size, image data
      i = skipSubBlocks(i + 10 + gifColorTableBytes(b[i + 9]) + 1);
    } else {
      break; // trailer (0x3B) or not a GIF block
    }
  }
  return { width, height };
}

/** WebP: the first chunk's frame (VP8, VP8L) or canvas (VP8X) size. */
function readWebpSize(b: Buffer): ImageSize | null {
  if (latin1(b, 0, 4) !== 'RIFF' || latin1(b, 8, 12) !== 'WEBP') return null;

  switch (latin1(b, 12, 16)) {
    case 'VP8 ':
      // Frame tag (3 bytes), start code 9D 01 2A, then 14-bit sizes
      if (b.length < 30) return null;
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return {
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff,
      };
    case 'VP8L': {
      // Signature 0x2F, then width-1 and height-1 as 14-bit fields
      if (b.length < 25 || b[20] !== 0x2f) return null;
      const bits = b.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    case 'VP8X':
      // Flags and reserved (4 bytes), then 24-bit canvas width-1, height-1;
      // animation frames must fit inside this canvas
      if (b.length < 30) return null;
      return {
        width: b.readUIntLE(24, 3) + 1,
        height: b.readUIntLE(27, 3) + 1,
      };
    default:
      return null;
  }
}

/** Start-of-frame markers: every SOFn except DHT (C4), JPG (C8), DAC (CC). */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * JPEG: walk the marker segments to the first frame header (SOFn), skipping
 * APPn/COM/DQT/DHT segments by their length so an EXIF thumbnail's frame
 * header inside APP1 is never read. Scan data or the end of the image before
 * a frame header, or a malformed segment, means unknown.
 */
function readJpegSize(b: Buffer): ImageSize | null {
  if (b.length < 3 || b[0] !== 0xff || b[1] !== 0xd8) return null;

  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    i += 2;
    // Standalone markers carry no length
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;

    const length = b.readUInt16BE(i);
    if (length < 2) return null;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      // Length (2), precision (1), height (2), width (2)
      if (i + 7 > b.length) return null;
      return { width: b.readUInt16BE(i + 5), height: b.readUInt16BE(i + 3) };
    }
    i += length;
  }
  return null;
}
