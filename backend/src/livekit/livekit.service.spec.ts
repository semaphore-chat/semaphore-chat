import { TestBed } from '@suites/unit';
import { LivekitService } from './livekit.service';
import { ConfigService } from '@nestjs/config';
import { createMockConfigService } from '@/test-utils';
import { LivekitException } from './exceptions/livekit.exception';
import { AccessToken } from 'livekit-server-sdk';
import { ROOM_SERVICE_CLIENT } from './providers/room-service.provider';
import {
  LIVEKIT_ISSUED_AT_ATTRIBUTE,
  LIVEKIT_SESSION_ATTRIBUTE,
  verifyIssuedAt,
  verifySessionId,
} from './livekit-token-attributes.util';

// Mock the livekit-server-sdk
jest.mock('livekit-server-sdk', () => {
  return {
    AccessToken: jest.fn().mockImplementation(() => {
      return {
        addGrant: jest.fn(),
        toJwt: jest.fn().mockResolvedValue('mock-jwt-token'),
      };
    }),
    TrackSource: { MICROPHONE: 2 },
  };
});

describe('LivekitService', () => {
  let service: LivekitService;
  let configService: any;

  const mockConfig = {
    LIVEKIT_API_KEY: 'test-api-key',
    LIVEKIT_API_SECRET: 'test-api-secret',
    LIVEKIT_URL: 'wss://test.livekit.cloud',
  };

  const mockRoomServiceClient = {
    getParticipant: jest.fn(),
    mutePublishedTrack: jest.fn(),
    removeParticipant: jest.fn(),
    listRooms: jest.fn(),
    listParticipants: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService = createMockConfigService(mockConfig);

    const { unit } = await TestBed.solitary(LivekitService)
      .mock(ConfigService)
      .final(configService)
      .mock(ROOM_SERVICE_CLIENT)
      .final(mockRoomServiceClient)
      .compile();

    service = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateToken', () => {
    it('should generate token with default TTL', async () => {
      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
        name: 'Test User',
      };

      const result = await service.generateToken(createTokenDto);

      expect(result.token).toBe('mock-jwt-token');
      expect(result.identity).toBe(createTokenDto.identity);
      expect(result.roomId).toBe(createTokenDto.roomId);
      expect(result.url).toBe(mockConfig.LIVEKIT_URL);
      expect(result.expiresAt).toBeInstanceOf(Date);

      expect(AccessToken).toHaveBeenCalledWith(
        mockConfig.LIVEKIT_API_KEY,
        mockConfig.LIVEKIT_API_SECRET,
        {
          identity: createTokenDto.identity,
          name: createTokenDto.name,
          ttl: 3600, // Default 1 hour
          attributes: {
            [LIVEKIT_ISSUED_AT_ATTRIBUTE]: expect.any(String),
          },
        },
      );
    });

    it('signs the issue time into the token attributes', async () => {
      const before = Date.now();
      await service.generateToken({ identity: 'user-123', roomId: 'room-456' });
      const after = Date.now();

      const options = (AccessToken as jest.Mock).mock.calls[0][2] as {
        attributes: Record<string, string>;
      };
      const issuedAt = verifyIssuedAt(
        mockConfig.LIVEKIT_API_SECRET,
        'user-123',
        options.attributes[LIVEKIT_ISSUED_AT_ATTRIBUTE],
      );
      expect(issuedAt).not.toBeNull();
      expect(issuedAt).toBeGreaterThanOrEqual(before);
      expect(issuedAt).toBeLessThanOrEqual(after);
    });

    it("signs the caller's session into the token attributes", async () => {
      await service.generateToken(
        { identity: 'user-123', roomId: 'room-456' },
        'session-1',
      );

      const options = (AccessToken as jest.Mock).mock.calls[0][2] as {
        attributes: Record<string, string>;
      };
      expect(
        verifySessionId(
          mockConfig.LIVEKIT_API_SECRET,
          'user-123',
          options.attributes[LIVEKIT_SESSION_ATTRIBUTE],
        ),
      ).toBe('session-1');
    });

    it('omits the session attribute without a session', async () => {
      await service.generateToken({ identity: 'user-123', roomId: 'room-456' });

      const options = (AccessToken as jest.Mock).mock.calls[0][2] as {
        attributes: Record<string, string>;
      };
      expect(options.attributes).not.toHaveProperty(LIVEKIT_SESSION_ATTRIBUTE);
    });

    it('should generate token with custom TTL', async () => {
      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
        name: 'Test User',
        ttl: 7200, // 2 hours
      };

      const result = await service.generateToken(createTokenDto);

      expect(result.token).toBe('mock-jwt-token');
      expect(AccessToken).toHaveBeenCalledWith(
        mockConfig.LIVEKIT_API_KEY,
        mockConfig.LIVEKIT_API_SECRET,
        expect.objectContaining({
          ttl: 7200,
        }),
      );
    });

    it('should use identity as name when name not provided', async () => {
      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
      };

      await service.generateToken(createTokenDto);

      expect(AccessToken).toHaveBeenCalledWith(
        mockConfig.LIVEKIT_API_KEY,
        mockConfig.LIVEKIT_API_SECRET,
        expect.objectContaining({
          identity: 'user-123',
          name: 'user-123', // Should use identity as fallback
        }),
      );
    });

    it('should grant room permissions', async () => {
      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
        name: 'Test User',
      };

      await service.generateToken(createTokenDto);

      // Get the mock instance that was created
      const mockAccessTokenInstance = (AccessToken as jest.Mock).mock.results[
        (AccessToken as jest.Mock).mock.results.length - 1
      ].value;

      expect(mockAccessTokenInstance.addGrant).toHaveBeenCalledWith({
        room: 'room-456',
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
      });
    });

    it('should throw LivekitException when API key is missing', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'LIVEKIT_API_KEY') return undefined;
        return mockConfig[key as keyof typeof mockConfig];
      });

      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
      };

      await expect(service.generateToken(createTokenDto)).rejects.toThrow(
        LivekitException,
      );
      await expect(service.generateToken(createTokenDto)).rejects.toThrow(
        'LiveKit credentials not configured',
      );
    });

    it('should throw LivekitException when API secret is missing', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'LIVEKIT_API_SECRET') return undefined;
        return mockConfig[key as keyof typeof mockConfig];
      });

      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
      };

      await expect(service.generateToken(createTokenDto)).rejects.toThrow(
        LivekitException,
      );
    });

    it('should throw LivekitException when token generation fails', async () => {
      // Mock AccessToken to throw an error
      (AccessToken as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Token generation error');
      });

      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
      };

      await expect(service.generateToken(createTokenDto)).rejects.toThrow(
        'Failed to generate token',
      );
    });

    it('should calculate correct expiration time', async () => {
      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
        ttl: 3600,
      };

      const beforeTime = Date.now();
      const result = await service.generateToken(createTokenDto);
      const afterTime = Date.now();

      const expectedExpiry = beforeTime + 3600 * 1000;
      const actualExpiry = result.expiresAt!.getTime();

      // Allow 1 second tolerance
      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry);
      expect(actualExpiry).toBeLessThanOrEqual(afterTime + 3600 * 1000);
    });

    it('should log token generation success', async () => {
      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
      };

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.generateToken(createTokenDto);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Generated token for user user-123 in room room-456',
        ),
      );
    });

    it('should log error when token generation fails', async () => {
      (AccessToken as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Token error');
      });

      const loggerSpy = jest.spyOn(service['logger'], 'error');

      const createTokenDto = {
        identity: 'user-123',
        roomId: 'room-456',
      };

      await expect(service.generateToken(createTokenDto)).rejects.toThrow();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to generate LiveKit token',
        expect.any(Error),
      );
    });
  });

  describe('getConnectionInfo', () => {
    it('should return LiveKit URL', () => {
      const result = service.getConnectionInfo();

      expect(result).toEqual({
        url: mockConfig.LIVEKIT_URL,
      });
    });

    it('should return url as undefined when not configured', () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);

      const result = service.getConnectionInfo();

      expect(result).toEqual({
        url: undefined,
      });
    });
  });

  describe('validateConfiguration', () => {
    it('should return true when all configuration is present', () => {
      const result = service.validateConfiguration();

      expect(result).toBe(true);
    });

    it('should return false when API key is missing', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'LIVEKIT_API_KEY') return undefined;
        return mockConfig[key as keyof typeof mockConfig];
      });

      const result = service.validateConfiguration();

      expect(result).toBe(false);
    });

    it('should return false when API secret is missing', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'LIVEKIT_API_SECRET') return undefined;
        return mockConfig[key as keyof typeof mockConfig];
      });

      const result = service.validateConfiguration();

      expect(result).toBe(false);
    });

    it('should return false when URL is missing', () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'LIVEKIT_URL') return undefined;
        return mockConfig[key as keyof typeof mockConfig];
      });

      const result = service.validateConfiguration();

      expect(result).toBe(false);
    });

    it('should log success when configuration is valid', () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      service.validateConfiguration();

      expect(loggerSpy).toHaveBeenCalledWith(
        'LiveKit configuration validated successfully',
      );
    });

    it('should log warning when configuration is incomplete', () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);

      const loggerSpy = jest.spyOn(service['logger'], 'warn');

      service.validateConfiguration();

      expect(loggerSpy).toHaveBeenCalledWith(
        'LiveKit configuration incomplete',
      );
    });
  });

  describe('muteParticipant', () => {
    it('should mute participant microphone tracks', async () => {
      mockRoomServiceClient.getParticipant.mockResolvedValue({
        tracks: [
          { source: 2, sid: 'track-mic-1' }, // MICROPHONE
          { source: 1, sid: 'track-cam-1' }, // CAMERA — should be skipped
        ],
      });

      await service.muteParticipant('room-1', 'user-1', true);

      expect(mockRoomServiceClient.getParticipant).toHaveBeenCalledWith(
        'room-1',
        'user-1',
      );
      expect(mockRoomServiceClient.mutePublishedTrack).toHaveBeenCalledTimes(1);
      expect(mockRoomServiceClient.mutePublishedTrack).toHaveBeenCalledWith(
        'room-1',
        'user-1',
        'track-mic-1',
        true,
      );
    });

    it('should unmute participant microphone tracks', async () => {
      mockRoomServiceClient.getParticipant.mockResolvedValue({
        tracks: [{ source: 2, sid: 'track-mic-1' }],
      });

      await service.muteParticipant('room-1', 'user-1', false);

      expect(mockRoomServiceClient.mutePublishedTrack).toHaveBeenCalledWith(
        'room-1',
        'user-1',
        'track-mic-1',
        false,
      );
    });

    it('should throw when roomServiceClient is not configured', async () => {
      // Create a service with null roomServiceClient using TestBed
      const { unit: serviceWithoutClient } = await TestBed.solitary(
        LivekitService,
      )
        .mock(ConfigService)
        .final(createMockConfigService(mockConfig))
        .mock(ROOM_SERVICE_CLIENT)
        .final(null as any)
        .compile();

      await expect(
        serviceWithoutClient.muteParticipant('room-1', 'user-1', true),
      ).rejects.toThrow('LiveKit credentials not configured');
    });

    it('should throw LivekitException when getParticipant fails', async () => {
      mockRoomServiceClient.getParticipant.mockRejectedValue(
        new Error('Participant not found'),
      );

      await expect(
        service.muteParticipant('room-1', 'user-1', true),
      ).rejects.toThrow('Failed to mute participant');
    });

    it('should skip non-microphone tracks', async () => {
      mockRoomServiceClient.getParticipant.mockResolvedValue({
        tracks: [
          { source: 1, sid: 'track-cam' }, // CAMERA
          { source: 3, sid: 'track-screen' }, // SCREEN_SHARE
        ],
      });

      await service.muteParticipant('room-1', 'user-1', true);

      expect(mockRoomServiceClient.mutePublishedTrack).not.toHaveBeenCalled();
    });
  });

  describe('listParticipantRooms', () => {
    it('returns the rooms the identity is in', async () => {
      mockRoomServiceClient.listRooms.mockResolvedValue([
        { name: 'voice-1' },
        { name: 'dm-1' },
        { name: 'other' },
      ]);
      mockRoomServiceClient.listParticipants.mockImplementation(
        (room: string) =>
          Promise.resolve(
            room === 'other'
              ? [{ identity: 'user-2' }]
              : [
                  { identity: 'user-2', attributes: { a: 'other' } },
                  { identity: 'user-1', attributes: { a: room } },
                ],
          ),
      );

      await expect(service.listParticipantRooms('user-1')).resolves.toEqual([
        { roomName: 'voice-1', attributes: { a: 'voice-1' } },
        { roomName: 'dm-1', attributes: { a: 'dm-1' } },
      ]);
    });

    it('skips rooms whose participants cannot be listed', async () => {
      mockRoomServiceClient.listRooms.mockResolvedValue([
        { name: 'gone' },
        { name: 'voice-1' },
      ]);
      mockRoomServiceClient.listParticipants.mockImplementation(
        (room: string) =>
          room === 'gone'
            ? Promise.reject(new Error('room not found'))
            : Promise.resolve([{ identity: 'user-1' }]),
      );

      await expect(service.listParticipantRooms('user-1')).resolves.toEqual([
        { roomName: 'voice-1', attributes: {} },
      ]);
    });

    it('returns [] when LiveKit is unreachable', async () => {
      mockRoomServiceClient.listRooms.mockRejectedValue(new Error('down'));

      await expect(service.listParticipantRooms('user-1')).resolves.toEqual([]);
    });

    it('returns [] when LiveKit is not configured', async () => {
      const { unit } = await TestBed.solitary(LivekitService)
        .mock(ConfigService)
        .final(configService)
        .mock(ROOM_SERVICE_CLIENT)
        .final(null as any)
        .compile();

      await expect(unit.listParticipantRooms('user-1')).resolves.toEqual([]);
    });
  });

  describe('removeParticipant', () => {
    it('should call roomServiceClient.removeParticipant with correct arguments', async () => {
      await service.removeParticipant('room-1', 'user-1');

      expect(mockRoomServiceClient.removeParticipant).toHaveBeenCalledWith(
        'room-1',
        'user-1',
      );
    });

    it('should log success when participant is removed', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.removeParticipant('room-1', 'user-1');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Removed participant user-1 from room room-1',
      );
    });

    it('should swallow errors and log a warning', async () => {
      mockRoomServiceClient.removeParticipant.mockRejectedValue(
        new Error('participant not found'),
      );
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await expect(
        service.removeParticipant('room-1', 'user-1'),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove participant user-1'),
      );
    });

    it('should gracefully no-op when roomServiceClient is null', async () => {
      const { unit: serviceWithoutClient } = await TestBed.solitary(
        LivekitService,
      )
        .mock(ConfigService)
        .final(createMockConfigService(mockConfig))
        .mock(ROOM_SERVICE_CLIENT)
        .final(null as any)
        .compile();

      const warnSpy = jest.spyOn(serviceWithoutClient['logger'], 'warn');

      await expect(
        serviceWithoutClient.removeParticipant('room-1', 'user-1'),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        'LiveKit credentials not configured, cannot remove participant',
      );
    });
  });
});
