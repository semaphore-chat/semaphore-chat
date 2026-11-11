import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
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
import { MessageSendService } from './message-send.service';
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
  CommunitySearchResultDto,
  MessageDto,
  MessageReactionsDto,
  PaginatedMessagesResponseDto,
} from './dto/message-response.dto';
import { groupReactions } from '@/common/utils/reactions.utils';
import { RemovedMessageVisibilityInterceptor } from '@/roles/removed-message-visibility.interceptor';
import { RoomName } from '@/common/utils/room-name.util';
import { toWireMessage } from '@/common/utils/message-wire.utils';
import { toMessageReactionsDto } from './message.mapper';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { LINK_PREVIEWS_QUEUE } from '@/jobs/jobs.constants';
import { LinkPreviewJobData } from '@/jobs/jobs.types';

@Controller('messages')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(RemovedMessageVisibilityInterceptor)
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly messageSendService: MessageSendService,
    private readonly reactionsService: ReactionsService,
    private readonly websocketService: WebsocketService,
    private readonly permissionsService: PermissionsService,
    @InjectQueue(LINK_PREVIEWS_QUEUE)
    private readonly linkPreviewsQueue: Queue<LinkPreviewJobData>,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ type: MessageDto })
  @RequiredActions(RbacActions.CREATE_MESSAGE)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.BODY,
  })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() createMessageDto: CreateMessageDto,
  ): Promise<MessageDto> {
    return this.messageSendService.sendToChannel(req.user.id, createMessageDto);
  }

  @Post('dm')
  @HttpCode(201)
  @ApiCreatedResponse({ type: MessageDto })
  @RequiredActions(RbacActions.CREATE_MESSAGE)
  @RbacResource({
    type: RbacResourceType.DM_GROUP,
    idKey: 'directMessageGroupId',
    source: ResourceIdSource.BODY,
  })
  createDirectMessage(
    @Req() req: AuthenticatedRequest,
    @Body() createMessageDto: CreateMessageDto,
  ): Promise<MessageDto> {
    return this.messageSendService.sendToDirectMessageGroup(
      req.user.id,
      createMessageDto,
    );
  }

  @Get('/group/:groupId')
  @ApiOkResponse({ type: PaginatedMessagesResponseDto })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.DM_GROUP,
    idKey: 'groupId',
    source: ResourceIdSource.PARAM,
  })
  @ApiQuery({
    name: 'direction',
    required: false,
    enum: ['older', 'newer'],
    enumName: 'MessagePageDirection',
  })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
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
  @ApiQuery({
    name: 'direction',
    required: false,
    enum: ['older', 'newer'],
    enumName: 'MessagePageDirection',
  })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
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
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
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
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
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
  @ApiOkResponse({ type: [MessageDto] })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
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
  ): Promise<MessageDto[]> {
    limit = Math.min(limit, 100);
    return this.messagesService.searchChannelMessages(channelId, query, limit);
  }

  @Get('search/group/:groupId')
  @ApiOkResponse({ type: [MessageDto] })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
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
  ): Promise<MessageDto[]> {
    limit = Math.min(limit, 100);
    return this.messagesService.searchDirectMessages(groupId, query, limit);
  }

  @Get('search/community/:communityId')
  @ApiOkResponse({ type: [CommunitySearchResultDto] })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
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
  ): Promise<CommunitySearchResultDto[]> {
    limit = Math.min(limit, 100);
    return this.messagesService.searchCommunityMessages(
      communityId,
      req.user.id,
      query,
      limit,
    );
  }

  @Post('reactions')
  @ApiCreatedResponse({ type: MessageReactionsDto })
  @RequiredActions(RbacActions.CREATE_REACTION)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.BODY,
  })
  async addReaction(
    @Body() addReactionDto: AddReactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MessageReactionsDto> {
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

    return toMessageReactionsDto(result);
  }

  @Delete('reactions')
  @ApiOkResponse({ type: MessageReactionsDto })
  @RequiredActions(RbacActions.DELETE_REACTION)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.BODY,
  })
  async removeReaction(
    @Body() removeReactionDto: RemoveReactionDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MessageReactionsDto> {
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

    return toMessageReactionsDto(result);
  }

  @Post(':id/attachments')
  @ApiCreatedResponse({ type: MessageDto })
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

    if (addAttachmentDto.fileId) {
      await this.messagesService.assertFilesAttachable(req.user.id, [
        addAttachmentDto.fileId,
      ]);
    }

    // Add the attachment and decrement pendingAttachments
    // If fileId is omitted (upload failed), just decrements counter
    const updatedMessage = await this.messagesService.addAttachment(
      id,
      addAttachmentDto.fileId,
    );

    // Emit WebSocket event to the room
    const roomId = originalMessage.directMessageGroupId
      ? RoomName.dmGroup(originalMessage.directMessageGroupId)
      : originalMessage.channelId;
    if (roomId) {
      this.websocketService.sendToRoom(roomId, ServerEvents.UPDATE_MESSAGE, {
        message: toWireMessage(updatedMessage),
      });
    }

    return updatedMessage;
  }

  @Get(':id')
  @ApiOkResponse({ type: MessageDto })
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<MessageDto> {
    return this.messagesService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: MessageDto })
  @UseGuards(JwtAuthGuard, MessageOwnershipGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateMessageDto: UpdateMessageDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MessageDto> {
    // First get the original message to know which channel to notify
    const originalMessage = await this.messagesService.findOne(id);

    // Update the message, passing original attachment file IDs for cleanup
    const originalFileIds = originalMessage.attachments.map(
      (a: { id: string }) => a.id,
    );

    // Adding files in an edit needs ATTACH_FILES like sending them
    const newFileIds = (updateMessageDto.attachments ?? []).filter(
      (fileId) => !originalFileIds.includes(fileId),
    );
    await this.messagesService.assertFilesAttachable(req.user.id, newFileIds);
    if (newFileIds.length > 0 && originalMessage.channelId) {
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

    // Emit WebSocket event to the channel room
    const roomId = originalMessage.directMessageGroupId
      ? RoomName.dmGroup(originalMessage.directMessageGroupId)
      : originalMessage.channelId;
    if (roomId) {
      this.websocketService.sendToRoom(roomId, ServerEvents.UPDATE_MESSAGE, {
        message: toWireMessage(updatedMessage),
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

    return updatedMessage;
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

      if (messageToDelete.parentMessageId) {
        const counts = await this.messagesService.findThreadCounts(
          messageToDelete.parentMessageId,
        );
        if (counts) {
          this.websocketService.sendToRoom(
            roomId,
            ServerEvents.THREAD_REPLY_COUNT_UPDATED,
            {
              parentMessageId: messageToDelete.parentMessageId,
              replyCount: counts.replyCount,
              lastReplyAt: counts.lastReplyAt?.toISOString() ?? null,
              channelId: counts.channelId,
              directMessageGroupId: counts.directMessageGroupId,
            },
          );
        }
      }
    }
  }
}
