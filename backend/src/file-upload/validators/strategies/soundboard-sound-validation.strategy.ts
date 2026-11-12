import { IFileValidationStrategy } from './file-validation-strategy.interface';

/** Soundboard sounds are short clips: every client decodes one into a call. */
export const SOUNDBOARD_SOUND_MAX_SIZE_BYTES = 1024 * 1024; // 1MB
export const SOUNDBOARD_SOUND_MAX_DURATION_SECONDS = 30;

/**
 * Validation strategy for soundboard sounds.
 * Short audio clips only, capped by size AND length: a low-bitrate file can
 * hold minutes of audio in a few hundred kilobytes, and the length is what a
 * call ends up decoding.
 */
export class SoundboardSoundValidationStrategy implements IFileValidationStrategy {
  private readonly allowedMimeTypes = [
    'audio/mpeg', // .mp3
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
  ];

  getAllowedMimeTypes(): string[] {
    return this.allowedMimeTypes;
  }

  getMaxFileSize(): number {
    return SOUNDBOARD_SOUND_MAX_SIZE_BYTES;
  }

  getValidationDescription(): string {
    return `MP3, WAV, OGG, WebM, or AAC audio only, max 1MB and ${SOUNDBOARD_SOUND_MAX_DURATION_SECONDS} seconds (keep clips short)`;
  }
}
