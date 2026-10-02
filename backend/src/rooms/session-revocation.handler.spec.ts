import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { SessionRevocationHandler } from './session-revocation.handler';
import { WebsocketService } from '@/websocket/websocket.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { LivekitService } from '@/livekit/livekit.service';
import { LivekitAccessService } from '@/livekit/livekit-access.service';

describe('SessionRevocationHandler', () => {
  let handler: SessionRevocationHandler;
  let websocketService: Mocked<WebsocketService>;
  let voicePresenceService: Mocked<VoicePresenceService>;
  let livekitService: Mocked<LivekitService>;
  let livekitAccessService: Mocked<LivekitAccessService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      SessionRevocationHandler,
    ).compile();

    handler = unit;
    websocketService = unitRef.get(WebsocketService);
    voicePresenceService = unitRef.get(VoicePresenceService);
    livekitService = unitRef.get(LivekitService);
    livekitAccessService = unitRef.get(LivekitAccessService);
    voicePresenceService.getUserVoiceChannels.mockResolvedValue([]);
    voicePresenceService.getUserDmVoiceCalls.mockResolvedValue([]);
    livekitService.listParticipantRooms.mockResolvedValue([]);
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

    it.each(['LOGGED_OUT', 'SESSION_REVOKED'] as const)(
      "leaves voice alone on %s (the LiveKit identity is the user's, not the session's)",
      (reason) => {
        handler.onSessionsRevoked({
          userId: 'user-1',
          sessionIds: ['s-1'],
          tokenIds: [],
          reason,
        });

        expect(
          livekitAccessService.revokeTokensIssuedBefore,
        ).not.toHaveBeenCalled();
        expect(livekitService.listParticipantRooms).not.toHaveBeenCalled();
        expect(livekitService.removeParticipant).not.toHaveBeenCalled();
        expect(voicePresenceService.leaveVoiceChannel).not.toHaveBeenCalled();
        expect(voicePresenceService.leaveDmVoice).not.toHaveBeenCalled();
      },
    );
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
    });

    it.each(['ACCOUNT_BANNED', 'ACCOUNT_DELETED', 'PASSWORD_CHANGED'] as const)(
      'revokes LiveKit tokens and removes the user from every voice room, DM calls included (%s)',
      async (reason) => {
        // LiveKit knows a DM call presence lost; presence knows a channel
        // LiveKit can't list right now
        livekitService.listParticipantRooms.mockResolvedValue([
          'voice-1',
          'dm-expired',
        ]);
        voicePresenceService.getUserVoiceChannels.mockResolvedValue([
          'voice-1',
          'voice-2',
        ]);
        voicePresenceService.getUserDmVoiceCalls.mockResolvedValue(['dm-1']);

        await handler.onUserSessionsEnded({ userId: 'user-1', reason });

        expect(
          livekitAccessService.revokeTokensIssuedBefore,
        ).toHaveBeenCalledWith('user-1');
        const removed = livekitService.removeParticipant.mock.calls;
        expect(removed).toHaveLength(4);
        expect(removed).toEqual(
          expect.arrayContaining([
            ['voice-1', 'user-1'],
            ['voice-2', 'user-1'],
            ['dm-1', 'user-1'],
            ['dm-expired', 'user-1'],
          ]),
        );
        expect(voicePresenceService.leaveVoiceChannel.mock.calls).toEqual([
          ['voice-1', 'user-1'],
          ['voice-2', 'user-1'],
        ]);
        expect(voicePresenceService.leaveDmVoice.mock.calls).toEqual([
          ['dm-1', 'user-1'],
        ]);
      },
    );

    it('sets the token cutoff before removing the user', async () => {
      livekitService.listParticipantRooms.mockResolvedValue(['voice-1']);

      await handler.onUserSessionsEnded({
        userId: 'user-1',
        reason: 'PASSWORD_CHANGED',
      });

      expect(
        livekitAccessService.revokeTokensIssuedBefore.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        livekitService.removeParticipant.mock.invocationCallOrder[0],
      );
    });

    it('still removes the user when the token cutoff fails', async () => {
      livekitAccessService.revokeTokensIssuedBefore.mockRejectedValue(
        new Error('Redis down'),
      );
      livekitService.listParticipantRooms.mockResolvedValue(['dm-1']);

      await handler.onUserSessionsEnded({
        userId: 'user-1',
        reason: 'ACCOUNT_BANNED',
      });

      expect(livekitService.removeParticipant).toHaveBeenCalledWith(
        'dm-1',
        'user-1',
      );
    });

    it('keeps going when a removal or presence cleanup fails', async () => {
      voicePresenceService.getUserVoiceChannels.mockResolvedValue(['voice-1']);
      voicePresenceService.getUserDmVoiceCalls.mockResolvedValue(['dm-1']);
      livekitService.removeParticipant.mockRejectedValue(
        new Error('LiveKit down'),
      );
      voicePresenceService.leaveVoiceChannel.mockRejectedValue(
        new Error('Redis down'),
      );

      await expect(
        handler.onUserSessionsEnded({
          userId: 'user-1',
          reason: 'ACCOUNT_DELETED',
        }),
      ).resolves.toBeUndefined();
      expect(voicePresenceService.leaveDmVoice).toHaveBeenCalledWith(
        'dm-1',
        'user-1',
      );
    });

    it('never throws when voice cleanup fails', async () => {
      livekitService.listParticipantRooms.mockRejectedValue(
        new Error('LiveKit down'),
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
