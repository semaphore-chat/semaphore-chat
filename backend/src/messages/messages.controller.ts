import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  Logger,
  Query,
  Req,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { ReactionsService } from './reactions.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { AddReactionDto } from './dto/add-reaction.dto';
import { RemoveReactionDto } from './dto/remove-reaction.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { PermissionsService } from '@/roles/permissions.service';
import { RbacGuard } from '@/auth/rbac.guard';
import { MessageOwnershipGuard } from '@/auth/message-ownership.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';

import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { AuthenticatedRequest } from '@/types';
import {
  AnchoredMessagesResponseDto,
  EnrichedMessageDto,
  MessageDto,
  PaginatedMessagesResponseDto,
} from './dto/message-response.dto';
import { groupReactions } from '@/common/utils/reactions.utils';
import { RoomName } from '@/common/utils/room-name.util';
import { toWireMessage } from '@/common/utils/message-wire.utils';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { LINK_PREVIEWS_QUEUE } from '@/jobs/jobs.constants';
import { LinkPreviewJobData } from '@/jobs/jobs.types';

@Controller('messages')
@UseGuards(JwtAuthGuard, RbacGuard)
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly reactionsService: ReactionsService,
    private readonly websocketService: WebsocketService,
    private readonly permissionsService: PermissionsService,
    @InjectQueue(LINK_PREVIEWS_QUEUE)
    private readonly linkPreviewsQueue: Queue<LinkPreviewJobData>,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ type: EnrichedMessageDto })
  @RequiredActions(RbacActions.CREATE_MESSAGE)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.BODY,
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() createMessageDto: CreateMessageDto,
  ): Promise<EnrichedMessageDto> {
    const message = await this.messagesService.create({
      ...createMessageDto,
      authorId: req.user.id,
      sentAt: new Date(),
    });
    // Enrich with file metadata for consistent response shape
    return this.messagesService.enrichMessageWithFileMetadata(message);
  }

  @Get('/group/:groupId')
  @ApiOkResponse({ type: PaginatedMessagesResponseDto })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.DM_GROUP,
    idKey: 'groupId',
    source: ResourceIdSource.PARAM,
  })
  @ApiQuery({ name: 'direction', required: false, enum: ['older', 'newer'] })
  findAllForGroup(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('continuationToken') continuationToken?: string,
    @Query('direction') direction?: string,
  ): Promise<PaginatedMessagesResponseDto> {
    limit = Math.min(limit, 100);
    const dir = direction === 'newer' ? 'newer' : 'older';
    return this.messagesService.findAllForDirectMessageGroup(
      groupId,
      limit,
      continuationToken,
      dir,
    );
  }

  @Get('/channel/:channelId')
  @ApiOkResponse({ type: PaginatedMessagesResponseDto })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  @ApiQuery({ name: 'direction', required: false, enum: ['older', 'newer'] })
  findAllForChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('continuationToken') continuationToken?: string,
    @Query('direction') direction?: string,
  ): Promise<PaginatedMessagesResponseDto> {
    limit = Math.min(limit, 100);
    const dir = direction === 'newer' ? 'newer' : 'older';
    return this.messagesService.findAllForChannel(
      channelId,
      limit,
      continuationToken,
      dir,
    );
  }

  @Get('/channel/:channelId/around/:messageId')
  @ApiOkResponse({ type: AnchoredMessagesResponseDto })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  findAroundForChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<AnchoredMessagesResponseDto> {
    limit = Math.min(limit, 100);
    return this.messagesService.findAroundForChannel(
      channelId,
      messageId,
      limit,
    );
  }

  @Get('/group/:groupId/around/:messageId')
  @ApiOkResponse({ type: AnchoredMessagesResponseDto })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.DM_GROUP,
    idKey: 'groupId',
    source: ResourceIdSource.PARAM,
  })
  findAroundForGroup(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<AnchoredMessagesResponseDto> {
    limit = Math.min(limit, 100);
    return this.messagesService.findAroundForDirectMessageGroup(
      groupId,
      messageId,
      limit,
    );
  }

  @Get('search/channel/:channelId')
  @ApiOkResponse({ type: [EnrichedMessageDto] })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  searchChannelMessages(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('q') query: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<EnrichedMessageDto[]> {
    limit = Math.min(limit, 100);
    return this.messagesService.searchChannelMessages(channelId, query, limit);
  }

  @Get('search/group/:groupId')
  @ApiOkResponse({ type: [EnrichedMessageDto] })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.DM_GROUP,
    idKey: 'groupId',
    source: ResourceIdSource.PARAM,
  })
  searchDirectMessages(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query('q') query: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<EnrichedMessageDto[]> {
    limit = Math.min(limit, 100);
    return this.messagesService.searchDirectMessages(groupId, query, limit);
  }

  @Get('search/community/:communityId')
  @ApiOkResponse({ type: [EnrichedMessageDto] })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  searchCommunityMessages(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('q') query: string,
    @Req() req: AuthenticatedRequest,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<EnrichedMessageDto[]> {
    limit = Math.min(limit, 100);
    return this.messagesService.searchCommunityMessages(
      communityId,
      req.user.id,
      query,
      limit,
    );
  }

  @Post('reactions')
  @ApiCreatedResponse({ type: MessageDto })
  @RequiredActions(RbacActions.CREATE_REACTION)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.BODY,
  })
  async addReaction(
    @Body() addReactionDto: AddReactionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.reactionsService.addReaction(
      addReactionDto.messageId,
      addReactionDto.emoji,
      req.user.id,
    );

    // Emit WebSocket event
    const groupedReactions = groupReactions(result.reactions);
    const roomId = result.directMessageGroupId
      ? RoomName.dmGroup(result.directMessageGroupId)
      : result.channelId;
    if (roomId) {
      const reaction = groupedReactions.find(
        (r) => r.emoji === addReactionDto.emoji,
      );
      this.websocketService.sendToRoom(roomId, ServerEvents.REACTION_ADDED, {
        messageId: result.id,
        // Non-null: addReactionDto.emoji was just added into result.reactions
        // above, so groupReactions() output must contain a matching group.
        reaction: reaction!,
        channelId: result.channelId ?? null,
        directMessageGroupId: result.directMessageGroupId ?? null,
        parentMessageId: result.parentMessageId ?? null,
      });
    }

    return {
      ...result,
      reactions: groupedReactions,
    };
  }

  @Delete('reactions')
  @ApiOkResponse({ type: MessageDto })
  @RequiredActions(RbacActions.DELETE_REACTION)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.BODY,
  })
  async removeReaction(
    @Body() removeReactionDto: RemoveReactionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.reactionsService.removeReaction(
      removeReactionDto.messageId,
      removeReactionDto.emoji,
      req.user.id,
    );

    // Emit WebSocket event
    const groupedReactions = groupReactions(result.reactions);
    const roomId = result.directMessageGroupId
      ? RoomName.dmGroup(result.directMessageGroupId)
      : result.channelId;
    if (roomId) {
      this.websocketService.sendToRoom(roomId, ServerEvents.REACTION_REMOVED, {
        messageId: result.id,
        emoji: removeReactionDto.emoji,
        reactions: groupedReactions,
        channelId: result.channelId ?? null,
        directMessageGroupId: result.directMessageGroupId ?? null,
        parentMessageId: result.parentMessageId ?? null,
      });
    }

    return {
      ...result,
      reactions: groupedReactions,
    };
  }

  @Post(':id/attachments')
  @ApiCreatedResponse({ type: EnrichedMessageDto })
  @UseGuards(JwtAuthGuard, MessageOwnershipGuard)
  async addAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() addAttachmentDto: AddAttachmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // First get the original message to know which room to notify
    const originalMessage = await this.messagesService.findOne(id);

    // Attaching a file needs ATTACH_FILES in the channel (releasing a
    // pending slot without a file doesn't)
    if (addAttachmentDto.fileId && originalMessage.channelId) {
      await this.permissionsService.assertCanAttachFiles(
        req.user.id,
        originalMessage.channelId,
      );
    }

    // Add the attachment and decrement pendingAttachments
    // If fileId is omitted (upload failed), just decrements counter
    const updatedMessage = await this.messagesService.addAttachment(
      id,
      addAttachmentDto.fileId,
    );

    // Enrich message with file metadata before emitting
    const enrichedMessage =
      this.messagesService.enrichMessageWithFileMetadata(updatedMessage);

    // Emit WebSocket event to the room
    const roomId = originalMessage.directMessageGroupId
      ? RoomName.dmGroup(originalMessage.directMessageGroupId)
      : originalMessage.channelId;
    if (roomId) {
      this.websocketService.sendToRoom(roomId, ServerEvents.UPDATE_MESSAGE, {
        message: toWireMessage(enrichedMessage),
      });
    }

    return enrichedMessage;
  }

  @Get(':id')
  @ApiOkResponse({ type: EnrichedMessageDto })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EnrichedMessageDto> {
    const message = await this.messagesService.findOne(id);
    // Enrich with file metadata for consistent response shape
    return this.messagesService.enrichMessageWithFileMetadata(message);
  }

  @Patch(':id')
  @ApiOkResponse({ type: EnrichedMessageDto })
  @UseGuards(JwtAuthGuard, MessageOwnershipGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateMessageDto: UpdateMessageDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<EnrichedMessageDto> {
    // First get the original message to know which channel to notify
    const originalMessage = await this.messagesService.findOne(id);

    // Update the message, passing original attachment file IDs for cleanup
    const originalFileIds = originalMessage.attachments.map(
      (a: { id: string }) => a.id,
    );

    // Adding files in an edit needs ATTACH_FILES like sending them
    const addsFiles = (updateMessageDto.attachments ?? []).some(
      (fileId) => !originalFileIds.includes(fileId),
    );
    if (addsFiles && originalMessage.channelId) {
      await this.permissionsService.assertCanAttachFiles(
        req.user.id,
        originalMessage.channelId,
      );
    }
    const updatedMessage = await this.messagesService.update(
      id,
      updateMessageDto,
      originalFileIds,
    );

    // Enrich with file metadata for consistent response shape
    const enrichedMessage =
      this.messagesService.enrichMessageWithFileMetadata(updatedMessage);

    // Emit WebSocket event to the channel room
    const roomId = originalMessage.directMessageGroupId
      ? RoomName.dmGroup(originalMessage.directMessageGroupId)
      : originalMessage.channelId;
    if (roomId) {
      this.websocketService.sendToRoom(roomId, ServerEvents.UPDATE_MESSAGE, {
        message: toWireMessage(enrichedMessage),
      });

      // Re-process link previews if spans changed. Enqueued with a
      // jobId distinct from the create-path job (`preview-${id}` in
      // MessageDispatchService) — using the SAME jobId here would let
      // BullMQ's dedupe silently swallow the edit's reprocessing if a
      // create job for this message were still queued/active. The random
      // suffix also lets rapid successive edits each get their own job
      // rather than deduping against each other. (`-` separators: BullMQ
      // rejects custom jobIds containing `:`.)
      if (updateMessageDto.spans) {
        try {
          await this.linkPreviewsQueue.add(
            'process',
            { messageId: id, room: roomId, event: ServerEvents.UPDATE_MESSAGE },
            { jobId: `preview-${id}-edit-${randomUUID()}` },
          );
        } catch (error) {
          this.logger.warn(
            'Failed to enqueue link preview processing on edit',
            error,
          );
        }
      }
    }

    return enrichedMessage;
  }

  @HttpCode(204)
  @Delete(':id')
  @UseGuards(JwtAuthGuard, MessageOwnershipGuard)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    // First get the message to know which channel to notify
    const messageToDelete = await this.messagesService.findOne(id);

    // Delete the message and mark attachments for cleanup
    await this.messagesService.remove(id);

    // Emit WebSocket event to the channel room
    const roomId = messageToDelete.directMessageGroupId
      ? RoomName.dmGroup(messageToDelete.directMessageGroupId)
      : messageToDelete.channelId;
    if (roomId) {
      this.websocketService.sendToRoom(roomId, ServerEvents.DELETE_MESSAGE, {
        messageId: id,
        channelId: messageToDelete.channelId,
        directMessageGroupId: messageToDelete.directMessageGroupId,
      });
    }
  }
}
