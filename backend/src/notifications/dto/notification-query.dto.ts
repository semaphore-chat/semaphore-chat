import { IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationQueryDto {
  /** Only return unread notifications. Absent means all of them. */
  // Query params arrive as strings and `Boolean('false')` is true, so
  // 'true'/'false' are parsed explicitly.
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    // Anything else is left for @IsBoolean to reject.
    return value;
  })
  unreadOnly?: boolean = false;

  /** Include dismissed notifications in the page and total. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    // Anything else is left for @IsBoolean to reject.
    return value;
  })
  includeDismissed?: boolean = true;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @ApiPropertyOptional({ type: 'integer' })
  limit?: number = 50;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @ApiPropertyOptional({ type: 'integer' })
  offset?: number = 0;
}
