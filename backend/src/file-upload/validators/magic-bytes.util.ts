import { open } from 'fs/promises';

/** How far into an MP3 the first frame sync may start (after padding). */
const MP3_SYNC_SEARCH_BYTES = 4096;

/**
 * Number of leading bytes read to identify the supported formats: the image
 * and container signatures need at most 12, but an MP3 without an ID3 tag
 * may start its first frame anywhere in the first 4 KB.
 */
export const MAGIC_BYTES_HEADER_LENGTH = MP3_SYNC_SEARCH_BYTES + 4;

const isJpeg = (b: Buffer): boolean =>
  b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * SVG is XML text with no binary signature. Accept if the first
 * non-whitespace byte (after an optional UTF-8 BOM) is '<', which rules out
 * renamed binaries while keeping legitimate SVG attachments working.
 */
const isSvgLike = (b: Buffer): boolean => {
  let i = 0;
  // Skip UTF-8 BOM
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    i = 3;
  }
  // Skip leading whitespace
  while (i < b.length && [0x09, 0x0a, 0x0d, 0x20].includes(b[i])) {
    i++;
  }
  return i < b.length && b[i] === 0x3c; // '<'
};

const IMAGE_SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': isJpeg,
  'image/jpg': isJpeg, // non-standard alias accepted by the strategies
  'image/png': (b) =>
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  'image/gif': (b) =>
    b.length >= 6 && b.subarray(0, 3).toString('ascii') === 'GIF',
  'image/webp': (b) =>
    b.length >= 12 &&
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP',
  'image/svg+xml': isSvgLike,
};

const ascii = (b: Buffer, start: number, end: number): string =>
  b.length >= end ? b.subarray(start, end).toString('latin1') : '';

const isRiff = (b: Buffer, form: string): boolean =>
  (ascii(b, 0, 4) === 'RIFF' || ascii(b, 0, 4) === 'RF64') &&
  ascii(b, 8, 12) === form;

/** Matroska/WebM: the EBML magic number. */
const isEbml = (b: Buffer): boolean =>
  b.length >= 4 &&
  b[0] === 0x1a &&
  b[1] === 0x45 &&
  b[2] === 0xdf &&
  b[3] === 0xa3;

const isOgg = (b: Buffer): boolean => ascii(b, 0, 4) === 'OggS';

/** ISO base media (MP4, MOV, M4A): a top-level box type at offset 4. */
const ISO_BOX_TYPES = new Set([
  'ftyp',
  'moov',
  'mdat',
  'wide',
  'free',
  'skip',
  'pnot',
]);
const isIsoMedia = (b: Buffer): boolean => ISO_BOX_TYPES.has(ascii(b, 4, 8));

const hasId3Tag = (b: Buffer): boolean => ascii(b, 0, 3) === 'ID3';

/** An AAC ADTS frame header: 12-bit sync and layer 00. */
const isAdts = (b: Buffer): boolean =>
  b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0;

/** kbps by [MPEG-1 ? 0 : 1][layer 1..3 → 0..2][bitrate index]. */
const MP3_BITRATES = [
  [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  ],
  [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  ],
];
/** Hz by version bits (00 = 2.5, 10 = 2, 11 = 1) and rate index. */
const MP3_SAMPLE_RATES: Record<number, number[]> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};

/**
 * Length in bytes of the MPEG audio frame whose header starts at `i`, or 0
 * when the four bytes there are not a valid frame header (reserved version,
 * layer, bitrate or sample rate, or a free-format bitrate).
 */
function mp3FrameLength(b: Buffer, i: number): number {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[i + 1] >> 3) & 0x03;
  const layerBits = (b[i + 1] >> 1) & 0x03;
  const bitrateIndex = b[i + 2] >> 4;
  const rateIndex = (b[i + 2] >> 2) & 0x03;
  const padding = (b[i + 2] >> 1) & 0x01;
  if (version === 1 || layerBits === 0) return 0;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return 0;

  const layer = 4 - layerBits; // 1, 2 or 3
  const mpeg1 = version === 3;
  const bitrate = MP3_BITRATES[mpeg1 ? 0 : 1][layer - 1][bitrateIndex] * 1000;
  const sampleRate = MP3_SAMPLE_RATES[version][rateIndex];
  if (layer === 1) {
    return (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  }
  const samplesFactor = layer === 3 && !mpeg1 ? 72 : 144;
  return Math.floor((samplesFactor * bitrate) / sampleRate) + padding;
}

/**
 * MP3: an ID3v2 tag, or an MPEG audio frame starting in the first 4 KB
 * (files may begin with padding). A frame counts only when the next frame
 * header follows where its length says, or the frame runs past the bytes
 * read, so stray 0xFF bytes in other content do not pass.
 */
const isMp3 = (b: Buffer): boolean => {
  if (hasId3Tag(b)) return true;
  const searchEnd = Math.min(b.length, MP3_SYNC_SEARCH_BYTES);
  for (let i = 0; i < searchEnd; i++) {
    const length = mp3FrameLength(b, i);
    if (length === 0) continue;
    const next = i + length;
    if (next + 4 > b.length || mp3FrameLength(b, next) > 0) return true;
  }
  return false;
};

/**
 * Signatures for every audio and video MIME type the upload strategies
 * allow. A type missing here fails closed.
 */
const MEDIA_SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'video/mp4': isIsoMedia,
  'video/quicktime': isIsoMedia,
  'video/webm': isEbml,
  'video/ogg': isOgg,
  'video/x-msvideo': (b) => isRiff(b, 'AVI '),
  'audio/mpeg': isMp3,
  'audio/wav': (b) => isRiff(b, 'WAVE'),
  'audio/x-wav': (b) => isRiff(b, 'WAVE'),
  'audio/ogg': isOgg,
  'audio/webm': isEbml,
  // ADTS, an ID3-tagged ADTS stream, or an M4A some systems label audio/aac
  'audio/aac': (b) => isAdts(b) || hasId3Tag(b) || isIsoMedia(b),
};

/**
 * For image, video and audio MIME claims, verify the file content actually
 * starts with that format's magic bytes. Other MIME types pass through
 * (documents and archives are arbitrary); unknown image, video and audio
 * subtypes fail closed.
 */
export function matchesDeclaredMediaType(
  bytes: Buffer,
  mimetype: string,
): boolean {
  if (mimetype.startsWith('image/')) {
    const check = IMAGE_SIGNATURES[mimetype];
    return check ? check(bytes) : false;
  }
  if (mimetype.startsWith('video/') || mimetype.startsWith('audio/')) {
    const check = MEDIA_SIGNATURES[mimetype];
    return check ? check(bytes) : false;
  }
  return true;
}

/**
 * Read the leading bytes of an uploaded file. Multer is configured with disk
 * storage (`dest`), so `file.buffer` is normally absent and the header is
 * read from `file.path`. Falls back to `file.buffer` when present (e.g.
 * memory storage or tests). Returns an empty buffer (fails closed for
 * media types) when the content cannot be read.
 */
export async function readFileHeader(
  file: Express.Multer.File,
  length: number = MAGIC_BYTES_HEADER_LENGTH,
): Promise<Buffer> {
  if (file.buffer && file.buffer.length > 0) {
    return file.buffer.subarray(0, length);
  }

  if (!file.path) {
    return Buffer.alloc(0);
  }

  try {
    const handle = await open(file.path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return Buffer.alloc(0);
  }
}
