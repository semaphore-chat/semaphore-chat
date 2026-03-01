import { IsString, IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsString()
  @IsUUID()
  userId: string;
}
