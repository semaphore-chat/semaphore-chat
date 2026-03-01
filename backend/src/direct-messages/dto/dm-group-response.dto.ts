import { ApiProperty } from '@nestjs/swagger';
import { SpanDto } from '@/messages/dto/message-response.dto';

export class DmGroupMemberUserDto {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export class DmGroupMemberDto {
  id: string;
  userId: string;
  joinedAt: Date;
  user: DmGroupMemberUserDto;
}

export class DmGroupLastMessageDto {
  id: string;
  authorId: string | null;
  @ApiProperty({ type: [SpanDto] })
  spans: SpanDto[];
  sentAt: Date;
}

export class DmGroupResponseDto {
  id: string;
  name?: string | null;
  isGroup: boolean;
  createdAt: Date;
  @ApiProperty({ type: [DmGroupMemberDto] })
  members: DmGroupMemberDto[];
  @ApiProperty({ type: DmGroupLastMessageDto, nullable: true, required: false })
  lastMessage?: DmGroupLastMessageDto | null;
}
