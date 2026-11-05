import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class TimeoutUserDto {
  @IsInt()
  @Min(60) // Minimum 1 minute
  @Max(2419200) // Maximum 28 days (in seconds)
  @ApiProperty({ type: 'integer' })
  durationSeconds: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class RemoveTimeoutDto {
  @IsString()
  @IsOptional()
  reason?: string; // Reason for removing timeout (for audit log)
}
