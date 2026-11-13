import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VoicePresenceService } from './voice-presence.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { WebsocketService } from '@/websocket/websocket.service';
import { DatabaseService } from '@/database/database.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { LivekitService } from '@/livekit/livekit.service';

import { ServerEvents } from '@semaphore-chat/shared';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import { VOICE_USER_LEFT } from '@/common/events/voice-presence.events';

describe('VoicePresenceService', () => {
  let service: VoicePresenceService;
  let websocketService: Mocked<WebsocketService>;
  let eventEmitter: Mocked<EventEmitter2>;
  let channelAccessService: Mocked<ChannelAccessService>;
  let livekitService: Mocked<LivekitService>;
  let mockDatabaseService: any;

  const mockPipeline = {
    set: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  // DM joins use MULTI: SET, SADD members, SADD user DMs, SCARD members.
  // DM leaves use MULTI: DEL user, SREM members, SREM user DMs, SCARD members.
  const mockMulti = {
    set: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    scard: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([
      [null, 'OK'],
      [null, 1],
      [null, 1],
      [null, 1],
    ]),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    smembers: jest.fn(),
    mget: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    pipeline: jest.fn(() => mockPipeline),
    multi: jest.fn(() => mockMulti),
  };

  beforeEach(async () => {
    mockDatabaseService = {
      directMessageGroup: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      directMessageGroupMember: {
        findFirst: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      userBlock: {
        findFirst: jest.fn(),
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
    eventEmitter = unitRef.get(EventEmitter2);
    channelAccessService = unitRef.get(ChannelAccessService);
    livekitService = unitRef.get(LivekitService);
    // Default: whoever refreshes is connected to the LiveKit room
    livekitService.isParticipantInRoom.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Implementations outlive clearAllMocks; a RejectedValue left by an earlier
  // test must not leak into the next one.
  beforeEach(() => {
    mockRedis.expire.mockReset();
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
        select: PUBLIC_USER_SELECT,
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

    it('should query user with PUBLIC_USER_SELECT to avoid fetching sensitive fields', async () => {
      const channelId = 'channel-123';
      const userId = 'user-123';
      const mockUser = {
        id: userId,
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
      };

      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);

      await service.joinVoiceChannelDirect(channelId, userId);

      expect(mockDatabaseService.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: PUBLIC_USER_SELECT,
      });
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

    it('should emit VOICE_USER_LEFT so listeners can clean up (e.g. replay buffer)', async () => {
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

      expect(eventEmitter.emit).toHaveBeenCalledWith(VOICE_USER_LEFT, {
        userId,
        channelId,
      });
    });

    it('should handle user not found gracefully', async () => {
      const channelId = 'channel-123';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);

      await service.leaveVoiceChannel(channelId, userId);

      expect(mockRedis.pipeline).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
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

    it('should strip sid and send joinedAt as an ISO string like the socket payload', async () => {
      const channelId = 'channel-wire';

      mockRedis.smembers.mockResolvedValue(['user-1']);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({
          id: 'user-1',
          username: 'user1',
          joinedAt: '2024-01-01T10:00:00.000Z',
          isDeafened: false,
          isServerMuted: false,
          sid: 'LK_internal',
        }),
      ]);

      const result = await service.getChannelPresence(channelId);

      expect(result[0]).not.toHaveProperty('sid');
      expect(result[0].joinedAt).toBe('2024-01-01T10:00:00.000Z');
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

  describe('getChannelPresenceForViewer', () => {
    it('marks the users this caller may moderate, never the caller', async () => {
      const channelId = 'channel-123';
      const viewer = { id: 'mod', role: 'USER' };
      mockRedis.smembers.mockResolvedValue(['mod', 'member', 'admin']);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({
          id: 'mod',
          username: 'mod',
          joinedAt: '2024-01-01T10:00:00.000Z',
          isDeafened: false,
          isServerMuted: false,
        }),
        JSON.stringify({
          id: 'member',
          username: 'member',
          joinedAt: '2024-01-01T10:01:00.000Z',
          isDeafened: false,
          isServerMuted: false,
        }),
        JSON.stringify({
          id: 'admin',
          username: 'admin',
          joinedAt: '2024-01-01T10:02:00.000Z',
          isDeafened: false,
          isServerMuted: false,
        }),
      ]);
      channelAccessService.moderatableParticipantIds.mockResolvedValue(
        new Set(['member']),
      );

      const result = await service.getChannelPresenceForViewer(
        channelId,
        viewer,
      );

      expect(
        channelAccessService.moderatableParticipantIds,
      ).toHaveBeenCalledWith(viewer, channelId, ['mod', 'member', 'admin']);
      expect(result.map((user) => [user.id, user.canModerate])).toEqual([
        ['mod', false],
        ['member', true],
        ['admin', false],
      ]);
    });

    it('leaves the socket-shaped presence read without canModerate', async () => {
      mockRedis.smembers.mockResolvedValue(['user-1']);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({
          id: 'user-1',
          username: 'user1',
          joinedAt: '2024-01-01T10:00:00.000Z',
          isDeafened: false,
          isServerMuted: false,
        }),
      ]);

      const [user] = await service.getChannelPresence('channel-123');

      expect(user).not.toHaveProperty('canModerate');
      expect(
        channelAccessService.moderatableParticipantIds,
      ).not.toHaveBeenCalled();
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
        select: PUBLIC_USER_SELECT,
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

    it('should re-register user when key has expired and user is a DM member', async () => {
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
      // Membership check passes
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue({
        groupId: dmGroupId,
        userId,
      });
      // No existing data (expired)
      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.smembers.mockResolvedValue([]);

      await service.refreshDmPresence(dmGroupId, userId);

      // Should verify membership first
      expect(
        mockDatabaseService.directMessageGroupMember.findFirst,
      ).toHaveBeenCalledWith({
        where: { groupId: dmGroupId, userId },
        select: { id: true },
      });
      // Should have called handleWebhookDmParticipantJoined internally
      expect(mockDatabaseService.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: PUBLIC_USER_SELECT,
      });
      expect(mockRedis.multi).toHaveBeenCalled();
      expect(mockMulti.set).toHaveBeenCalledWith(
        expect.stringContaining(
          `dm_voice_presence:user:${dmGroupId}:${userId}`,
        ),
        expect.any(String),
        'EX',
        90,
      );
    });

    it('refuses a non-member with 403 when the key has expired (#672)', async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';

      // expire returns 0 = key does not exist
      mockRedis.expire.mockResolvedValue(0);
      // Membership check fails
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.refreshDmPresence(dmGroupId, userId),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Should not re-register
      expect(mockDatabaseService.user.findUnique).not.toHaveBeenCalled();
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });

    it('refuses the blocked side of a 1:1 DM and rings nobody', async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';

      mockRedis.expire.mockResolvedValue(0);
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue({
        id: 'member-1',
      });
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        isGroup: false,
        members: [{ userId }, { userId: 'blocker-1' }],
      });
      mockDatabaseService.userBlock.findFirst.mockResolvedValue({
        id: 'block-1',
      });

      await expect(
        service.refreshDmPresence(dmGroupId, userId),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockDatabaseService.user.findUnique).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it("refuses with 409 to re-register a user who isn't in the LiveKit room", async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';

      mockRedis.expire.mockResolvedValue(0);
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue({
        id: 'member-1',
      });
      livekitService.isParticipantInRoom.mockResolvedValue(false);

      await expect(
        service.refreshDmPresence(dmGroupId, userId),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(livekitService.isParticipantInRoom).toHaveBeenCalledWith(
        dmGroupId,
        userId,
      );
      expect(mockDatabaseService.user.findUnique).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it("re-registers when LiveKit can't be asked (fails open)", async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';

      mockRedis.expire.mockResolvedValue(0);
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue({
        id: 'member-1',
      });
      livekitService.isParticipantInRoom.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue({
        id: userId,
        username: 'u',
        displayName: null,
        avatarUrl: null,
      });
      mockRedis.smembers.mockResolvedValue([]);

      await service.refreshDmPresence(dmGroupId, userId);

      expect(mockDatabaseService.user.findUnique).toHaveBeenCalled();
    });

    it('surfaces a Redis failure instead of reporting success (#672)', async () => {
      const dmGroupId = 'dm-group-123';
      const userId = 'user-123';
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      mockRedis.expire.mockRejectedValue(new Error('Redis error'));

      await expect(
        service.refreshDmPresence(dmGroupId, userId),
      ).rejects.toThrow('Redis error');
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('Failed to refresh DM presence'),
        expect.any(Error),
      );
      errorLog.mockRestore();
    });
  });

  describe('cleanupExpiredPresence', () => {
    it('should execute without errors', () => {
      expect(() => service.cleanupExpiredPresence()).not.toThrow();
    });
  });

  describe('getUserDmVoiceCalls', () => {
    it('returns the DM groups whose call the user is in', async () => {
      mockRedis.smembers.mockResolvedValue(['dm-1', 'dm-2']);

      const result = await service.getUserDmVoiceCalls('user-123');

      expect(mockRedis.smembers).toHaveBeenCalledWith(
        'dm_voice_presence:user_dms:user-123',
      );
      expect(result).toEqual(['dm-1', 'dm-2']);
    });

    it('returns an empty array on error', async () => {
      mockRedis.smembers.mockRejectedValue(new Error('Redis error'));

      await expect(service.getUserDmVoiceCalls('user-123')).resolves.toEqual(
        [],
      );
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

    it('should not update presence if user not found in channel', async () => {
      const channelId = 'channel-123';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);

      await service.updateDeafenState(channelId, userId, true);

      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it("sets the LiveKit deafen metadata, even when the presence entry is gone", async () => {
      mockRedis.get.mockResolvedValue(null);

      await service.updateDeafenState('channel-123', 'user-123', true);

      // Only a participant of the room gets it: LiveKit 404s anyone else
      expect(livekitService.setDeafenMetadata).toHaveBeenCalledWith(
        'channel-123',
        'user-123',
        true,
      );
    });
  });

  describe('updateDmDeafenState', () => {
    it("checks membership, then sets the caller's deafen metadata in the call", async () => {
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue({
        id: 'member-1',
      });

      await service.updateDmDeafenState('dm-1', 'user-1', true);

      expect(
        mockDatabaseService.directMessageGroupMember.findFirst,
      ).toHaveBeenCalledWith({
        where: { groupId: 'dm-1', userId: 'user-1' },
        select: { id: true },
      });
      expect(livekitService.setDeafenMetadata).toHaveBeenCalledWith(
        'dm-1',
        'user-1',
        true,
      );
    });

    it('refuses a non-member', async () => {
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue(
        null,
      );

      await expect(
        service.updateDmDeafenState('dm-1', 'user-1', true),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(livekitService.setDeafenMetadata).not.toHaveBeenCalled();
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

      expect(mockRedis.multi).toHaveBeenCalled();
      expect(mockMulti.srem).toHaveBeenCalledWith(
        `dm_voice_presence:dm:${dmGroupId}:members`,
        userId,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `dm:${dmGroupId}`,
        ServerEvents.DM_VOICE_USER_LEFT,
        {
          dmGroupId,
          userId,
          user: userData,
        },
      );
      // Someone else is still in the call (default SCARD is 1)
      expect(websocketService.sendToRoom).not.toHaveBeenCalledWith(
        `dm:${dmGroupId}`,
        ServerEvents.DM_VOICE_CALL_ENDED,
        expect.anything(),
      );
    });

    it('should handle user not found gracefully', async () => {
      const dmGroupId = 'dm-group-456';
      const userId = 'nonexistent-user';

      mockRedis.get.mockResolvedValue(null);

      await service.leaveDmVoice(dmGroupId, userId);

      expect(mockRedis.multi).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('announces the call ended when the last participant leaves', async () => {
      const dmGroupId = 'dm-last';
      const userId = 'user-123';
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          id: userId,
          username: 'testuser',
          joinedAt: new Date().toISOString(),
          isDeafened: false,
        }),
      );
      // DEL, SREM members, SREM user DMs, SCARD -> nothing left
      mockMulti.exec.mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 1],
        [null, 0],
      ]);

      await service.leaveDmVoice(dmGroupId, userId);

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `dm:${dmGroupId}`,
        ServerEvents.DM_VOICE_CALL_ENDED,
        { dmGroupId },
      );
      // The call's declines die with it
      expect(mockRedis.del).toHaveBeenCalledWith(
        `dm_voice_presence:declines:${dmGroupId}`,
      );
    });

    it('announces the call ended once, not on every later leave', async () => {
      const dmGroupId = 'dm-once';
      const userId = 'user-123';
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          id: userId,
          username: 'testuser',
          joinedAt: new Date().toISOString(),
          isDeafened: false,
        }),
      );
      mockMulti.exec.mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 1],
        [null, 0],
      ]);

      await service.leaveDmVoice(dmGroupId, userId);
      // A second participant_left for someone already gone changes nothing
      mockRedis.get.mockResolvedValueOnce(null);
      await service.leaveDmVoice(dmGroupId, 'someone-else');

      const ended = websocketService.sendToRoom.mock.calls.filter(
        ([, event]) => event === ServerEvents.DM_VOICE_CALL_ENDED,
      );
      expect(ended).toHaveLength(1);
    });
  });

  describe('declineDmVoiceCall', () => {
    const dmGroupId = 'dm-decline';
    const caller = 'caller';
    const guest = 'guest';
    const otherGuest = 'other-guest';
    const outsider = 'outsider';

    const presence = (id: string) => ({
      id,
      username: id,
      joinedAt: new Date().toISOString(),
      isDeafened: false,
      isServerMuted: false,
    });

    function inCall(...userIds: string[]) {
      mockRedis.smembers.mockResolvedValue(userIds);
      mockRedis.mget.mockResolvedValue(
        userIds.map((id) => JSON.stringify(presence(id))),
      );
    }

    function memberOfDm() {
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue({
        id: 'membership-1',
        groupId: dmGroupId,
        userId: caller,
      });
    }

    const declinedEvents = () =>
      websocketService.sendToRoom.mock.calls.filter(
        ([, event]) => event === ServerEvents.DM_VOICE_CALL_DECLINED,
      );

    it('refuses a non-member with 403 and announces nothing', async () => {
      mockDatabaseService.directMessageGroupMember.findFirst.mockResolvedValue(
        null,
      );
      inCall(caller);

      await expect(
        service.declineDmVoiceCall(dmGroupId, outsider),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockRedis.sadd).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('refuses when no call is active in the DM', async () => {
      memberOfDm();
      inCall();

      await expect(
        service.declineDmVoiceCall(dmGroupId, guest),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockRedis.sadd).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('refuses when the decliner is already in the call', async () => {
      memberOfDm();
      inCall(caller, guest);

      await expect(
        service.declineDmVoiceCall(dmGroupId, guest),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockRedis.sadd).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('tells every member of the DM and remembers the decline for this call', async () => {
      memberOfDm();
      inCall(caller);
      mockRedis.sadd.mockResolvedValue(1);
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        isGroup: false,
      });

      await service.declineDmVoiceCall(dmGroupId, guest);

      expect(mockRedis.sadd).toHaveBeenCalledWith(
        `dm_voice_presence:declines:${dmGroupId}`,
        guest,
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        `dm_voice_presence:declines:${dmGroupId}`,
        90,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `dm:${dmGroupId}`,
        ServerEvents.DM_VOICE_CALL_DECLINED,
        { dmGroupId, userId: guest, isGroup: false },
      );
    });

    it.each([
      ['a 1:1 DM', { isGroup: false }, false],
      ['a group DM', { isGroup: true }, true],
      ['a DM that cannot be read (treated as a group)', null, true],
    ])(
      'says whether the DM is a group in the payload: %s',
      async (_label, row, expected) => {
        memberOfDm();
        inCall(caller);
        mockRedis.sadd.mockResolvedValue(1);
        mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue(
          row,
        );

        await service.declineDmVoiceCall(dmGroupId, guest);

        expect(
          mockDatabaseService.directMessageGroup.findUnique,
        ).toHaveBeenCalledWith({
          where: { id: dmGroupId },
          select: { isGroup: true },
        });
        expect(websocketService.sendToRoom).toHaveBeenCalledWith(
          `dm:${dmGroupId}`,
          ServerEvents.DM_VOICE_CALL_DECLINED,
          { dmGroupId, userId: guest, isGroup: expected },
        );
      },
    );

    it('is idempotent: a repeated decline announces nothing', async () => {
      memberOfDm();
      inCall(caller);
      mockRedis.sadd.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await service.declineDmVoiceCall(dmGroupId, guest);
      await service.declineDmVoiceCall(dmGroupId, guest);

      expect(declinedEvents()).toHaveLength(1);
    });

    it.each([
      ['a 1:1 DM', [guest]],
      ['a group DM', [guest, otherGuest]],
    ])(
      'a decline in %s ends nothing on the server and removes nobody',
      async (_label, decliners) => {
        memberOfDm();
        inCall(caller);
        mockRedis.sadd.mockResolvedValue(1);

        for (const decliner of decliners) {
          await service.declineDmVoiceCall(dmGroupId, decliner);
        }

        expect(declinedEvents()).toHaveLength(decliners.length);
        expect(websocketService.sendToRoom).not.toHaveBeenCalledWith(
          `dm:${dmGroupId}`,
          ServerEvents.DM_VOICE_CALL_ENDED,
          expect.anything(),
        );
        // The caller stays in the call: no presence is touched
        expect(mockRedis.multi).not.toHaveBeenCalled();
        expect(mockRedis.srem).not.toHaveBeenCalled();
      },
    );
  });

  /**
   * Ghost-listener guarantee: the LiveKit webhook path is the authoritative
   * source of presence. A participant_joined for a user who NEVER called the
   * app's join/refresh endpoints must still create a presence entry in the
   * exact store the REST read path (getChannelPresence/getDmPresence)
   * returns — so nobody can lurk in a room invisibly. participant_left must
   * remove that entry again.
   */
  describe('webhook presence (ghost-listener guarantee)', () => {
    const mockUser = {
      id: 'ghost-user',
      username: 'ghostuser',
      displayName: 'Ghost User',
      avatarUrl: null,
    };

    it('participant_joined for a channel room creates a presence entry visible via getChannelPresence', async () => {
      const channelId = 'channel-ghost';

      // Room is not a DM group -> treated as a channel
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue(null);
      // User has no existing presence entry (never called join/refresh)
      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);

      await service.handleWebhookParticipantJoined(channelId, mockUser.id);

      // Entry written under the exact keys the REST read path consumes
      expect(mockPipeline.set).toHaveBeenCalledWith(
        `voice_presence:user:${channelId}:${mockUser.id}`,
        expect.any(String),
        'EX',
        90,
      );
      expect(mockPipeline.sadd).toHaveBeenCalledWith(
        `voice_presence:channel:${channelId}:members`,
        mockUser.id,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_JOINED,
        expect.objectContaining({
          channelId,
          user: expect.objectContaining({ id: mockUser.id }),
        }),
      );

      // Round-trip: feed the written payload back through the read path
      const writtenJson = mockPipeline.set.mock.calls[0][1] as string;
      mockRedis.smembers.mockResolvedValue([mockUser.id]);
      mockRedis.mget.mockResolvedValue([writtenJson]);

      const presence = await service.getChannelPresence(channelId);

      expect(presence).toHaveLength(1);
      expect(presence[0]).toMatchObject({
        id: mockUser.id,
        username: mockUser.username,
      });
    });

    it('participant_left for a channel room removes the presence entry', async () => {
      const channelId = 'channel-ghost';
      const userData = {
        id: mockUser.id,
        username: mockUser.username,
        joinedAt: new Date().toISOString(),
        isDeafened: false,
        isServerMuted: false,
      };

      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(JSON.stringify(userData));

      await service.handleWebhookParticipantLeft(channelId, mockUser.id);

      expect(mockPipeline.del).toHaveBeenCalledWith(
        `voice_presence:user:${channelId}:${mockUser.id}`,
      );
      expect(mockPipeline.srem).toHaveBeenCalledWith(
        `voice_presence:channel:${channelId}:members`,
        mockUser.id,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_LEFT,
        expect.objectContaining({ channelId, userId: mockUser.id }),
      );

      // Read path now sees an empty channel
      mockRedis.smembers.mockResolvedValue([]);
      const presence = await service.getChannelPresence(channelId);
      expect(presence).toEqual([]);
    });

    it('participant_joined for a DM room creates a presence entry visible via getDmPresence', async () => {
      const dmGroupId = 'dm-ghost';

      // Room IS a DM group
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        id: dmGroupId,
      });
      // User has no existing presence entry
      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);

      await service.handleWebhookParticipantJoined(dmGroupId, mockUser.id);

      expect(mockMulti.set).toHaveBeenCalledWith(
        `dm_voice_presence:user:${dmGroupId}:${mockUser.id}`,
        expect.any(String),
        'EX',
        90,
      );
      expect(mockMulti.sadd).toHaveBeenCalledWith(
        `dm_voice_presence:dm:${dmGroupId}:members`,
        mockUser.id,
      );
      // First user joining announces the call start
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `dm:${dmGroupId}`,
        ServerEvents.DM_VOICE_CALL_STARTED,
        expect.objectContaining({ dmGroupId, startedBy: mockUser.id }),
      );

      // Round-trip: feed the written payload back through the read path
      const writtenJson = mockMulti.set.mock.calls[0][1] as string;
      mockRedis.smembers.mockResolvedValue([mockUser.id]);
      mockRedis.mget.mockResolvedValue([writtenJson]);

      const presence = await service.getDmPresence(dmGroupId);

      expect(presence).toHaveLength(1);
      expect(presence[0]).toMatchObject({
        id: mockUser.id,
        username: mockUser.username,
      });
    });

    it('announces the DM call only once when two users join at the same time', async () => {
      const dmGroupId = 'dm-race';
      const users: Record<string, typeof mockUser> = {
        'ghost-a': { ...mockUser, id: 'ghost-a', username: 'ghosta' },
        'ghost-b': { ...mockUser, id: 'ghost-b', username: 'ghostb' },
      };
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        id: dmGroupId,
      });
      mockRedis.get.mockResolvedValue(null);
      // Pre-fix code decided "first" from a separate SMEMBERS read, so both
      // joins would see this empty set.
      mockRedis.smembers.mockResolvedValue([]);
      mockDatabaseService.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(users[where.id]),
      );

      // A real transaction: each join's SADD reply and SCARD run together,
      // so the second join sees the first one's member.
      const members = new Set<string>();
      mockRedis.multi.mockImplementation(() => {
        let ops: Array<() => [null, unknown]> = [];
        const chain = {
          set: jest.fn(),
          sadd: jest.fn(),
          srem: jest.fn(),
          del: jest.fn(),
          scard: jest.fn(),
          exec: jest.fn(),
        };
        chain.set.mockImplementation(() => {
          ops.push(() => [null, 'OK']);
          return chain;
        });
        chain.sadd.mockImplementation((key: string, member: string) => {
          ops.push(() => {
            // Only the members set is counted; the user-to-DMs set is not.
            if (!key.endsWith(':members')) return [null, 1];
            const added = members.has(member) ? 0 : 1;
            members.add(member);
            return [null, added];
          });
          return chain;
        });
        chain.scard.mockImplementation(() => {
          ops.push(() => [null, members.size]);
          return chain;
        });
        chain.exec.mockImplementation(() => {
          const results = ops.map((op) => op());
          ops = [];
          return Promise.resolve(results);
        });
        return chain;
      });

      await Promise.all([
        service.handleWebhookParticipantJoined(dmGroupId, 'ghost-a'),
        service.handleWebhookParticipantJoined(dmGroupId, 'ghost-b'),
      ]);

      const started = websocketService.sendToRoom.mock.calls.filter(
        ([, event]) => event === ServerEvents.DM_VOICE_CALL_STARTED,
      );
      const joined = websocketService.sendToRoom.mock.calls.filter(
        ([, event]) => event === ServerEvents.DM_VOICE_USER_JOINED,
      );
      expect(started).toHaveLength(1);
      expect(joined).toHaveLength(1);

      mockRedis.multi.mockImplementation(() => mockMulti);
    });

    it('announces nothing when a write inside the DM join transaction fails', async () => {
      const dmGroupId = 'dm-write-fails';
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        id: dmGroupId,
      });
      mockRedis.get.mockResolvedValue(null);
      mockDatabaseService.user.findUnique.mockResolvedValue(mockUser);
      // EXEC resolves, but one command inside it reports an error.
      mockMulti.exec.mockResolvedValueOnce([
        [null, 'OK'],
        [new Error('WRONGTYPE'), null],
        [null, 1],
        [null, 1],
      ]);
      websocketService.sendToRoom.mockClear();

      await service.handleWebhookParticipantJoined(dmGroupId, mockUser.id);

      const announced = websocketService.sendToRoom.mock.calls.filter(
        ([, event]) =>
          event === ServerEvents.DM_VOICE_CALL_STARTED ||
          event === ServerEvents.DM_VOICE_USER_JOINED,
      );
      expect(announced).toHaveLength(0);
    });

    it('participant_left for a DM room removes the presence entry', async () => {
      const dmGroupId = 'dm-ghost';
      const userData = {
        id: mockUser.id,
        username: mockUser.username,
        joinedAt: new Date().toISOString(),
        isDeafened: false,
        isServerMuted: false,
      };

      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        id: dmGroupId,
      });
      mockRedis.get.mockResolvedValue(JSON.stringify(userData));

      await service.handleWebhookParticipantLeft(dmGroupId, mockUser.id);

      expect(mockMulti.del).toHaveBeenCalledWith(
        `dm_voice_presence:user:${dmGroupId}:${mockUser.id}`,
      );
      expect(mockMulti.srem).toHaveBeenCalledWith(
        `dm_voice_presence:dm:${dmGroupId}:members`,
        mockUser.id,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `dm:${dmGroupId}`,
        ServerEvents.DM_VOICE_USER_LEFT,
        expect.objectContaining({ dmGroupId, userId: mockUser.id }),
      );

      // Read path now sees an empty call
      mockRedis.smembers.mockResolvedValue([]);
      const presence = await service.getDmPresence(dmGroupId);
      expect(presence).toEqual([]);
    });
  });

  /**
   * A user who rejoins (new LiveKit participant session, same identity) can
   * have the old session's participant_left delivered *after* the new join.
   * The stored sid lets presence tell the two apart.
   */
  describe('stale participant_left after a rejoin', () => {
    const channelId = 'channel-rejoin';
    const userId = 'user-rejoin';

    const storedPresence = (sid?: string) =>
      JSON.stringify({
        id: userId,
        username: 'rejoiner',
        joinedAt: new Date().toISOString(),
        isDeafened: false,
        isServerMuted: false,
        ...(sid ? { sid } : {}),
      });

    it('keeps the new session and emits no VOICE_USER_LEFT when the old left arrives late', async () => {
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue(null);
      // The presence record currently belongs to the old session
      mockRedis.get.mockResolvedValue(storedPresence('LK_old'));

      // New session joins (same identity, new sid) before the old leave
      await service.handleWebhookParticipantJoined(
        channelId,
        userId,
        undefined,
        undefined,
        'LK_new',
      );

      // The stored record now carries the new session's sid
      expect(mockRedis.set).toHaveBeenCalledWith(
        `voice_presence:user:${channelId}:${userId}`,
        expect.stringContaining('"sid":"LK_new"'),
        'EX',
        90,
      );

      // The old session's participant_left arrives out of order
      const updatedRecord = mockRedis.set.mock.calls[0][1] as string;
      mockRedis.get.mockResolvedValue(updatedRecord);
      mockPipeline.del.mockClear();

      await service.handleWebhookParticipantLeft(channelId, userId, 'LK_old');

      // Presence is untouched: no delete, no broadcast, no replay teardown
      expect(mockPipeline.del).not.toHaveBeenCalled();
      expect(mockPipeline.srem).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        VOICE_USER_LEFT,
        expect.anything(),
      );

      // Round-trip: the rejoin is still visible through the read path
      mockRedis.smembers.mockResolvedValue([userId]);
      mockRedis.mget.mockResolvedValue([updatedRecord]);
      const presence = await service.getChannelPresence(channelId);
      expect(presence).toHaveLength(1);
    });

    it('removes presence when the departing sid matches the stored one', async () => {
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(storedPresence('LK_same'));

      await service.handleWebhookParticipantLeft(channelId, userId, 'LK_same');

      expect(mockPipeline.del).toHaveBeenCalledWith(
        `voice_presence:user:${channelId}:${userId}`,
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_LEFT,
        expect.objectContaining({ channelId, userId }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(VOICE_USER_LEFT, {
        userId,
        channelId,
      });
    });

    it('keeps the old behaviour when no sid is stored (REST-only presence)', async () => {
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(storedPresence());

      await service.handleWebhookParticipantLeft(channelId, userId, 'LK_any');

      expect(mockPipeline.del).toHaveBeenCalledWith(
        `voice_presence:user:${channelId}:${userId}`,
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(VOICE_USER_LEFT, {
        userId,
        channelId,
      });
    });

    it('REST join never clears a sid stored by the webhook', async () => {
      mockRedis.get.mockResolvedValue(storedPresence('LK_1'));
      mockRedis.expire.mockResolvedValue(1);

      await service.joinVoiceChannelDirect(channelId, userId);

      // TTL refreshed, record not rewritten (so the sid survives)
      expect(mockRedis.expire).toHaveBeenCalledWith(
        `voice_presence:user:${channelId}:${userId}`,
        90,
      );
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('ignores a stale DM participant_left too', async () => {
      const dmGroupId = 'dm-rejoin';
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        id: dmGroupId,
      });
      mockRedis.get.mockResolvedValue(storedPresence('LK_new'));

      mockMulti.del.mockClear();
      mockMulti.srem.mockClear();

      await service.handleWebhookParticipantLeft(dmGroupId, userId, 'LK_old');

      expect(mockMulti.del).not.toHaveBeenCalled();
      expect(mockMulti.srem).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('stores a DM rejoin sid so the old session left is ignored', async () => {
      const dmGroupId = 'dm-rejoin';
      mockDatabaseService.directMessageGroup.findUnique.mockResolvedValue({
        id: dmGroupId,
      });
      mockRedis.get.mockResolvedValue(storedPresence('LK_old'));

      await service.handleWebhookParticipantJoined(
        dmGroupId,
        userId,
        undefined,
        undefined,
        'LK_new',
      );

      expect(mockRedis.set).toHaveBeenCalledWith(
        `dm_voice_presence:user:${dmGroupId}:${userId}`,
        expect.stringContaining('"sid":"LK_new"'),
        'EX',
        90,
      );

      const updatedRecord = mockRedis.set.mock.calls[0][1] as string;
      mockRedis.get.mockResolvedValue(updatedRecord);
      mockPipeline.del.mockClear();

      mockMulti.del.mockClear();
      mockMulti.srem.mockClear();

      await service.handleWebhookParticipantLeft(dmGroupId, userId, 'LK_old');

      expect(mockMulti.del).not.toHaveBeenCalled();
      expect(mockMulti.srem).not.toHaveBeenCalled();
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

    it('should strip sid and send joinedAt as an ISO string like the socket payload', async () => {
      const dmGroupId = 'dm-wire';

      mockRedis.smembers.mockResolvedValue(['user-1']);
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({
          id: 'user-1',
          username: 'user1',
          joinedAt: '2024-01-01T10:00:00.000Z',
          isDeafened: false,
          isServerMuted: false,
          sid: 'LK_internal',
        }),
      ]);

      const result = await service.getDmPresence(dmGroupId);

      expect(result[0]).not.toHaveProperty('sid');
      expect(result[0].joinedAt).toBe('2024-01-01T10:00:00.000Z');
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
      expect(mockMulti.srem).toHaveBeenCalledWith(
        expect.stringContaining(`dm_voice_presence:dm:${dmGroupId}:members`),
        'user-2',
      );
    });

    it('ends the call once when every presence has expired', async () => {
      const dmGroupId = 'dm-all-expired';

      mockRedis.smembers.mockResolvedValue(['user-1']);
      mockRedis.mget.mockResolvedValue([null]);
      // The cleanup SREM removed the last member, and nothing is left
      mockMulti.exec.mockResolvedValueOnce([
        [null, 1],
        [null, 0],
      ]);

      const result = await service.getDmPresence(dmGroupId);

      expect(result).toEqual([]);
      const ended = websocketService.sendToRoom.mock.calls.filter(
        ([, event]) => event === ServerEvents.DM_VOICE_CALL_ENDED,
      );
      expect(ended).toHaveLength(1);
      expect(ended[0]).toEqual([
        `dm:${dmGroupId}`,
        expect.anything(),
        { dmGroupId },
      ]);
      expect(mockRedis.del).toHaveBeenCalledWith(
        `dm_voice_presence:declines:${dmGroupId}`,
      );
    });
  });
});
