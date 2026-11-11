import { ApiProperty } from '@nestjs/swagger';

/** A time-limited URL for downloading one file. */
export class SignedUrlResponseDto {
  @ApiProperty({ description: 'Signed URL that authorizes the download' })
  url: string;

  @ApiProperty({ description: 'ISO-8601 timestamp when the URL expires' })
  expiresAt: string;
}
