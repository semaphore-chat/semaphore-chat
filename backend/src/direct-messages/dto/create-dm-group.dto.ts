import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_DM_GROUP_MEMBERS } from '../direct-messages.constants';

export class CreateDmGroupDto {
  @IsArray()
  @ArrayMaxSize(MAX_DM_GROUP_MEMBERS)
  @IsUUID('all', { each: true })
  userIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;
}
