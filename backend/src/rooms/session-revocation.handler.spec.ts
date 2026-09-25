import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { SessionRevocationHandler } from './session-revocation.handler';
import { WebsocketService } from '@/websocket/websocket.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { LivekitService } from '@/livekit/livekit.service';

describe('SessionRevocationHandler', () => {
  let handler: SessionRevocationHandler;
  let websocketService: Mocked<WebsocketService>;
  let voicePresenceService: Mocked<VoicePresenceService>;
  let livekitService: Mocked<LivekitService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      SessionRevocationHandler,
    ).compile();

    handler = unit;
    websocketService = unitRef.get(WebsocketService);
    voicePresenceService = unitRef.get(VoicePresenceService);
    livekitService = unitRef.get(LivekitService);
    voicePresenceService.getUserVoiceChannels.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onSessionsRevoked', () => {
    it("ends the sockets of each session and token, not the user's others", () => {
      handler.onSessionsRevoked({
        userId: 'user-1',
        sessionIds: ['s-1', 's-2'],
        tokenIds: ['jti-1'],
        reason: 'LOGGED_OUT',
      });

      expect(websocketService.terminateSessionsInRoom.mock.calls).toEqual([
        ['session:s-1', 'LOGGED_OUT'],
        ['session:s-2', 'LOGGED_OUT'],
        ['token:jti-1', 'LOGGED_OUT'],
      ]);
    });
  });

  describe('onUserSessionsEnded', () => {
    it('ends all sockets of the user', async () => {
      await handler.onUserSessionsEnded({
        userId: 'user-1',
        reason: 'PASSWORD_CHANGED',
      });

      expect(websocketService.terminateSessionsInRoom).toHaveBeenCalledWith(
        'user:user-1',
        'PASSWORD_CHANGED',
      );
      // Still the same person: voice stays
      expect(voicePresenceService.getUserVoiceChannels).not.toHaveBeenCalled();
    });

    it.each(['ACCOUNT_BANNED', 'ACCOUNT_DELETED'] as const)(
      'takes the user out of their voice channels (%s)',
      async (reason) => {
        voicePresenceService.getUserVoiceChannels.mockResolvedValue([
          'voice-1',
          'voice-2',
        ]);

        await handler.onUserSessionsEnded({ userId: 'user-1', reason });

        expect(livekitService.removeParticipant).toHaveBeenCalledWith(
          'voice-1',
          'user-1',
        );
        expect(livekitService.removeParticipant).toHaveBeenCalledWith(
          'voice-2',
          'user-1',
        );
        expect(voicePresenceService.leaveVoiceChannel).toHaveBeenCalledWith(
          'voice-1',
          'user-1',
        );
      },
    );

    it('never throws when voice cleanup fails', async () => {
      voicePresenceService.getUserVoiceChannels.mockRejectedValue(
        new Error('Redis down'),
      );

      await expect(
        handler.onUserSessionsEnded({
          userId: 'user-1',
          reason: 'ACCOUNT_BANNED',
        }),
      ).resolves.toBeUndefined();
      expect(websocketService.terminateSessionsInRoom).toHaveBeenCalled();
    });
  });
});
