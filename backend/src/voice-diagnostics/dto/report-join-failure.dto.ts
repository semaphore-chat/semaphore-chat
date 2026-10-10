import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** How the client classified a failed voice join (frontend joinFailure.ts). */
export const VOICE_JOIN_ERROR_CLASSES = [
  'media_unreachable',
  'server_unreachable',
  'permission',
  'not_found',
  'session',
  'server_error',
  'unknown',
] as const;
export type VoiceJoinErrorClass = (typeof VOICE_JOIN_ERROR_CLASSES)[number];

export const ICE_CANDIDATE_TYPES = ['host', 'srflx', 'prflx', 'relay'] as const;
export const VOICE_CLIENT_PLATFORMS = ['web', 'electron'] as const;

export const JOIN_FAILURE_MESSAGE_MAX = 500;

const truncate =
  (max: number) =>
  ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.slice(0, max) : value;

/**
 * One failed voice join, reported by the client for troubleshooting. No media
 * and no message content: only what helps tell a blocked network from a
 * permission or server problem.
 */
export class ReportJoinFailureDto {
  @ApiProperty({ enum: VOICE_JOIN_ERROR_CLASSES })
  @IsIn(VOICE_JOIN_ERROR_CLASSES)
  errorClass: VoiceJoinErrorClass;

  @ApiProperty({ maxLength: JOIN_FAILURE_MESSAGE_MAX })
  @Transform(truncate(JOIN_FAILURE_MESSAGE_MAX))
  @IsString()
  @MaxLength(JOIN_FAILURE_MESSAGE_MAX)
  message: string;

  @ApiProperty({ description: 'How long the attempt took, in ms' })
  @IsInt()
  @Min(0)
  @Max(10 * 60 * 1000)
  durationMs: number;

  @ApiPropertyOptional({ enum: ICE_CANDIDATE_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ICE_CANDIDATE_TYPES.length)
  @IsIn(ICE_CANDIDATE_TYPES, { each: true })
  candidateTypes?: (typeof ICE_CANDIDATE_TYPES)[number][];

  @ApiProperty({ enum: VOICE_CLIENT_PLATFORMS })
  @IsIn(VOICE_CLIENT_PLATFORMS)
  platform: (typeof VOICE_CLIENT_PLATFORMS)[number];

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @Transform(truncate(64))
  @IsString()
  @MaxLength(64)
  os?: string;

  @ApiProperty({ maxLength: 64 })
  @Transform(truncate(64))
  @IsString()
  @MaxLength(64)
  appVersion: string;

  @ApiPropertyOptional({ description: 'The voice channel, for channel joins' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  channelId?: string;

  @ApiProperty({ description: 'A DM call (no channel id is sent for DMs)' })
  @IsBoolean()
  isDm: boolean;
}
