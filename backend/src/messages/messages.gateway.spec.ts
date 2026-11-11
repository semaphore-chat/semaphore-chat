import { TestBed } from '@suites/unit';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';
import { ReactionsService } from './reactions.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { MessageSendService } from './message-send.service';
import type { Mocked } from '@suites/doubles.jest';

describe('MessagesGateway', () => {
  let gateway: MessagesGateway;
  let messagesService: Mocked<MessagesService>;
  let reactionsService: Mocked<ReactionsService>;
  let websocketService: Mocked<WebsocketService>;
  let messageSendService: Mocked<MessageSendService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(MessagesGateway).compile();

    gateway = unit;
    messagesService = unitRef.get(MessagesService);
    reactionsService = unitRef.get(ReactionsService);
    websocketService = unitRef.get(WebsocketService);
    messageSendService = unitRef.get(MessageSendService);

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
    expect(messageSendService).toBeDefined();
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

  describe.each([
    ['handleMessage', 'sendToChannel'],
    ['handleDirectMessageWithRBAC', 'sendToDirectMessageGroup'],
  ] as const)('%s', (handler, sendMethod) => {
    const payload = { spans: [] } as any;
    const client = { handshake: { user: { id: 'user-123' } } } as any;

    it('sends as the socket user and acks the message id', async () => {
      messageSendService[sendMethod].mockResolvedValue({
        id: 'msg-123',
      } as any);

      await expect(gateway[handler](payload, client)).resolves.toBe('msg-123');
      expect(messageSendService[sendMethod]).toHaveBeenCalledWith(
        'user-123',
        payload,
      );
    });

    it('lets a failed send reach the exception filter', async () => {
      const error = new Error('database down');
      messageSendService[sendMethod].mockRejectedValue(error);

      await expect(gateway[handler](payload, client)).rejects.toBe(error);
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
