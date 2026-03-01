import { IsString, IsUUID } from 'class-validator';

export class AssignInstanceRoleDto {
  @IsString()
  @IsUUID('all', { message: 'Invalid user ID format' })
  userId: string;
}
