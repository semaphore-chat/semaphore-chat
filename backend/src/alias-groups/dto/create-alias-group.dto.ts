import {
  IsString,
  IsArray,
  IsOptional,
  MaxLength,
  IsUUID,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateAliasGroupDto {
  @IsString()
  @MinLength(1, { message: 'Group name must not be empty' })
  @MaxLength(50, { message: 'Group name must not exceed 50 characters' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'Group name can only contain letters, numbers, underscores, and hyphens',
  })
  name: string;

  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  memberIds?: string[];
}
