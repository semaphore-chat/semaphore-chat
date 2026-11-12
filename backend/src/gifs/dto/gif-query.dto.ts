import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const DEFAULT_GIF_LIMIT = 20;
export const MAX_GIF_LIMIT = 50;

export class GifQueryDto {
  /** Number of GIFs to return, 1 to 50. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GIF_LIMIT)
  @Type(() => Number)
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_GIF_LIMIT,
    default: DEFAULT_GIF_LIMIT,
  })
  limit: number = DEFAULT_GIF_LIMIT;

  /** Provider cursor from the previous page. */
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  pos?: string;
}
