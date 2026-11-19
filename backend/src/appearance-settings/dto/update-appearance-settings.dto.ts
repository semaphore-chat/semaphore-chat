import {
  ValidateIf,
  IsIn,
  IsBoolean,
  Matches,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAppearanceSettingsDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['dark', 'light'])
  @ApiPropertyOptional({ enum: ['dark', 'light'], enumName: 'ThemeMode' })
  themeMode?: string;

  @ValidateIf((_, value) => value !== undefined)
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

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['minimal', 'balanced', 'vibrant'])
  @ApiPropertyOptional({
    enum: ['minimal', 'balanced', 'vibrant'],
    enumName: 'ThemeIntensity',
  })
  intensity?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'baseColor must be a #rrggbb colour',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @ApiPropertyOptional({
    type: String,
    pattern: '^#[0-9a-fA-F]{6}$',
    example: '#8e75ff',
    description:
      'Base colour as six hex digits, either case; stored as lowercase #rrggbb',
  })
  baseColor?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Follow the operating system light/dark setting',
  })
  matchSystem?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Use the new design',
  })
  newDesign?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Load pictures, site icons, GIFs and webhook avatars from other sites automatically (false: text only)',
  })
  loadRemoteContent?: boolean;
}
