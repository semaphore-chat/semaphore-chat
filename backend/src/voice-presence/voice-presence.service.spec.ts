import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { VoicePresenceService } from './voice-presence.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { WebsocketService } from '@/websocket/websocket.service';
import { DatabaseService } from '@/database/database.service';

import { ServerEvents } from '@kraken/shared';

describe('VoicePresenceService', () => {
  let service: VoicePresenceService;
  let websocketService: Mocked<WebsocketService>;
  let mockDatabaseService: any;

  const mockPipeline = {
    set: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    expire: jest.fn(),
    smembers: jest.fn(),
    mget: jest.fn(),
    srem: jest.fn(),
    pipeline: jest.fn(() => mockPipeline),
  };

  beforeEach(async () => {
    mockDatabaseService = {
      directMessageGroup: {
        findFirst: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    const { unit, unitRef } = await TestBed.solitary(VoicePresenceService)
      .mock(REDIS_CLIENT)
      .final(mockRedis)
      .mock(DatabaseService)
      .final(mockDatabaseService)
      .compile();

    service = unit;
    websocketService = unitRef.get(WebsocketService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('joinVoiceChannelDirect', () => {
    it('should register new user presence in voice channel', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const mockUser = {
        id: userId,
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      };

      mockRedis.get.mockResolvedValue(null); // No existing presence
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);

      await service.joinVoiceChannelDirect(channelId, userId);

      expect(mockDatabaseService.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        expect.any(String),
        'EX',
        90,
      );
      expect(mockPipeline.sadd).toHaveBeenCalledTimes(2);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_JOINED,
        expect.objectContaining({
          channelId,
          user: expect.objectContaining({ id: userId, username: 'testuser' }),
        }),
      );
    });

    it('should refresh TTL if user is already in channel', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const existingData = JSON.stringify({
        id: userId,
        username: 'testuser',
        joinedAt: new Date(),
        isDeafened: false,
      });

      mockRedis.get.mockResolvedValue(existingData);

      await service.joinVoiceChannelDirect(channelId, userId);

      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        90,
      );
      // Should not create new entry or emit join event
      expect(mockDatabaseService.user.findUnique).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should not register presence if user is not found in database', async () => {
      const channelId = 'channel-123';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(null);

      await service.joinVoiceChannelDirect(channelId, userId);

      expect(mockRedis.pipeline).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });

  describe('leaveVoiceChannel', () => {
    it('should leave voice channel successfully', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const userData = {
        id: userId,
        username: 'testuser',
        joinedAt: new Date().toISOString(),
        isDeafened: false,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(userData));

      await service.leaveVoiceChannel(channelId, userId);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_LEFT,
        {
          channelId,
          userId,
          user: userData,
        },
      );
    });

    it('should handle user not found gracefully', async () => {
      const channelId = 'channel-123';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);

      await service.leaveVoiceChannel(channelId, userId);

      expect(mockRedis.pipeline).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should clean up Redis data correctly', async () => {
      const channelId = 'channel-789';
      const userId = 'user-789';
      const userData = {
        id: userId,
        username: 'testuser',
        joinedAt: new Date(),
        isDeafened: false,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(userData));

      await service.leaveVoiceChannel(channelId, userId);

      expect(mockPipeline.del).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
      );
      expect(mockPipeline.srem).toHaveBeenCalledTimes(2);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('getChannelPresence', () => {
    it('should return all users in voice channel', async () => {
      const channelId = 'channel-123';
      const userIds = ['user-1', 'user-2'];
      const user1Data = {
        id: 'user-1',
        username: 'user1',
        joinedAt: new Date('2024-01-01T10:00:00Z'),
        isDeafened: false,
      };
      const user2Data = {
        id: 'user-2',
        username: 'user2',
        joinedAt: new Date('2024-01-01T10:05:00Z'),
        isDeafened: false,
      };

      mockRedis.smembers.mockResolvedValue(userIds);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify(user1Data),
        JSON.stringify(user2Data),
      ]);

      const result = await service.getChannelPresence(channelId);

      expect(mockRedis.smembers).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:channel:${channelId}:members`),
      );
      expect(mockRedis.mget).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-1');
      expect(result[1].id).toBe('user-2');
    });

    it('should return empty array when no users in channel', async () => {
      const channelId = 'empty-channel';

      mockRedis.smembers.mockResolvedValue([]);

      const result = await service.getChannelPresence(channelId);

      expect(result).toEqual([]);
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });

    it('should clean up expired user data', async () => {
      const channelId = 'channel-456';
      const userIds = ['user-1', 'user-2'];

      mockRedis.smembers.mockResolvedValue(userIds);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({
          id: 'user-1',
          username: 'user1',
          joinedAt: new Date(),
          isDeafened: false,
        }),
        null, // User 2 data expired
      ]);

      const result = await service.getChannelPresence(channelId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-1');
      expect(mockRedis.srem).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:channel:${channelId}:members`),
        'user-2',
      );
    });

    it('should sort users by join time', async () => {
      const channelId = 'channel-789';
      const userIds = ['user-1', 'user-2', 'user-3'];
      const laterTime = new Date('2024-01-01T12:00:00Z');
      const earlierTime = new Date('2024-01-01T10:00:00Z');
      const middleTime = new Date('2024-01-01T11:00:00Z');

      mockRedis.smembers.mockResolvedValue(userIds);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({
          id: 'user-1',
          username: 'user1',
          joinedAt: laterTime,
          isDeafened: false,
        }),
        JSON.stringify({
          id: 'user-2',
          username: 'user2',
          joinedAt: earlierTime,
          isDeafened: false,
        }),
        JSON.stringify({
          id: 'user-3',
          username: 'user3',
          joinedAt: middleTime,
          isDeafened: false,
        }),
      ]);

      const result = await service.getChannelPresence(channelId);

      expect(result[0].id).toBe('user-2'); // Earliest
      expect(result[1].id).toBe('user-3'); // Middle
      expect(result[2].id).toBe('user-1'); // Latest
    });
  });

  describe('refreshPresence', () => {
    it('should extend TTL when key still exists', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';

      mockRedis.expire.mockResolvedValue(1);

      await service.refreshPresence(channelId, userId);

      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        90,
      );
      // Should NOT re-register
      expect(mockDatabaseService.user.findUnique).not.toHaveBeenCalled();
    });

    it('should re-register user when key has expired', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const mockUser = {
        id: userId,
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      };

      // expire returns 0 = key does not exist
      mockRedis.expire.mockResolvedValue(0);
      // No existing data (expired)
      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);

      await service.refreshPresence(channelId, userId);

      // Should have called handleWebhookChannelParticipantJoined internally
      expect(mockDatabaseService.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        expect.any(String),
        'EX',
        90,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_JOINED,
        expect.objectContaining({
          channelId,
          user: expect.objectContaining({ id: userId }),
        }),
      );
    });

    it('should not throw error on failure', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';

      mockRedis.expire.mockRejectedValue(new Error('Redis error'));

      await expect(
        service.refreshPresence(channelId, userId),
      ).resolves.not.toThrow();
    });
  });

  describe('refreshDmPresence', () => {
    it('should extend TTL when key still exists', async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';

      mockRedis.expire.mockResolvedValue(1);

      await service.refreshDmPresence(dmGroupId, userId);

      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining(
          `dm_voice_presence:user:${dmGroupId}:${userId}`,
        ),
        90,
      );
      // Should NOT re-register
      expect(mockDatabaseService.user.findUnique).not.toHaveBeenCalled();
    });

    it('should re-register user when key has expired', async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';
      const mockUser = {
        id: userId,
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      };

      // expire returns 0 = key does not exist
      mockRedis.expire.mockResolvedValue(0);
      // No existing data (expired)
      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.smembers.mockResolvedValue([]);

      await service.refreshDmPresence(dmGroupId, userId);

      // Should have called handleWebhookDmParticipantJoined internally
      expect(mockDatabaseService.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expect.stringContaining(
          `dm_voice_presence:user:${dmGroupId}:${userId}`,
        ),
        expect.any(String),
        'EX',
        90,
      );
    });

    it('should not throw error on failure', async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';

      mockRedis.expire.mockRejectedValue(new Error('Redis error'));

      await expect(
        service.refreshDmPresence(dmGroupId, userId),
      ).resolves.not.toThrow();
    });
  });

  describe('cleanupExpiredPresence', () => {
    it('should execute without errors', () => {
      expect(() => service.cleanupExpiredPresence()).not.toThrow();
    });
  });

  describe('getUserVoiceChannels', () => {
    it('should return all channels user is in', async () => {
      const userId = 'user-123';
      const channelIds = ['channel-1', 'channel-2', 'channel-3'];

      mockRedis.smembers.mockResolvedValue(channelIds);

      const result = await service.getUserVoiceChannels(userId);

      expect(mockRedis.smembers).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user_channels:${userId}`),
      );
      expect(result).toEqual(channelIds);
    });

    it('should return empty array when user not in any channels', async () => {
      const userId = 'user-456';

      mockRedis.smembers.mockResolvedValue([]);

      const result = await service.getUserVoiceChannels(userId);

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      const userId = 'user-789';

      mockRedis.smembers.mockRejectedValue(new Error('Redis error'));

      const result = await service.getUserVoiceChannels(userId);

      expect(result).toEqual([]);
    });
  });

  describe('updateDeafenState', () => {
    it('should update deafen state in Redis and broadcast', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const userData = {
        id: userId,
        username: 'testuser',
        joinedAt: new Date().toISOString(),
        isDeafened: false,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(userData));
      mockRedis.set.mockResolvedValue('OK');

      await service.updateDeafenState(channelId, userId, true);

      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        expect.stringContaining('"isDeafened":true'),
        'EX',
        90,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_UPDATED,
        expect.objectContaining({
          channelId,
          userId,
          user: expect.objectContaining({ id: userId, isDeafened: true }),
        }),
      );
    });

    it('should handle undeafening', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const userData = {
        id: userId,
        username: 'testuser',
        joinedAt: new Date().toISOString(),
        isDeafened: true,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(userData));
      mockRedis.set.mockResolvedValue('OK');

      await service.updateDeafenState(channelId, userId, false);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        expect.stringContaining('"isDeafened":false'),
        'EX',
        90,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_UPDATED,
        expect.objectContaining({
          user: expect.objectContaining({ isDeafened: false }),
        }),
      );
    });

    it('should not update if user not found in channel', async () => {
      const channelId = 'channel-123';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);

      await service.updateDeafenState(channelId, userId, true);

      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });

  describe('updateServerMuteState', () => {
    it('should update server mute state in Redis and broadcast', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const userData = {
        id: userId,
        username: 'testuser',
        joinedAt: new Date().toISOString(),
        isDeafened: false,
        isServerMuted: false,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(userData));
      mockRedis.set.mockResolvedValue('OK');

      await service.updateServerMuteState(channelId, userId, true);

      expect(mockRedis.get).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        expect.stringContaining('"isServerMuted":true'),
        'EX',
        90,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_UPDATED,
        expect.objectContaining({
          channelId,
          userId,
          user: expect.objectContaining({ id: userId, isServerMuted: true }),
        }),
      );
    });

    it('should handle server unmuting', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const userData = {
        id: userId,
        username: 'testuser',
        joinedAt: new Date().toISOString(),
        isDeafened: false,
        isServerMuted: true,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(userData));
      mockRedis.set.mockResolvedValue('OK');

      await service.updateServerMuteState(channelId, userId, false);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining(`voice_presence:user:${channelId}:${userId}`),
        expect.stringContaining('"isServerMuted":false'),
        'EX',
        90,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_UPDATED,
        expect.objectContaining({
          user: expect.objectContaining({ isServerMuted: false }),
        }),
      );
    });

    it('should not update if user not found in channel', async () => {
      const channelId = 'channel-123';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);

      await service.updateServerMuteState(channelId, userId, true);

      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });

  describe('leaveDmVoice', () => {
    it('should leave DM voice successfully', async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';
      const userData = {
        id: userId,
        username: 'testuser',
        joinedAt: new Date().toISOString(),
        isDeafened: false,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(userData));

      await service.leaveDmVoice(dmGroupId, userId);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        dmGroupId,
        ServerEvents.DM_VOICE_USER_LEFT,
        {
          dmGroupId,
          userId,
          user: userData,
        },
      );
    });

    it('should handle user not found gracefully', async () => {
      const dmGroupId = 'dm-group-456';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);

      await service.leaveDmVoice(dmGroupId, userId);

      expect(mockRedis.pipeline).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });
  });

  describe('getDmPresence', () => {
    it('should return all users in DM voice call', async () => {
      const dmGroupId = 'dm-group-123';
      const userIds = ['user-1', 'user-2'];
      const user1Data = {
        id: 'user-1',
        username: 'user1',
        joinedAt: new Date('2024-01-01T10:00:00Z'),
        isDeafened: false,
      };
      const user2Data = {
        id: 'user-2',
        username: 'user2',
        joinedAt: new Date('2024-01-01T10:05:00Z'),
        isDeafened: false,
      };

      mockRedis.smembers.mockResolvedValue(userIds);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify(user1Data),
        JSON.stringify(user2Data),
      ]);

      const result = await service.getDmPresence(dmGroupId);

      expect(mockRedis.smembers).toHaveBeenCalledWith(
        expect.stringContaining(`dm_voice_presence:dm:${dmGroupId}:members`),
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-1');
      expect(result[1].id).toBe('user-2');
    });

    it('should return empty array when no users in DM call', async () => {
      const dmGroupId = 'empty-dm';

      mockRedis.smembers.mockResolvedValue([]);

      const result = await service.getDmPresence(dmGroupId);

      expect(result).toEqual([]);
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });

    it('should clean up expired DM user data', async () => {
      const dmGroupId = 'dm-group-456';
      const userIds = ['user-1', 'user-2'];

      mockRedis.smembers.mockResolvedValue(userIds);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({
          id: 'user-1',
          username: 'user1',
          joinedAt: new Date(),
          isDeafened: false,
        }),
        null, // User 2 data expired
      ]);

      const result = await service.getDmPresence(dmGroupId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-1');
      expect(mockRedis.srem).toHaveBeenCalledWith(
        expect.stringContaining(`dm_voice_presence:dm:${dmGroupId}:members`),
        'user-2',
      );
    });
  });
});
