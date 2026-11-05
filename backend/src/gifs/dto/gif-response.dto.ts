import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Slim representation of a GIF result — only the fields the composer picker
 * and message-send flow need. Provider-agnostic shape; populated by
 * whichever GifProvider is registered (see providers/gif-provider.interface.ts).
 */
export class GifResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  /** Full-size animated GIF URL (Giphy: images.original.url) — sent as message content. */
  @ApiProperty()
  url: string;

  /** Small animated preview used in the picker grid (Giphy: images.fixed_height.url). */
  @ApiProperty()
  previewUrl: string;

  @ApiProperty({ type: 'integer' })
  width: number;

  @ApiProperty({ type: 'integer' })
  height: number;
}

export class GifSearchResponseDto {
  @ApiProperty({ type: [GifResultDto] })
  results: GifResultDto[];

  /** Opaque pagination cursor for the next page; undefined when exhausted. */
  @ApiPropertyOptional()
  next?: string;
}
