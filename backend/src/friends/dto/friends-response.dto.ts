import { FriendshipStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { FriendshipStatusValues } from '@/common/enums/swagger-enums';
import { UserEntity } from '@/user/dto/user-response.dto';

export class FriendshipDto {
  id: string;
  userAId: string;
  userBId: string;
  @ApiProperty({ enum: FriendshipStatusValues })
  status: FriendshipStatus;
  createdAt: Date;
}

export class FriendshipWithUsersDto {
  id: string;
  userAId: string;
  userBId: string;
  @ApiProperty({ enum: FriendshipStatusValues })
  status: FriendshipStatus;
  createdAt: Date;
  userA: UserEntity;
  userB: UserEntity;
}

export class PendingRequestsDto {
  sent: FriendshipWithUsersDto[];
  received: FriendshipWithUsersDto[];
}

export class FriendshipStatusDto {
  @ApiProperty({ enum: FriendshipStatusValues, nullable: true })
  status: FriendshipStatus | null;
  friendshipId: string | null;
  @ApiProperty({ enum: ['sent', 'received'], nullable: true })
  direction: 'sent' | 'received' | null;
}

export class FriendListItemDto extends UserEntity {
  @ApiProperty()
  friendshipId: string;

  constructor(friendshipId: string, partial: Partial<UserEntity>) {
    super(partial);
    this.friendshipId = friendshipId;
  }
}
