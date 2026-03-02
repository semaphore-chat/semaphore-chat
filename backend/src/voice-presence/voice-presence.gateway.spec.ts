import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { VoicePresenceGateway } from './voice-presence.gateway';
import { VoicePresenceService } from './voice-presence.service';
import { UserFactory } from '@/test-utils';
import { Socket } from 'socket.io';

describe('VoicePresenceGateway', () => {
  let gateway: VoicePresenceGateway;
  let service: Mocked<VoicePresenceService>;

  const mockUser = UserFactory.build();

  const createMockSocket = (
    user = mockUser,
  ): Socket & { handshake: { user: typeof mockUser } } => {
    return {
      id: 'socket-123',
      handshake: {
        user,
      },
    } as Socket & { handshake: { user: typeof mockUser } };
  };

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(VoicePresenceGateway).compile();

    gateway = unit;
    service = unitRef.get(VoicePresenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleRefreshPresence', () => {
    it('should refresh presence successfully', async () => {
      const client = createMockSocket();
      const data = { channelId: 'channel-123' };

      service.refreshPresence.mockResolvedValue();

      const result = await gateway.handleRefreshPresence(client, data);

      expect(service.refreshPresence).toHaveBeenCalledWith(
        data.channelId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        channelId: 'channel-123',
      });
    });

    it('should use authenticated user ID from socket', async () => {
      const customUser = UserFactory.build({ id: 'refresh-user' });
      const client = createMockSocket(customUser);
      const data = { channelId: 'channel-refresh' };

      service.refreshPresence.mockResolvedValue();

      await gateway.handleRefreshPresence(client, data);

      expect(service.refreshPresence).toHaveBeenCalledWith(
        'channel-refresh',
        'refresh-user',
      );
    });

    it('should handle different channel IDs', async () => {
      const client = createMockSocket();
      const testChannels = ['channel-a', 'channel-b', 'channel-c'];

      service.refreshPresence.mockResolvedValue();

      for (const channelId of testChannels) {
        await gateway.handleRefreshPresence(client, { channelId });
      }

      expect(service.refreshPresence).toHaveBeenCalledTimes(3);
      expect(service.refreshPresence).toHaveBeenCalledWith(
        'channel-a',
        mockUser.id,
      );
      expect(service.refreshPresence).toHaveBeenCalledWith(
        'channel-b',
        mockUser.id,
      );
      expect(service.refreshPresence).toHaveBeenCalledWith(
        'channel-c',
        mockUser.id,
      );
    });

    it('should not throw error when service fails silently', async () => {
      const client = createMockSocket();
      const data = { channelId: 'channel-456' };

      // refreshPresence in the service doesn't throw, it logs errors
      service.refreshPresence.mockResolvedValue();

      const result = await gateway.handleRefreshPresence(client, data);

      expect(result).toEqual({
        success: true,
        channelId: 'channel-456',
      });
    });
  });
});
