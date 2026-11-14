/**
 * Limits on decoding untrusted media with ffprobe/ffmpeg.
 *
 * A small file can decode to gigabytes: a 2 MB 16000×16000 PNG takes ~2 GB
 * in ffprobe and ~2.3 GB in the thumbnail ffmpeg, over the backend's 1 GiB
 * container limit. Images over the pixel cap are refused at upload, every
 * decode passes the cap to FFmpeg as `-max_pixels`, and only a few decodes
 * run at once.
 */

/** Largest image (width × height) accepted and decoded: 50 megapixels. */
export const MEDIA_MAX_PIXELS = 50_000_000;

/**
 * ffprobe/ffmpeg processes on untrusted uploads that may run at once. A
 * decode at the pixel cap peaks at ~510 MB (16-bit RGBA PNG), so a second
 * one alongside the backend would pass the 1 GiB limit.
 */
export const MEDIA_PROCESS_SLOTS = 1;

/**
 * How long a probe or thumbnail waits for a free slot before it is skipped
 * (the upload is then stored without dimensions or a thumbnail).
 */
export const MEDIA_SLOT_WAIT_MS = 10_000;

/**
 * Bytes read from the start of an image to find its dimensions. A JPEG's
 * frame header can follow EXIF, ICC and XMP segments; past this bound the
 * size counts as unknown and the `-max_pixels` cap still applies.
 */
export const IMAGE_HEADER_MAX_BYTES = 512 * 1024;
