import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ChannelType } from '@prisma/client';
import { ServerEvents } from '@semaphore-chat/shared';
import { DatabaseService } from '@/database/database.service';
import { MessagesService } from '@/messages/messages.service';
import { MessageDispatchService } from '@/messages/message-dispatch.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import {
  CreateWebhookResponseDto,
  WebhookDto,
} from './dto/webhook-response.dto';

/** Raw tokens are 32 random bytes, hex-encoded (64 chars). */
const TOKEN_BYTES = 32;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly messagesService: MessagesService,
    private readonly messageDispatchService: MessageDispatchService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new incoming webhook for a TEXT channel. The raw token is
   * returned exactly once, embedded in the execution URL — only its SHA-256
   * hash is persisted.
   */
  async create(
    channelId: string,
    dto: CreateWebhookDto,
    createdBy?: string,
    /** The absolute origin the request came in on, for the fallback URL. */
    requestOrigin?: string,
  ): Promise<CreateWebhookResponseDto> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.type !== ChannelType.TEXT) {
      throw new BadRequestException(
        'Webhooks can only be created for text channels',
      );
    }

    const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const webhook = await this.databaseService.webhook.create({
      data: {
        channelId,
        name: dto.name,
        avatarUrl: dto.avatarUrl ?? null,
        tokenHash,
        createdBy: createdBy ?? null,
      },
    });

    return {
      id: webhook.id,
      name: webhook.name,
      avatarUrl: webhook.avatarUrl,
      channelId: webhook.channelId,
      createdAt: webhook.createdAt,
      url: this.buildExecutionUrl(webhook.id, rawToken, requestOrigin),
    };
  }

  /** List webhooks for a channel — never includes tokens or creator info. */
  async listForChannel(channelId: string): Promise<WebhookDto[]> {
    const webhooks = await this.databaseService.webhook.findMany({
      where: { channelId },
      orderBy: { createdAt: 'asc' },
      // Per-channel webhook counts are small in practice; cap defensively.
      take: 100,
    });

    return webhooks.map((webhook) => ({
      id: webhook.id,
      name: webhook.name,
      avatarUrl: webhook.avatarUrl,
      channelId: webhook.channelId,
      createdAt: webhook.createdAt,
    }));
  }

  /** Delete a webhook, verifying it belongs to the given channel first. */
  async remove(channelId: string, webhookId: string): Promise<void> {
    const webhook = await this.databaseService.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook || webhook.channelId !== channelId) {
      throw new NotFoundException('Webhook not found');
    }

    await this.databaseService.webhook.delete({ where: { id: webhookId } });
  }

  /**
   * Post a plain-text message on behalf of a webhook. Uses the shared
   * MessageDispatchService post-create pipeline (enrich -> broadcast ->
   * link previews), minus the user-specific steps (slowmode, read
   * receipts, notifications) which don't apply to the webhook path.
   *
   * Returns 404 for both an unknown webhook id and a bad token — the two
   * cases must be indistinguishable to the caller.
   */
  async execute(id: string, token: string, content: string) {
    const webhook = await this.databaseService.webhook.findUnique({
      where: { id },
    });

    if (!webhook || !this.verifyToken(token, webhook.tokenHash)) {
      throw new NotFoundException('Webhook not found');
    }

    const messagePayload = this.messagesService.buildWebhookMessageInput(
      webhook,
      content,
    );

    const message = await this.messagesService.create(messagePayload);

    await this.messageDispatchService.dispatch(message, {
      room: webhook.channelId,
      event: ServerEvents.NEW_MESSAGE,
      notifications: false,
      linkPreviews: true,
    });

    return { id: message.id };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Timing-safe comparison of the presented token's hash against the stored hash. */
  private verifyToken(token: string, storedHash: string): boolean {
    const presentedHash = this.hashToken(token);
    const presentedBuffer = Buffer.from(presentedHash, 'hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');

    if (presentedBuffer.length !== storedBuffer.length) {
      return false;
    }

    return timingSafeEqual(presentedBuffer, storedBuffer);
  }

  /**
   * Builds the execution URL returned once at creation time. Prefers
   * PUBLIC_APP_URL, then the origin the request came in on, so the caller
   * gets an absolute URL that works from an external service. Only a call
   * with neither (no request context) falls back to the relative path.
   */
  private buildExecutionUrl(
    id: string,
    rawToken: string,
    requestOrigin?: string,
  ): string {
    const path = `/api/webhooks/${id}/${rawToken}`;
    const baseUrl =
      this.configService.get<string>('PUBLIC_APP_URL') || requestOrigin;
    if (!baseUrl) {
      return path;
    }
    return `${baseUrl.replace(/\/+$/, '')}${path}`;
  }
}
