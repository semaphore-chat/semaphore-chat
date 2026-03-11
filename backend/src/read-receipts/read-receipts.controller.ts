import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Query,
  HttpCode,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { ReadReceiptsService } from './read-receipts.service';
import { MarkAsReadDto } from './dto/mark-as-read.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { AuthenticatedRequest } from '@/types';

import { OptionalParseUUIDPipe } from '@/common/pipes/optional-parse-uuid.pipe';
import {
  ReadReceiptDto,
  UnreadCountDto,
  LastReadResponseDto,
  MessageReaderDto,
  DmPeerReadDto,
} from './dto/read-receipts-response.dto';

@Controller('read-receipts')
@UseGuards(JwtAuthGuard)
export class ReadReceiptsController {
  constructor(private readonly readReceiptsService: ReadReceiptsService) {}

  /**
   * Mark messages as read up to a specific message
   * POST /read-receipts/mark-read
   */
  @Post('mark-read')
  @HttpCode(200)
  @ApiOkResponse({ type: ReadReceiptDto })
  async markAsRead(
    @Req() req: AuthenticatedRequest,
    @Body() markAsReadDto: MarkAsReadDto,
  ): Promise<ReadReceiptDto> {
    return this.readReceiptsService.markAsRead(req.user.id, markAsReadDto);
  }

  /**
   * Get all unread counts for the current user
   * GET /read-receipts/unread-counts
   */
  @Get('unread-counts')
  @ApiOkResponse({ type: [UnreadCountDto] })
  async getUnreadCounts(
    @Req() req: AuthenticatedRequest,
  ): Promise<UnreadCountDto[]> {
    return this.readReceiptsService.getUnreadCounts(req.user.id);
  }

  /**
   * Get unread count for a specific channel or DM group
   * GET /read-receipts/unread-count?channelId=xxx or ?directMessageGroupId=xxx
   */
  @Get('unread-count')
  @ApiOkResponse({ type: UnreadCountDto })
  async getUnreadCount(
    @Req() req: AuthenticatedRequest,
    @Query('channelId', OptionalParseUUIDPipe) channelId?: string,
    @Query('directMessageGroupId', OptionalParseUUIDPipe)
    directMessageGroupId?: string,
  ): Promise<UnreadCountDto> {
    return this.readReceiptsService.getUnreadCount(
      req.user.id,
      channelId,
      directMessageGroupId,
    );
  }

  /**
   * Get the last read message ID for a specific channel or DM group
   * GET /read-receipts/last-read?channelId=xxx or ?directMessageGroupId=xxx
   */
  @Get('last-read')
  @ApiOkResponse({ type: LastReadResponseDto })
  async getLastReadMessageId(
    @Req() req: AuthenticatedRequest,
    @Query('channelId', OptionalParseUUIDPipe) channelId?: string,
    @Query('directMessageGroupId', OptionalParseUUIDPipe)
    directMessageGroupId?: string,
  ): Promise<LastReadResponseDto> {
    const lastReadMessageId =
      await this.readReceiptsService.getLastReadMessageId(
        req.user.id,
        channelId,
        directMessageGroupId,
      );

    return { lastReadMessageId };
  }

  /**
   * Get peer read watermarks for a DM group (excludes requesting user).
   * GET /read-receipts/dm-peer-reads/:directMessageGroupId
   */
  @Get('dm-peer-reads/:directMessageGroupId')
  @ApiOkResponse({ type: [DmPeerReadDto] })
  async getDmPeerReads(
    @Req() req: AuthenticatedRequest,
    @Param('directMessageGroupId', ParseUUIDPipe)
    directMessageGroupId: string,
  ): Promise<DmPeerReadDto[]> {
    return this.readReceiptsService.getDmPeerReads(
      req.user.id,
      directMessageGroupId,
    );
  }

  /**
   * Get all users who have read a specific message
   * GET /read-receipts/message/:messageId/readers?channelId=xxx or ?directMessageGroupId=xxx
   */
  @Get('message/:messageId/readers')
  @ApiOkResponse({ type: [MessageReaderDto] })
  async getMessageReaders(
    @Req() req: AuthenticatedRequest,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query('channelId', OptionalParseUUIDPipe) channelId?: string,
    @Query('directMessageGroupId', OptionalParseUUIDPipe)
    directMessageGroupId?: string,
  ): Promise<MessageReaderDto[]> {
    return this.readReceiptsService.getMessageReaders(
      messageId,
      channelId,
      directMessageGroupId,
      req.user.id,
    );
  }
}
