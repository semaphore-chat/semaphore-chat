import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Slim representation of a GIF result. Provider-agnostic shape; populated by
 * whichever GifProvider is registered (see providers/gif-provider.interface.ts).
 *
 * A result offers up to three renditions: the original, a medium one (sent by
 * clients that render it in a message, so a multi-megabyte original isn't
 * downloaded) and the small preview used in the picker grid. Each rendition's
 * width, height and byte size is optional: a provider may omit them, or send
 * something a client can't use (missing, empty, non-numeric, zero or absurd),
 * in which case the fields are absent rather than `NaN`.
 */
export class GifResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  /** Full-size animated GIF URL (Giphy: images.original.url) — sent as message content when there is no smaller one. */
  @ApiProperty()
  url: string;

  /** Small animated preview used in the picker grid (Giphy: images.fixed_height.url). */
  @ApiProperty()
  previewUrl: string;

  /** Original rendition width in pixels; 0 when the provider doesn't report it. */
  @ApiProperty({ type: 'integer' })
  width: number;

  /** Original rendition height in pixels; 0 when the provider doesn't report it. */
  @ApiProperty({ type: 'integer' })
  height: number;

  /**
   * Medium rendition URL, the one clients should send for a message: Giphy's
   * `downsized_medium`, else `downsized`, else the original. Absent only if the
   * provider offers no rendition a client may load (see `url`).
   */
  @ApiPropertyOptional()
  mediumUrl?: string;

  /** Medium rendition width in pixels; absent when unknown. */
  @ApiPropertyOptional({ type: 'integer' })
  mediumWidth?: number;

  /** Medium rendition height in pixels; absent when unknown. */
  @ApiPropertyOptional({ type: 'integer' })
  mediumHeight?: number;

  /** Medium rendition size in bytes; absent when unknown. */
  @ApiPropertyOptional({ type: 'integer' })
  mediumSizeBytes?: number;

  /** Original rendition size in bytes; absent when unknown. */
  @ApiPropertyOptional({ type: 'integer' })
  originalSizeBytes?: number;

  /** Preview rendition width in pixels; absent when unknown. */
  @ApiPropertyOptional({ type: 'integer' })
  previewWidth?: number;

  /** Preview rendition height in pixels; absent when unknown. */
  @ApiPropertyOptional({ type: 'integer' })
  previewHeight?: number;

  /** Preview rendition size in bytes; absent when unknown. */
  @ApiPropertyOptional({ type: 'integer' })
  previewSizeBytes?: number;
}

export class GifSearchResponseDto {
  @ApiProperty({ type: [GifResultDto] })
  results: GifResultDto[];

  /** Opaque pagination cursor for the next page; undefined when exhausted. */
  @ApiPropertyOptional()
  next?: string;
}
