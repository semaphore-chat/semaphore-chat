import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  HttpCode,
  Req,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { ThreadsService } from './threads.service';
import { RemovedMessageVisibilityInterceptor } from '@/roles/removed-message-visibility.interceptor';
import {
  CreateThreadReplyBodyDto,
  CreateThreadReplyDto,
} from './dto/create-thread-reply.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';

import { AuthenticatedRequest } from '@/types';
import {
  ThreadRepliesResponseDto,
  ThreadMetadataDto,
} from './dto/thread-response.dto';
import { MessageDto } from '@/messages/dto/message-response.dto';

/**
 * Controller for thread operations.
 * Thread permissions are inherited from the parent message's context.
 */
@Controller('threads')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(RemovedMessageVisibilityInterceptor)
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  /**
   * Create a reply in a thread.
   * Permission check: Uses message resource type to verify access to parent message context.
   */
  @Post(':parentMessageId/replies')
  @HttpCode(201)
  @RequiredActions(RbacActions.CREATE_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'parentMessageId',
    source: ResourceIdSource.PARAM,
  })
  @ApiCreatedResponse({ type: MessageDto })
  async createReply(
    @Param('parentMessageId', ParseUUIDPipe) parentMessageId: string,
    @Body() body: CreateThreadReplyBodyDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MessageDto> {
    const dto: CreateThreadReplyDto = {
      ...body,
      parentMessageId,
    };
    const { reply } = await this.threadsService.sendThreadReply(
      dto,
      req.user.id,
    );
    return reply;
  }

  /**
   * Get paginated replies for a thread.
   */
  @Get(':parentMessageId/replies')
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'parentMessageId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ThreadRepliesResponseDto })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  async getReplies(
    @Param('parentMessageId', ParseUUIDPipe) parentMessageId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Req() req: AuthenticatedRequest,
    @Query('continuationToken') continuationToken?: string,
  ): Promise<ThreadRepliesResponseDto> {
    limit = Math.min(limit, 100);
    return this.threadsService.getThreadRepliesWithMetadata(
      parentMessageId,
      limit,
      continuationToken,
      req.user.id,
    );
  }

  /**
   * Get thread metadata (reply count, subscription status).
   */
  @Get(':parentMessageId/metadata')
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'parentMessageId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ThreadMetadataDto })
  async getMetadata(
    @Param('parentMessageId', ParseUUIDPipe) parentMessageId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ThreadMetadataDto> {
    return this.threadsService.getThreadMetadata(parentMessageId, req.user.id);
  }

  /**
   * Subscribe to a thread.
   */
  @Post(':parentMessageId/subscribe')
  @HttpCode(204)
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'parentMessageId',
    source: ResourceIdSource.PARAM,
  })
  async subscribe(
    @Param('parentMessageId', ParseUUIDPipe) parentMessageId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.threadsService.subscribeToThread(parentMessageId, req.user.id);
  }

  /**
   * Unsubscribe from a thread.
   */
  @Delete(':parentMessageId/subscribe')
  @HttpCode(204)
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'parentMessageId',
    source: ResourceIdSource.PARAM,
  })
  async unsubscribe(
    @Param('parentMessageId', ParseUUIDPipe) parentMessageId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.threadsService.unsubscribeFromThread(
      parentMessageId,
      req.user.id,
    );
  }
}
