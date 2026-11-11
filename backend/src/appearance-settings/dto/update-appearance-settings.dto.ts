import { IsOptional, IsIn } from 'class-validator';
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
}
