import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { MAX_DM_GROUP_MEMBERS } from '../direct-messages.constants';

export class AddMembersDto {
  @IsArray()
  @ArrayMaxSize(MAX_DM_GROUP_MEMBERS)
  @IsUUID('all', { each: true })
  userIds: string[];
}
