import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTokenDto {
  @IsString()
  @IsNotEmpty()
  identity: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  /**
   * Ignored: the display name in the token is the account's. Accepted because
   * clients send it, and the whitelist would otherwise only strip it.
   */
  @IsOptional()
  @IsString()
  name?: string;

  /**
   * Token TTL in seconds. Capped at 3600 (1 hour, the default) so that a
   * user removed from a channel/DM keeps lingering room access only until
   * their current token expires — an unbounded client-supplied TTL would
   * turn that window into effectively permanent access.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3600)
  @ApiPropertyOptional({ type: 'integer' })
  ttl?: number;
}
