import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageDto, ReactionDto } from './message-response.dto';

/** Payloads of the message socket events, in the same document as REST. */

export class NewMessagePayloadDto {
  message: MessageDto;
}

export class UpdateMessagePayloadDto {
  message: MessageDto;
}

export class DeleteMessagePayloadDto {
  messageId: string;
  channelId: string | null;
  directMessageGroupId: string | null;
  /** A moderator removal that keeps the row, or a hard delete. */
  @ApiPropertyOptional({ enum: ['soft', 'hard'], enumName: 'MessageRemoval' })
  removal?: 'soft' | 'hard';
}

export class ReactionAddedPayloadDto {
  messageId: string;
  reaction: ReactionDto;
  channelId: string | null;
  directMessageGroupId: string | null;
  parentMessageId: string | null;
}

export class ReactionRemovedPayloadDto {
  messageId: string;
  emoji: string;
  reactions: ReactionDto[];
  channelId: string | null;
  directMessageGroupId: string | null;
  parentMessageId: string | null;
}

export class NewThreadReplyPayloadDto {
  reply: MessageDto;
  parentMessageId: string;
}

export class ThreadReplyCountUpdatedPayloadDto {
  parentMessageId: string;
  @ApiProperty({ type: 'integer' })
  replyCount: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastReplyAt: string | null;
  channelId: string | null;
  directMessageGroupId: string | null;
}

export class MessagePinnedPayloadDto {
  messageId: string;
  channelId: string;
  pinnedBy: string;
  @ApiProperty({ type: String, format: 'date-time' })
  pinnedAt: string;
}

export class MessageUnpinnedPayloadDto {
  messageId: string;
  channelId: string;
  unpinnedBy: string;
}
