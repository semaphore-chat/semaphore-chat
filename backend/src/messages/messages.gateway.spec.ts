import { TestBed } from '@suites/unit';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';
import { ReactionsService } from './reactions.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { MessageDispatchService } from './message-dispatch.service';
import { ModerationService } from '@/moderation/moderation.service';
import { ReadReceiptsService } from '@/read-receipts/read-receipts.service';
import type { Mocked } from '@suites/doubles.jest';

describe('MessagesGateway', () => {
  let gateway: MessagesGateway;
  let messagesService: Mocked<MessagesService>;
  let reactionsService: Mocked<ReactionsService>;
  let websocketService: Mocked<WebsocketService>;
  let messageDispatchService: Mocked<MessageDispatchService>;
  let moderationService: Mocked<ModerationService>;
  let readReceiptsService: Mocked<ReadReceiptsService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(MessagesGateway).compile();

    gateway = unit;
    messagesService = unitRef.get(MessagesService);
    reactionsService = unitRef.get(ReactionsService);
    websocketService = unitRef.get(WebsocketService);
    messageDispatchService = unitRef.get(MessageDispatchService);
    moderationService = unitRef.get(ModerationService);
    readReceiptsService = unitRef.get(ReadReceiptsService);

    // Set up default return values that tests rely on
    messagesService.checkSlowmode.mockResolvedValue(undefined);
    moderationService.getCommunityIdFromChannel.mockResolvedValue(
      'community-123',
    );
    moderationService.isUserTimedOut.mockResolvedValue({
      isTimedOut: false,
    });
    messageDispatchService.dispatch.mockResolvedValue(undefined);
    readReceiptsService.markAsRead.mockResolvedValue({
      channelId: null,
      directMessageGroupId: null,
      lastReadMessageId: 'msg-123',
      lastReadAt: new Date(),
    } as any);

    // Set up mock server for READ_RECEIPT_UPDATED emission
    const mockEmit = jest.fn();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: mockEmit }),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('should have services', () => {
    expect(messagesService).toBeDefined();
    expect(reactionsService).toBeDefined();
    expect(websocketService).toBeDefined();
    expect(messageDispatchService).toBeDefined();
  });

  describe('afterInit', () => {
    it('should log initialization', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'log');
      const mockServer = {} as any;

      gateway.afterInit(mockServer);

      expect(loggerSpy).toHaveBeenCalledWith('MessagesGateway initialized');
    });
  });

  describe('handleConnection', () => {
    it('should log client connection', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'debug');
      const mockClient = { id: 'test-socket-id' } as any;

      gateway.handleConnection(mockClient);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Client connected to MessagesGateway: test-socket-id',
      );
    });
  });

  describe('handleDisconnect', () => {
    it('should log client disconnection', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'debug');
      const mockClient = { id: 'disconnect-socket-id' } as any;

      gateway.handleDisconnect(mockClient);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Client disconnected from MessagesGateway: disconnect-socket-id',
      );
    });
  });

  describe('handleMessage (SEND_MESSAGE)', () => {
    it('should create message and broadcast to channel', async () => {
      const payload = {
        channelId: 'channel-123',
        content: 'Test message',
      };
      const mockClient = {
        handshake: { user: { id: 'user-123' } },
      } as any;

      const createdMessage = {
        id: 'msg-123',
        ...payload,
        authorId: 'user-123',
      };

      messagesService.create.mockResolvedValue(createdMessage as any);

      const result = await gateway.handleMessage(payload as any, mockClient);

      expect(result).toBe('msg-123');
      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-123',
          content: 'Test message',
          authorId: 'user-123',
        }),
      );
      expect(messageDispatchService.dispatch).toHaveBeenCalledWith(
        createdMessage,
        {
          room: 'channel-123',
          event: ServerEvents.NEW_MESSAGE,
          notifications: true,
          linkPreviews: true,
        },
      );
    });

    it('should auto-mark the sent message as read', async () => {
      const payload = {
        channelId: 'channel-123',
        content: 'Test message',
      };
      const mockClient = {
        handshake: { user: { id: 'user-123' } },
      } as any;

      const createdMessage = {
        id: 'msg-123',
        ...payload,
        authorId: 'user-123',
      };

      messagesService.create.mockResolvedValue(createdMessage as any);

      await gateway.handleMessage(payload as any, mockClient);

      expect(readReceiptsService.markAsRead).toHaveBeenCalledWith('user-123', {
        lastReadMessageId: 'msg-123',
        channelId: 'channel-123',
      });
    });

    it('should throw error when channelId is missing', async () => {
      const payload = {
        content: 'Test message',
      };
      const mockClient = {
        handshake: { user: { id: 'user-123' } },
      } as any;

      await expect(
        gateway.handleMessage(payload as any, mockClient),
      ).rejects.toThrow('channelId is required for channel messages');
    });
  });

  describe('handleDirectMessageWithRBAC (SEND_DM)', () => {
    it('should create DM and broadcast to DM group', async () => {
      const payload = {
        directMessageGroupId: 'dm-group-456',
        content: 'DM test message',
      };
      const mockClient = {
        handshake: { user: { id: 'user-456' } },
      } as any;

      const createdMessage = {
        id: 'msg-456',
        ...payload,
        authorId: 'user-456',
      };

      messagesService.create.mockResolvedValue(createdMessage as any);

      const result = await gateway.handleDirectMessageWithRBAC(
        payload as any,
        mockClient,
      );

      expect(result).toBe('msg-456');
      expect(messagesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          directMessageGroupId: 'dm-group-456',
          content: 'DM test message',
          authorId: 'user-456',
        }),
      );
      expect(messageDispatchService.dispatch).toHaveBeenCalledWith(
        createdMessage,
        {
          room: 'dm:dm-group-456',
          event: ServerEvents.NEW_DM,
          notifications: true,
          linkPreviews: true,
        },
      );
    });

    it('should auto-mark the sent DM as read', async () => {
      const payload = {
        directMessageGroupId: 'dm-group-456',
        content: 'DM test message',
      };
      const mockClient = {
        handshake: { user: { id: 'user-456' } },
      } as any;

      const createdMessage = {
        id: 'msg-456',
        ...payload,
        authorId: 'user-456',
      };

      messagesService.create.mockResolvedValue(createdMessage as any);

      await gateway.handleDirectMessageWithRBAC(payload as any, mockClient);

      expect(readReceiptsService.markAsRead).toHaveBeenCalledWith('user-456', {
        lastReadMessageId: 'msg-456',
        directMessageGroupId: 'dm-group-456',
      });
    });

    it('should throw error when directMessageGroupId is missing', async () => {
      const payload = {
        content: 'DM test message',
      };
      const mockClient = {
        handshake: { user: { id: 'user-456' } },
      } as any;

      await expect(
        gateway.handleDirectMessageWithRBAC(payload as any, mockClient),
      ).rejects.toThrow('directMessageGroupId is required for direct messages');
    });
  });

  describe('handleAddReaction (ADD_REACTION)', () => {
    it('should add reaction and broadcast to channel', async () => {
      const payload = {
        messageId: 'msg-789',
        emoji: '👍',
      };
      const mockClient = {
        handshake: { user: { id: 'user-789' } },
      } as any;

      const updatedMessage = {
        id: 'msg-789',
        channelId: 'channel-789',
        reactions: [{ emoji: '👍', userId: 'user-789' }],
      };

      reactionsService.addReaction.mockResolvedValue(updatedMessage as any);

      await gateway.handleAddReaction(payload, mockClient);

      expect(reactionsService.addReaction).toHaveBeenCalledWith(
        'msg-789',
        '👍',
        'user-789',
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-789',
        ServerEvents.REACTION_ADDED,
        {
          messageId: 'msg-789',
          reaction: { emoji: '👍', userIds: ['user-789'] },
          channelId: 'channel-789',
          directMessageGroupId: null,
          parentMessageId: null,
        },
      );
    });

    it('should add reaction and broadcast to DM group', async () => {
      const payload = {
        messageId: 'msg-dm-999',
        emoji: '❤️',
      };
      const mockClient = {
        handshake: { user: { id: 'user-999' } },
      } as any;

      const updatedMessage = {
        id: 'msg-dm-999',
        directMessageGroupId: 'dm-group-999',
        reactions: [{ emoji: '❤️', userId: 'user-999' }],
      };

      reactionsService.addReaction.mockResolvedValue(updatedMessage as any);

      await gateway.handleAddReaction(payload, mockClient);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-group-999',
        ServerEvents.REACTION_ADDED,
        expect.objectContaining({
          messageId: 'msg-dm-999',
        }),
      );
    });

    it('should handle reaction when no roomId', async () => {
      const payload = {
        messageId: 'msg-111',
        emoji: '👍',
      };
      const mockClient = {
        handshake: { user: { id: 'user-111' } },
      } as any;

      const updatedMessage = {
        id: 'msg-111',
        reactions: [{ emoji: '👍', userId: 'user-111' }],
      };

      reactionsService.addReaction.mockResolvedValue(updatedMessage as any);

      await gateway.handleAddReaction(payload, mockClient);

      expect(reactionsService.addReaction).toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });

  describe('handleRemoveReaction (REMOVE_REACTION)', () => {
    it('should remove reaction and broadcast to channel', async () => {
      const payload = {
        messageId: 'msg-222',
        emoji: '👍',
      };
      const mockClient = {
        handshake: { user: { id: 'user-222' } },
      } as any;

      const updatedMessage = {
        id: 'msg-222',
        channelId: 'channel-222',
        reactions: [],
      };

      reactionsService.removeReaction.mockResolvedValue(updatedMessage as any);

      await gateway.handleRemoveReaction(payload, mockClient);

      expect(reactionsService.removeReaction).toHaveBeenCalledWith(
        'msg-222',
        '👍',
        'user-222',
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'channel-222',
        ServerEvents.REACTION_REMOVED,
        {
          messageId: 'msg-222',
          emoji: '👍',
          reactions: [],
          channelId: 'channel-222',
          directMessageGroupId: null,
          parentMessageId: null,
        },
      );
    });

    it('should remove reaction and broadcast to DM group', async () => {
      const payload = {
        messageId: 'msg-dm-333',
        emoji: '❤️',
      };
      const mockClient = {
        handshake: { user: { id: 'user-333' } },
      } as any;

      const updatedMessage = {
        id: 'msg-dm-333',
        directMessageGroupId: 'dm-group-333',
        reactions: [],
      };

      reactionsService.removeReaction.mockResolvedValue(updatedMessage as any);

      await gateway.handleRemoveReaction(payload, mockClient);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'dm:dm-group-333',
        ServerEvents.REACTION_REMOVED,
        expect.objectContaining({
          messageId: 'msg-dm-333',
          emoji: '❤️',
        }),
      );
    });

    it('should handle remove reaction when no roomId', async () => {
      const payload = {
        messageId: 'msg-444',
        emoji: '👍',
      };
      const mockClient = {
        handshake: { user: { id: 'user-444' } },
      } as any;

      const updatedMessage = {
        id: 'msg-444',
        reactions: [],
      };

      reactionsService.removeReaction.mockResolvedValue(updatedMessage as any);

      await gateway.handleRemoveReaction(payload, mockClient);

      expect(reactionsService.removeReaction).toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });

  describe('handleTypingStart wire normalization (#440)', () => {
    it('emits the typing payload in JSON wire form — undefined ids dropped, sender excluded', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockClient = {
        handshake: { user: { id: 'user-typing' } },
        rooms: new Set(['channel-typing']),
        to: mockTo,
      } as any;

      gateway.handleTypingStart({ channelId: 'channel-typing' }, mockClient);

      // client.to() (not sendToRoom) so the sender is excluded from the broadcast
      expect(mockTo).toHaveBeenCalledWith('channel-typing');
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();

      expect(mockEmit).toHaveBeenCalledTimes(1);
      const [event, payload] = mockEmit.mock.calls[0];
      expect(event).toBe(ServerEvents.USER_TYPING);
      // JSON wire form: the undefined directMessageGroupId is dropped, matching
      // what same-node clients receive from socket.io's own JSON encoder
      expect(payload).toEqual({
        userId: 'user-typing',
        channelId: 'channel-typing',
        isTyping: true,
      });
      expect('directMessageGroupId' in payload).toBe(false);
    });
  });
});
