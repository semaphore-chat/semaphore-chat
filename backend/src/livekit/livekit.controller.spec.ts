import {
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
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
import { LivekitReplayService } from './livekit-replay.service';
import { StorageService } from '@/storage/storage.service';
import { StreamReplayDto } from './dto/capture-replay.dto';
import { ThrottlerException } from '@nestjs/throttler';
import { EventEmitter } from 'events';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '@/types';

/** A response whose `sendFile` finishes only when the test says so. */
interface FakeDownloadResponse extends EventEmitter {
  setHeader: jest.Mock;
  sendFile: jest.Mock;
}

function makeDownloadResponse(
  transfer: (done: (err?: Error) => void) => void = (done) => done(),
): FakeDownloadResponse {
  const res = new EventEmitter() as FakeDownloadResponse;
  res.setHeader = jest.fn();
  res.sendFile = jest.fn((_path: string, done: (err?: Error) => void) =>
    transfer(done),
  );
  return res;
}
import { LivekitException } from './exceptions/livekit.exception';

describe('LivekitController', () => {
  let controller: LivekitController;
  let service: Mocked<LivekitService>;
  let voicePresenceService: Mocked<VoicePresenceService>;
  let jwtService: Mocked<JwtService>;
  let channelAccessService: Mocked<ChannelAccessService>;
  let replayService: Mocked<LivekitReplayService>;
  let storageService: Mocked<StorageService>;

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

  const accountName = mockUser.displayName || mockUser.username;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(LivekitController).compile();

    controller = unit;
    service = unitRef.get(LivekitService);
    voicePresenceService = unitRef.get(VoicePresenceService);
    jwtService = unitRef.get(JwtService);
    channelAccessService = unitRef.get(ChannelAccessService);
    replayService = unitRef.get(LivekitReplayService);
    storageService = unitRef.get(StorageService);
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
          { roomId: 'room-1', identity: mockUser.id, name: accountName },
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
        { roomId: 'room-1', identity: mockUser.id, name: accountName },
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
        { roomId: 'room-1', identity: mockUser.id, name: accountName },
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
          name: accountName,
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
        {
          canPublish: true,
          canPublishSources: [TrackSource.MICROPHONE, TrackSource.UNKNOWN],
        },
      );
    });

    it('a room that is not a channel gets no token at all', async () => {
      channelAccessService.channelCapabilities.mockResolvedValue(null);

      await expect(
        controller.generateToken(
          { roomId: 'room-1', identity: '' },
          mockRequest,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(service.generateToken).not.toHaveBeenCalled();
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
          name: accountName,
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
    it('answers 200, matching its @ApiOkResponse', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          LivekitController.prototype.muteParticipant,
        ),
      ).toBe(HttpStatus.OK);
    });

    it('should call service muteParticipant and updateServerMuteState, return success', async () => {
      service.muteParticipant.mockResolvedValue(undefined);
      voicePresenceService.updateServerMuteState.mockResolvedValue(undefined);

      const result = await controller.muteParticipant(
        'channel-123',
        {
          participantIdentity: 'user-456',
          mute: true,
        },
        mockRequest,
      );

      expect(service.muteParticipant).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
      );
      expect(voicePresenceService.updateServerMuteState).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        true,
      );
      expect(result).toEqual({ success: true });
    });

    it('should lift a mute without touching tracks, giving the microphone back', async () => {
      voicePresenceService.updateServerMuteState.mockResolvedValue(undefined);

      await controller.muteParticipant(
        'channel-123',
        {
          participantIdentity: 'user-456',
          mute: false,
        },
        mockRequest,
      );

      expect(service.muteParticipant).not.toHaveBeenCalled();
      expect(voicePresenceService.setServerMuted).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        false,
      );
      expect(service.updatePublishPermissions).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        FULL_PUBLISH_GRANT,
      );
      expect(voicePresenceService.updateServerMuteState).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        false,
      );
      expect(voicePresenceService.updateServerMuteState).toHaveBeenCalledTimes(
        1,
      );
    });

    it('records and announces the change only after LiveKit accepted the grant', async () => {
      voicePresenceService.setServerMuted.mockResolvedValue(undefined);
      voicePresenceService.updateServerMuteState.mockResolvedValue(undefined);

      await controller.muteParticipant(
        'channel-123',
        { participantIdentity: 'user-456', mute: false },
        mockRequest,
      );

      const permissionUpdate =
        service.updatePublishPermissions.mock.invocationCallOrder[0];
      expect(permissionUpdate).toBeLessThan(
        voicePresenceService.setServerMuted.mock.invocationCallOrder[0],
      );
      expect(permissionUpdate).toBeLessThan(
        voicePresenceService.updateServerMuteState.mock.invocationCallOrder[0],
      );
    });

    it('leaves presence alone when LiveKit refuses the permission update', async () => {
      service.updatePublishPermissions.mockRejectedValue(
        new LivekitException('refused', 500),
      );

      await expect(
        controller.muteParticipant(
          'channel-123',
          { participantIdentity: 'user-456', mute: false },
          mockRequest,
        ),
      ).rejects.toBeInstanceOf(LivekitException);

      expect(voicePresenceService.setServerMuted).not.toHaveBeenCalled();
      expect(voicePresenceService.updateServerMuteState).not.toHaveBeenCalled();
    });

    it('lifts a mute after the person left the call: state cleared, success, announced once', async () => {
      service.updatePublishPermissions.mockRejectedValue(
        new LivekitException(
          'Participant is not in this voice channel',
          HttpStatus.NOT_FOUND,
        ),
      );
      voicePresenceService.setServerMuted.mockResolvedValue(undefined);
      voicePresenceService.updateServerMuteState.mockResolvedValue(undefined);

      await expect(
        controller.muteParticipant(
          'channel-123',
          { participantIdentity: 'user-456', mute: false },
          mockRequest,
        ),
      ).resolves.toEqual({ success: true });

      expect(voicePresenceService.setServerMuted).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
        false,
      );
      expect(voicePresenceService.updateServerMuteState).toHaveBeenCalledTimes(
        1,
      );
    });

    it('lifting a mute fails on a real LiveKit error and leaves the state', async () => {
      service.updatePublishPermissions.mockRejectedValue(
        new LivekitException('timeout', HttpStatus.INTERNAL_SERVER_ERROR),
      );

      await expect(
        controller.muteParticipant(
          'channel-123',
          { participantIdentity: 'user-456', mute: false },
          mockRequest,
        ),
      ).rejects.toMatchObject({ status: 500 });

      expect(voicePresenceService.setServerMuted).not.toHaveBeenCalled();
      expect(voicePresenceService.updateServerMuteState).not.toHaveBeenCalled();
    });

    it('applying a mute to someone not in the call still 404s and records nothing', async () => {
      service.muteParticipant.mockRejectedValue(
        new LivekitException(
          'Participant is not in this voice channel',
          HttpStatus.NOT_FOUND,
        ),
      );

      await expect(
        controller.muteParticipant(
          'channel-123',
          { participantIdentity: 'user-456', mute: true },
          mockRequest,
        ),
      ).rejects.toMatchObject({ status: 404 });

      expect(voicePresenceService.setServerMuted).not.toHaveBeenCalled();
      expect(voicePresenceService.updateServerMuteState).not.toHaveBeenCalled();
    });

    it('applying a mute does not swallow a 404 from the permission update', async () => {
      service.updatePublishPermissions.mockRejectedValue(
        new LivekitException('gone', HttpStatus.NOT_FOUND),
      );

      await expect(
        controller.muteParticipant(
          'channel-123',
          { participantIdentity: 'user-456', mute: true },
          mockRequest,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(voicePresenceService.setServerMuted).not.toHaveBeenCalled();
    });

    it('refused by the rank rule, it changes nothing', async () => {
      channelAccessService.assertMayModerateParticipant.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        controller.muteParticipant(
          'channel-123',
          { participantIdentity: 'user-456', mute: true },
          mockRequest,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(
        channelAccessService.assertMayModerateParticipant,
      ).toHaveBeenCalledWith(mockUser, 'channel-123', 'user-456');
      expect(service.muteParticipant).not.toHaveBeenCalled();
      expect(voicePresenceService.setServerMuted).not.toHaveBeenCalled();
      expect(service.updatePublishPermissions).not.toHaveBeenCalled();
    });

    it('should propagate service errors without calling updateServerMuteState', async () => {
      service.muteParticipant.mockRejectedValue(new Error('Mute failed'));

      await expect(
        controller.muteParticipant(
          'channel-123',
          {
            participantIdentity: 'user-456',
            mute: true,
          },
          mockRequest,
        ),
      ).rejects.toThrow('Mute failed');

      expect(voicePresenceService.updateServerMuteState).not.toHaveBeenCalled();
    });
  });

  describe('streamReplay', () => {
    const replayPath = '/tmp/replay-stream-user.mp4';
    const query: StreamReplayDto = { durationMinutes: 1 };
    const reqFor = (userId: string) =>
      ({ user: { id: userId } }) as unknown as AuthenticatedRequest;
    // Lets the handler reach `sendFile` (two already-resolved awaits).
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    beforeEach(() => {
      replayService.streamReplay.mockResolvedValue(replayPath);
      storageService.getFileStats.mockResolvedValue({
        size: 42,
        mtime: new Date(),
        ctime: new Date(),
      });
      storageService.deleteFile.mockResolvedValue(undefined);
    });

    it('answers 429 to a second download while one is in flight', async () => {
      let finish!: (err?: Error) => void;
      const first = controller.streamReplay(
        query,
        reqFor('replay-user-1'),
        makeDownloadResponse((done) => {
          finish = done;
        }) as unknown as Response,
      );
      await flush();

      await expect(
        controller.streamReplay(
          query,
          reqFor('replay-user-1'),
          makeDownloadResponse() as unknown as Response,
        ),
      ).rejects.toBeInstanceOf(ThrottlerException);

      finish();
      await first;

      // The slot is free again once the first download is over.
      await expect(
        controller.streamReplay(
          query,
          reqFor('replay-user-1'),
          makeDownloadResponse() as unknown as Response,
        ),
      ).resolves.toBeUndefined();
      expect(storageService.deleteFile).toHaveBeenCalled();
    });

    it('deletes the temp file after a completed download', async () => {
      await controller.streamReplay(
        query,
        reqFor('replay-user-2'),
        makeDownloadResponse() as unknown as Response,
      );

      expect(storageService.deleteFile).toHaveBeenCalledWith(replayPath);
    });

    it('deletes the temp file when the client aborts', async () => {
      const res = makeDownloadResponse(() => {
        // Never finishes on its own: the client leaves first.
      });
      const running = controller.streamReplay(
        query,
        reqFor('replay-user-3'),
        res as unknown as Response,
      );
      await flush();

      res.emit('close');
      await running;

      expect(storageService.deleteFile).toHaveBeenCalledWith(replayPath);
    });

    it('deletes the temp file when sending it fails', async () => {
      await controller.streamReplay(
        query,
        reqFor('replay-user-4'),
        makeDownloadResponse((done) =>
          done(new Error('gone')),
        ) as unknown as Response,
      );

      expect(storageService.deleteFile).toHaveBeenCalledWith(replayPath);
    });
  });

  describe('removeParticipant', () => {
    it('answers 200, matching its @ApiOkResponse', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          LivekitController.prototype.removeParticipant,
        ),
      ).toBe(HttpStatus.OK);
    });

    it('checks the rank and disconnects the participant from the call', async () => {
      service.disconnectParticipant.mockResolvedValue(undefined);

      const result = await controller.removeParticipant(
        'channel-123',
        { participantIdentity: 'user-456' },
        mockRequest,
      );

      expect(
        channelAccessService.assertMayModerateParticipant,
      ).toHaveBeenCalledWith(mockUser, 'channel-123', 'user-456', 'remove');
      expect(service.disconnectParticipant).toHaveBeenCalledWith(
        'channel-123',
        'user-456',
      );
      expect(result).toEqual({ success: true });
    });

    it('refuses without the rank, without touching LiveKit', async () => {
      channelAccessService.assertMayModerateParticipant.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        controller.removeParticipant(
          'channel-123',
          { participantIdentity: 'user-456' },
          mockRequest,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(service.disconnectParticipant).not.toHaveBeenCalled();
    });

    it('404s a participant who is not in the call', async () => {
      service.disconnectParticipant.mockRejectedValue(
        new LivekitException('Participant is not in this voice channel', 404),
      );

      const error: unknown = await controller
        .removeParticipant(
          'channel-123',
          { participantIdentity: 'user-456' },
          mockRequest,
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LivekitException);
      expect((error as LivekitException).getStatus()).toBe(404);
    });
  });
});
