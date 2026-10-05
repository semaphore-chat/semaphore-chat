import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { LivekitController } from './livekit.controller';
import { LivekitService } from './livekit.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { UserFactory } from '@/test-utils';
import { CreateTokenDto } from './dto/create-token.dto';
import { JwtService } from '@nestjs/jwt';
import { TrackSource } from 'livekit-server-sdk';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { FULL_PUBLISH_GRANT } from './publish-grant.util';

describe('LivekitController', () => {
  let controller: LivekitController;
  let service: Mocked<LivekitService>;
  let voicePresenceService: Mocked<VoicePresenceService>;
  let jwtService: Mocked<JwtService>;
  let channelAccessService: Mocked<ChannelAccessService>;

  const allCaps = {
    channelId: 'room-1',
    view: true,
    post: true,
    attach: true,
    react: true,
    threadReply: true,
    connect: true,
    speak: true,
    video: true,
    share: true,
    managePermissions: false,
    timedOutUntil: null,
    postingRoleNames: [],
  };

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: mockUser,
    headers: {},
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(LivekitController).compile();

    controller = unit;
    service = unitRef.get(LivekitService);
    voicePresenceService = unitRef.get(VoicePresenceService);
    jwtService = unitRef.get(JwtService);
    channelAccessService = unitRef.get(ChannelAccessService);
    channelAccessService.channelCapabilities.mockResolvedValue(allCaps);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('session binding', () => {
    it.each([
      ['channel', 'generateToken'],
      ['DM', 'generateDmToken'],
    ] as const)(
      "binds the %s token to the caller's session (JWT sid)",
      async (_kind, method) => {
        jwtService.decode.mockReturnValue({ sub: mockUser.id, sid: 'sess-1' });
        const req = {
          user: mockUser,
          headers: { authorization: 'Bearer access-jwt' },
        } as any;

        await controller[method]({ roomId: 'room-1', identity: '' }, req);

        expect(jwtService.decode).toHaveBeenCalledWith('access-jwt');
        expect(service.generateToken).toHaveBeenCalledWith(
          { roomId: 'room-1', identity: mockUser.id },
          'sess-1',
          FULL_PUBLISH_GRANT,
        );
      },
    );

    it('reads the access token from the cookie too', async () => {
      jwtService.decode.mockReturnValue({ sub: mockUser.id, sid: 'sess-2' });
      const req = {
        user: mockUser,
        headers: {},
        cookies: { access_token: 'cookie-jwt' },
      } as any;

      await controller.generateToken({ roomId: 'room-1', identity: '' }, req);

      expect(jwtService.decode).toHaveBeenCalledWith('cookie-jwt');
      expect(service.generateToken).toHaveBeenCalledWith(
        { roomId: 'room-1', identity: mockUser.id },
        'sess-2',
        FULL_PUBLISH_GRANT,
      );
    });

    it('issues a token without a session when the access token has none', async () => {
      jwtService.decode.mockReturnValue({ sub: mockUser.id });
      const req = {
        user: mockUser,
        headers: { authorization: 'Bearer legacy-jwt' },
      } as any;

      await controller.generateToken({ roomId: 'room-1', identity: '' }, req);

      expect(service.generateToken).toHaveBeenCalledWith(
        { roomId: 'room-1', identity: mockUser.id },
        undefined,
        FULL_PUBLISH_GRANT,
      );
    });
  });

  describe('generateToken', () => {
    it('should generate LiveKit token for channel', async () => {
      const createTokenDto: CreateTokenDto = {
        roomId: 'channel-123',
        identity: 'user-456',
        name: 'Test User',
      };

      const mockTokenResponse = {
        token: 'livekit-token-abc123',
        url: 'wss://livekit.io',
        identity: mockUser.id,
        roomId: 'channel-123',
      };

      service.generateToken.mockResolvedValue(mockTokenResponse);

      const result = await controller.generateToken(
        createTokenDto,
        mockRequest,
      );

      // Identity should always be forced to req.user.id
      expect(service.generateToken).toHaveBeenCalledWith(
        {
          ...createTokenDto,
          identity: mockUser.id,
        },
        undefined, // no session: the request carries no access token
        FULL_PUBLISH_GRANT,
      );
      expect(result).toEqual(mockTokenResponse);
    });

    it('should use authenticated user ID as identity when not provided', async () => {
      const createTokenDto: CreateTokenDto = {
        roomId: 'channel-789',
        identity: '',
        name: 'User Name',
      };

      service.generateToken.mockResolvedValue({
        token: 'token',
        identity: mockUser.id,
        roomId: 'channel-789',
      });

      await controller.generateToken(createTokenDto, mockRequest);

      const callArgs = (service.generateToken as jest.Mock).mock.calls[0]?.[0];
      expect(callArgs.roomId).toBe('channel-789');
      expect(callArgs.identity).toBe(mockUser.id);
    });

    it('should override provided identity with req.user.id to prevent spoofing', async () => {
      const createTokenDto: CreateTokenDto = {
        roomId: 'channel-123',
        identity: 'spoofed-identity',
        name: 'Custom Name',
      };

      service.generateToken.mockResolvedValue({
        token: 'token',
        identity: mockUser.id,
        roomId: 'channel-123',
      });

      await controller.generateToken(createTokenDto, mockRequest);

      const callArgs = (service.generateToken as jest.Mock).mock.calls[0]?.[0];
      // The controller must always force identity to req.user.id, ignoring dto.identity
      expect(callArgs.identity).toBe(mockUser.id);
      expect(callArgs.identity).not.toBe('spoofed-identity');
    });
  });

  describe('voice publish permissions', () => {
    it('a timed-out member gets a subscribe-only channel token', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue({
        ...allCaps,
        post: false,
        speak: false,
        video: false,
        share: false,
        timedOutUntil: new Date(Date.now() + 60_000),
      });

      await controller.generateToken(
        { roomId: 'room-1', identity: '' },
        mockRequest,
      );

      expect(channelAccessService.channelCapabilities).toHaveBeenCalledWith(
        mockUser.id,
        'room-1',
      );
      expect(service.generateToken).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        { canPublish: false },
      );
    });

    it('a partial voice grant lists only the allowed sources', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue({
        ...allCaps,
        video: false,
        share: false,
      });

      await controller.generateToken(
        { roomId: 'room-1', identity: '' },
        mockRequest,
      );

      expect(service.generateToken).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        { canPublish: true, canPublishSources: [TrackSource.MICROPHONE] },
      );
    });

    it('a missing channel gets nothing to publish', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue(null);

      await controller.generateToken(
        { roomId: 'room-1', identity: '' },
        mockRequest,
      );

      expect(service.generateToken).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        { canPublish: false },
      );
    });

    it('DM calls are never restricted (timeouts are community-scoped)', async () => {
      await controller.generateDmToken(
        { roomId: 'dm-1', identity: '' },
        mockRequest,
      );

      expect(channelAccessService.channelCapabilities).not.toHaveBeenCalled();
      expect(service.generateToken).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        FULL_PUBLISH_GRANT,
      );
    });
  });

  describe('generateDmToken', () => {
    it('should generate LiveKit token for DM call with forced identity', async () => {
      const createTokenDto: CreateTokenDto = {
        roomId: 'dm-group-123',
        identity: 'user-456',
        name: 'Test User',
      };

      const mockTokenResponse = {
        token: 'dm-livekit-token-xyz',
        identity: mockUser.id,
        roomId: 'dm-group-123',
      };

      service.generateToken.mockResolvedValue(mockTokenResponse);

      const result = await controller.generateDmToken(
        createTokenDto,
        mockRequest,
      );

      // Identity should always be forced to req.user.id for DM tokens too
      expect(service.generateToken).toHaveBeenCalledWith(
        {
          ...createTokenDto,
          identity: mockUser.id,
        },
        undefined, // no session: the request carries no access token
        FULL_PUBLISH_GRANT,
      );
      expect(result).toEqual(mockTokenResponse);
    });

    it('should use authenticated user ID as identity when not provided', async () => {
      const createTokenDto: CreateTokenDto = {
        roomId: 'dm-group-456',
        identity: '',
        name: 'DM Participant',
      };

      service.generateToken.mockResolvedValue({
        token: 'dm-token',
        identity: mockUser.id,
        roomId: 'dm-group-456',
      });

      await controller.generateDmToken(createTokenDto, mockRequest);

      const callArgs = (service.generateToken as jest.Mock).mock.calls[0]?.[0];
      expect(callArgs.identity).toBe(mockUser.id);
      expect(callArgs.roomId).toBe('dm-group-456');
    });

    it('should override provided identity with req.user.id in DM tokens', async () => {
      const createTokenDto: CreateTokenDto = {
        roomId: 'dm-group-789',
        identity: 'spoofed-dm-identity',
        name: 'DM User',
      };

      service.generateToken.mockResolvedValue({
        token: 'dm-token',
        identity: mockUser.id,
        roomId: 'dm-group-789',
      });

      await controller.generateDmToken(createTokenDto, mockRequest);

      const callArgs = (service.generateToken as jest.Mock).mock.calls[0]?.[0];
      expect(callArgs.identity).toBe(mockUser.id);
      expect(callArgs.identity).not.toBe('spoofed-dm-identity');
    });
  });

  describe('getConnectionInfo', () => {
    it('should return LiveKit connection information', () => {
      const mockConnectionInfo = {
        url: 'wss://livekit.example.com',
      };

      service.getConnectionInfo.mockReturnValue(mockConnectionInfo);

      const result = controller.getConnectionInfo();

      expect(service.getConnectionInfo).toHaveBeenCalled();
      expect(result).toEqual(mockConnectionInfo);
    });

    it('should call service method without parameters', () => {
      service.getConnectionInfo.mockReturnValue({
        url: 'wss://test.livekit.io',
      });

      controller.getConnectionInfo();

      expect(service.getConnectionInfo).toHaveBeenCalledWith();
    });
  });

  describe('validateConfiguration', () => {
    it('should return healthy status when configuration is valid', () => {
      service.validateConfiguration.mockReturnValue(true);

      const result = controller.validateConfiguration();

      expect(service.validateConfiguration).toHaveBeenCalled();
      expect(result).toEqual({
        status: 'healthy',
        configured: true,
      });
    });

    it('should return unhealthy status when configuration is invalid', () => {
      service.validateConfiguration.mockReturnValue(false);

      const result = controller.validateConfiguration();

      expect(result).toEqual({
        status: 'unhealthy',
        configured: false,
      });
    });

    it('should call service validation method', () => {
      service.validateConfiguration.mockReturnValue(true);

      controller.validateConfiguration();

      expect(service.validateConfiguration).toHaveBeenCalledWith();
    });
  });

  describe('muteParticipant', () => {
    it('should call service muteParticipant and updateServerMuteState, return success', async () => {
      service.muteParticipant.mockResolvedValue(undefined);
      voicePresenceService.updateServerMuteState.mockResolvedValue(undefined);

      const result = await controller.muteParticipant('channel-123', {
        participantIdentity: 'user-456',
        mute: true,
      });

      expect(service.muteParticipant).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        true,
      );
      expect(voicePresenceService.updateServerMuteState).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        true,
      );
      expect(result).toEqual({ success: true });
    });

    it('should pass mute=false for unmute and update server mute state', async () => {
      service.muteParticipant.mockResolvedValue(undefined);
      voicePresenceService.updateServerMuteState.mockResolvedValue(undefined);

      await controller.muteParticipant('channel-123', {
        participantIdentity: 'user-456',
        mute: false,
      });

      expect(service.muteParticipant).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        false,
      );
      expect(voicePresenceService.updateServerMuteState).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        false,
      );
    });

    it('should propagate service errors without calling updateServerMuteState', async () => {
      service.muteParticipant.mockRejectedValue(new Error('Mute failed'));

      await expect(
        controller.muteParticipant('channel-123', {
          participantIdentity: 'user-456',
          mute: true,
        }),
      ).rejects.toThrow('Mute failed');

      expect(voicePresenceService.updateServerMuteState).not.toHaveBeenCalled();
    });
  });
});
