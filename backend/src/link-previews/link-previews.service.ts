import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { flattenSpansToDisplayText } from '@/common/utils/text.utils';
import {
  extractUrls,
  fetchLinkMetadata,
  LinkPreviewData,
} from './link-preview.utils';
import { Prisma } from '@prisma/client';
import { ServerEvents } from '@semaphore-chat/shared';
import { toWireMessage } from '@/common/utils/message-wire.utils';
import {
  MESSAGE_INCLUDE_WITH_REPLY,
  toMessageDto,
} from '@/messages/message.mapper';

@Injectable()
export class LinkPreviewsService {
  private readonly logger = new Logger(LinkPreviewsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly websocketService: WebsocketService,
  ) {}

  /**
   * Extract URLs from message spans, fetch OG metadata, store in DB,
   * and emit an update event. Called fire-and-forget after message creation.
   */
  async processMessageLinkPreviews(
    messageId: string,
    spans: { text?: string | null }[],
    roomId: string,
    // Only ever UPDATE_MESSAGE (re-processed message always broadcasts as
    // an update) — see LinkPreviewJobData for the same narrowing.
    serverEvent: typeof ServerEvents.UPDATE_MESSAGE,
  ): Promise<void> {
    const text = flattenSpansToDisplayText(spans);
    if (!text) return;

    const urls = extractUrls(text);

    // No URLs → clear any stale previews from a previous edit
    if (urls.length === 0) {
      await this.clearAndBroadcast(messageId, roomId, serverEvent);
      return;
    }

    // Fetch all URLs in parallel
    const results = await Promise.allSettled(
      urls.map((url) => fetchLinkMetadata(url)),
    );

    const previews: LinkPreviewData[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        previews.push(result.value);
      } else if (result.status === 'rejected') {
        this.logger.warn('Failed to fetch link preview', result.reason);
      }
    }

    if (previews.length === 0) return;

    // Verify message still exists and hasn't been deleted
    const existing = await this.databaseService.message.findUnique({
      where: { id: messageId },
      select: { id: true, deletedAt: true },
    });

    if (!existing || existing.deletedAt) return;

    // Store previews and broadcast
    await this.databaseService.message.update({
      where: { id: messageId },
      data: { linkPreviews: previews as unknown as Prisma.InputJsonValue },
    });

    await this.broadcastMessage(messageId, roomId, serverEvent);
  }

  /**
   * Clear link previews for a message and broadcast the update.
   * Used when a message edit removes all URLs.
   */
  private async clearAndBroadcast(
    messageId: string,
    roomId: string,
    // Only ever UPDATE_MESSAGE (re-processed message always broadcasts as
    // an update) — see LinkPreviewJobData for the same narrowing.
    serverEvent: typeof ServerEvents.UPDATE_MESSAGE,
  ): Promise<void> {
    const existing = await this.databaseService.message.findUnique({
      where: { id: messageId },
      select: { linkPreviews: true, deletedAt: true },
    });

    // Only update + broadcast if there were previews to clear. A message
    // removed since the job was queued stays out of the room.
    if (!existing?.linkPreviews || existing.deletedAt) return;

    await this.databaseService.message.update({
      where: { id: messageId },
      data: { linkPreviews: Prisma.DbNull },
    });

    await this.broadcastMessage(messageId, roomId, serverEvent);
  }

  /**
   * Re-read a message with full includes and broadcast it.
   * Matches the same shape as MessagesService.formatMessageWithReply().
   */
  private async broadcastMessage(
    messageId: string,
    roomId: string,
    // Only ever UPDATE_MESSAGE (re-processed message always broadcasts as
    // an update) — see LinkPreviewJobData for the same narrowing.
    serverEvent: typeof ServerEvents.UPDATE_MESSAGE,
  ): Promise<void> {
    const msg = await this.databaseService.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    // Removed between the job's checks and this read: never broadcast its text
    if (!msg || msg.deletedAt) return;

    this.websocketService.sendToRoom(roomId, serverEvent, {
      message: toWireMessage(toMessageDto(msg)),
    });
  }
}
