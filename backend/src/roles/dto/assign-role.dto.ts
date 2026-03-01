import { IsString, IsUUID } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  @IsUUID('all', { message: 'Invalid user ID format' })
  userId: string;

  @IsString()
  @IsUUID('all', { message: 'Invalid role ID format' })
  roleId: string;
}
