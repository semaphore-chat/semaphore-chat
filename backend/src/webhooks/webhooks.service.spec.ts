import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { WebhooksService } from './webhooks.service';
import { DatabaseService } from '@/database/database.service';
import { MessagesService } from '@/messages/messages.service';
import { MessageDispatchService } from '@/messages/message-dispatch.service';
import { ConfigService } from '@nestjs/config';
import { ChannelFactory } from '@/test-utils';
import { ServerEvents } from '@semaphore-chat/shared';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let messagesService: Mocked<MessagesService>;
  let messageDispatchService: Mocked<MessageDispatchService>;
  let configService: Mocked<ConfigService>;

  const mockDatabaseService = {
    channel: {
      findUnique: jest.fn(),
    },
    webhook: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(WebhooksService)
      .mock(DatabaseService)
      .final(mockDatabaseService)
      .compile();

    service = unit;
    messagesService = unitRef.get(MessagesService);
    messageDispatchService = unitRef.get(MessageDispatchService);
    configService = unitRef.get(ConfigService);

    jest.clearAllMocks();
    configService.get.mockReturnValue(undefined);
    messageDispatchService.dispatch.mockResolvedValue(undefined);
  });

  const channelId = 'channel-1';
  const webhookId = 'webhook-1';

  describe('create', () => {
    it('stores only the SHA-256 hash of the token, never the raw token', async () => {
      mockDatabaseService.channel.findUnique.mockResolvedValue(
        ChannelFactory.buildText({ id: channelId }),
      );
      mockDatabaseService.webhook.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: webhookId,
            channelId,
            name: data.name,
            avatarUrl: data.avatarUrl,
            tokenHash: data.tokenHash,
            createdBy: data.createdBy,
            createdAt: new Date(),
          }),
      );

      const result = await service.create(channelId, { name: 'CI Bot' });

      expect(mockDatabaseService.webhook.create).toHaveBeenCalledTimes(1);
      const createCall = mockDatabaseService.webhook.create.mock.calls[0][0];
      const storedHash = createCall.data.tokenHash as string;

      // The stored hash must be a 64-char hex SHA-256 digest, and the raw
      // token must never appear anywhere in the create() call args.
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(createCall)).not.toContain(
        result.url.split('/').pop(),
      );

      // The raw token appears ONLY inside the returned URL.
      expect(result.url).toMatch(
        new RegExp(`/api/webhooks/${webhookId}/[0-9a-f]{64}$`),
      );
      const rawToken = result.url.split('/').pop()!;
      expect(createHash('sha256').update(rawToken).digest('hex')).toBe(
        storedHash,
      );
    });

    it('rejects creation for a non-TEXT channel', async () => {
      mockDatabaseService.channel.findUnique.mockResolvedValue(
        ChannelFactory.buildVoice({ id: channelId }),
      );

      await expect(
        service.create(channelId, { name: 'CI Bot' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDatabaseService.webhook.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the channel does not exist', async () => {
      mockDatabaseService.channel.findUnique.mockResolvedValue(null);

      await expect(
        service.create(channelId, { name: 'CI Bot' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('builds an absolute URL when PUBLIC_APP_URL is configured', async () => {
      configService.get.mockReturnValue('https://chat.example.com/');
      mockDatabaseService.channel.findUnique.mockResolvedValue(
        ChannelFactory.buildText({ id: channelId }),
      );
      mockDatabaseService.webhook.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: webhookId,
            channelId,
            name: data.name,
            avatarUrl: data.avatarUrl,
            tokenHash: data.tokenHash,
            createdBy: data.createdBy,
            createdAt: new Date(),
          }),
      );

      const result = await service.create(channelId, { name: 'CI Bot' });

      expect(result.url).toMatch(
        new RegExp(
          `^https://chat\\.example\\.com/api/webhooks/${webhookId}/[0-9a-f]{64}$`,
        ),
      );
    });
  });

  describe('listForChannel', () => {
    it('never returns tokenHash or creator fields', async () => {
      mockDatabaseService.webhook.findMany.mockResolvedValue([
        {
          id: webhookId,
          channelId,
          name: 'CI Bot',
          avatarUrl: null,
          tokenHash: 'should-not-leak',
          createdBy: 'user-1',
          createdAt: new Date(),
        },
      ]);

      const result = await service.listForChannel(channelId);

      expect(result).toEqual([
        {
          id: webhookId,
          channelId,
          name: 'CI Bot',
          avatarUrl: null,
          createdAt: expect.any(Date),
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('should-not-leak');
      expect(JSON.stringify(result)).not.toContain('createdBy');
    });

    it('caps the query at 100 webhooks', async () => {
      mockDatabaseService.webhook.findMany.mockResolvedValue([]);

      await service.listForChannel(channelId);

      expect(mockDatabaseService.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  describe('remove', () => {
    it('deletes the webhook when it belongs to the given channel', async () => {
      mockDatabaseService.webhook.findUnique.mockResolvedValue({
        id: webhookId,
        channelId,
      });

      await service.remove(channelId, webhookId);

      expect(mockDatabaseService.webhook.delete).toHaveBeenCalledWith({
        where: { id: webhookId },
      });
    });

    it('throws NotFoundException when the webhook belongs to a different channel', async () => {
      mockDatabaseService.webhook.findUnique.mockResolvedValue({
        id: webhookId,
        channelId: 'some-other-channel',
      });

      await expect(service.remove(channelId, webhookId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDatabaseService.webhook.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the webhook does not exist', async () => {
      mockDatabaseService.webhook.findUnique.mockResolvedValue(null);

      await expect(service.remove(channelId, webhookId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('execute', () => {
    const rawToken = 'a'.repeat(64);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const storedWebhook = {
      id: webhookId,
      channelId,
      name: 'CI Bot',
      avatarUrl: null,
      tokenHash,
      createdBy: null,
      createdAt: new Date(),
    };

    it('creates a message with webhookId set and authorId null on a valid token', async () => {
      mockDatabaseService.webhook.findUnique.mockResolvedValue(storedWebhook);
      const builtInput = {
        id: '',
        channelId,
        directMessageGroupId: null,
        authorId: null,
        webhookId,
        spans: [{ type: 'PLAINTEXT', text: 'hello from CI' }],
      };
      const createdMessage = {
        id: 'message-1',
        channelId,
        authorId: null,
        webhookId,
        spans: [{ type: 'PLAINTEXT', text: 'hello from CI' }],
        attachments: [],
      };
      messagesService.buildWebhookMessageInput.mockReturnValue(
        builtInput as never,
      );
      messagesService.create.mockResolvedValue(createdMessage as never);

      const result = await service.execute(
        webhookId,
        rawToken,
        'hello from CI',
      );

      expect(result).toEqual({ id: 'message-1' });
      expect(messagesService.buildWebhookMessageInput).toHaveBeenCalledWith(
        storedWebhook,
        'hello from CI',
      );
      expect(messagesService.create).toHaveBeenCalledWith(builtInput);
      expect(messageDispatchService.dispatch).toHaveBeenCalledWith(
        createdMessage,
        {
          room: channelId,
          event: ServerEvents.NEW_MESSAGE,
          notifications: false,
          linkPreviews: true,
        },
      );
    });

    it('returns 404 for an unknown webhook id', async () => {
      mockDatabaseService.webhook.findUnique.mockResolvedValue(null);

      await expect(
        service.execute('unknown-id', rawToken, 'hi'),
      ).rejects.toThrow(NotFoundException);
      expect(messagesService.create).not.toHaveBeenCalled();
    });

    it('returns 404 for a bad token on a known webhook id (indistinguishable from unknown id)', async () => {
      mockDatabaseService.webhook.findUnique.mockResolvedValue(storedWebhook);

      await expect(
        service.execute(webhookId, 'b'.repeat(64), 'hi'),
      ).rejects.toThrow(NotFoundException);
      expect(messagesService.create).not.toHaveBeenCalled();
    });

    it('rejects a token that differs only in trailing characters (timing-safe compare, not just prefix)', async () => {
      mockDatabaseService.webhook.findUnique.mockResolvedValue(storedWebhook);
      const almostRightToken = rawToken.slice(0, -1) + 'b';

      await expect(
        service.execute(webhookId, almostRightToken, 'hi'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
