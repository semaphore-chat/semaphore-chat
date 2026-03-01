import { IsArray, IsUUID } from 'class-validator';

export class UpdateMembersDto {
  @IsArray()
  @IsUUID('all', { each: true })
  memberIds: string[];
}
