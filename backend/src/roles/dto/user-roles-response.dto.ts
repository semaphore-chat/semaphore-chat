import { RbacActions } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { RbacActionsValues } from '@/common/enums/swagger-enums';

export class RoleDto {
  id: string;
  name: string;
  @ApiProperty({
    enum: RbacActionsValues,
    enumName: 'RbacAction',
    isArray: true,
  })
  actions: RbacActions[];
  createdAt: Date;
  isDefault: boolean;
  @ApiProperty({ type: 'integer' })
  position: number;
}

export class UserRolesResponseDto {
  userId: string;
  resourceId: string | null;
  @ApiProperty({
    enum: ['COMMUNITY', 'CHANNEL', 'INSTANCE'],
    enumName: 'UserRoleResourceType',
    nullable: true,
  })
  resourceType: 'COMMUNITY' | 'CHANNEL' | 'INSTANCE' | null;
  roles: RoleDto[];
}
