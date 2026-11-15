import {
  IsOptional,
  IsIn,
  IsBoolean,
  Matches,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAppearanceSettingsDto {
  @IsOptional()
  @IsIn(['dark', 'light'])
  @ApiPropertyOptional({ enum: ['dark', 'light'], enumName: 'ThemeMode' })
  themeMode?: string;

  @IsOptional()
  @IsIn([
    'teal',
    'blue',
    'indigo',
    'purple',
    'rose',
    'red',
    'orange',
    'amber',
    'lime',
    'emerald',
    'cyan',
    'slate',
  ])
  @ApiPropertyOptional({
    enum: [
      'teal',
      'blue',
      'indigo',
      'purple',
      'rose',
      'red',
      'orange',
      'amber',
      'lime',
      'emerald',
      'cyan',
      'slate',
    ],
    enumName: 'AccentColor',
  })
  accentColor?: string;

  @IsOptional()
  @IsIn(['minimal', 'balanced', 'vibrant'])
  @ApiPropertyOptional({
    enum: ['minimal', 'balanced', 'vibrant'],
    enumName: 'ThemeIntensity',
  })
  intensity?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'baseColor must be a #rrggbb colour',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @ApiPropertyOptional({
    type: String,
    pattern: '^#[0-9a-f]{6}$',
    example: '#8e75ff',
    description: 'Base colour as lowercase #rrggbb',
  })
  baseColor?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Follow the operating system light/dark setting',
  })
  matchSystem?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Use the new design',
  })
  newDesign?: boolean;
}
