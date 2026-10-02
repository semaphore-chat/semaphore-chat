import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebsocketService } from '@/websocket/websocket.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { LivekitService } from '@/livekit/livekit.service';
import { LivekitAccessService } from '@/livekit/livekit-access.service';
import type { SessionTerminatedReason } from '@semaphore-chat/shared';
import { RoomName } from '@/common/utils/room-name.util';
import {
  AuthSessionsRevokedEvent,
  AuthUserSessionsEndedEvent,
  RoomEvents,
} from './room-subscription.events';

/**
 * Reasons that end the user's voice access (SessionRevocationHandler
 * .onUserSessionsEnded). A password reset uses PASSWORD_CHANGED as well.
 */
const VOICE_REVOKING_REASONS: ReadonlySet<SessionTerminatedReason> = new Set([
  'ACCOUNT_BANNED',
  'ACCOUNT_DELETED',
  'PASSWORD_CHANGED',
]);

/**
 * Disconnects the sockets of revoked sessions (SessionRevocationService's
 * domain events). Every socket joins `user:<id>`, `session:<sid>` and
 * `token:<jti>` when it connects (SocketSessionService), and the Socket.IO
 * Redis adapter carries `disconnectSockets()` to every instance. Revoked
 * sessions also leave voice (revokeSessionsVoice); credential
 * changes, bans and deletions end all of the user's voice (revokeVoiceAccess).
 */
@Injectable()
export class SessionRevocationHandler {
  private readonly logger = new Logger(SessionRevocationHandler.name);

  constructor(
    private readonly websocketService: WebsocketService,
    private readonly voicePresenceService: VoicePresenceService,
    private readonly livekitService: LivekitService,
    private readonly livekitAccessService: LivekitAccessService,
  ) {}

  /**
   * Logout and single-session revocation (LOGGED_OUT, SESSION_REVOKED, or
   * any other reason this event carries) end the revoked sessions' sockets
   * and their voice: only the LiveKit participants whose token was issued to
   * one of those sessions are removed (revokeSessionsVoice), so the user's
   * other devices stay in their calls.
   */
  @OnEvent(RoomEvents.AUTH_SESSIONS_REVOKED)
  async onSessionsRevoked({
    userId,
    sessionIds,
    tokenIds,
    reason,
  }: AuthSessionsRevokedEvent): Promise<void> {
    for (const sessionId of sessionIds) {
      this.websocketService.terminateSessionsInRoom(
        RoomName.session(sessionId),
        reason,
      );
    }
    for (const jti of tokenIds) {
      this.websocketService.terminateSessionsInRoom(
        RoomName.accessToken(jti),
        reason,
      );
    }
    this.logger.debug(
      `Disconnected sockets of ${sessionIds.length} session(s) and ${tokenIds.length} token(s) of user ${userId} (${reason})`,
    );

    // LiveKit tokens are bound to sessions, not access tokens: tokenIds
    // (access tokens without a session) have no participant to find
    if (sessionIds.length > 0) {
      await this.revokeSessionsVoice(userId, sessionIds, reason);
    }
  }

  /**
   * Remove the user's LiveKit participants that joined with a token issued
   * to one of the revoked sessions (its signed session attribute, see
   * LivekitAccessService.sessionOf), and drop their voice presence in those
   * rooms. Participants of the user's other sessions, and those whose token
   * records no session (issued before sessions were recorded), stay. The
   * participant_joined webhook removes a later rejoin with such a token.
   * Best effort: logged, never thrown.
   */
  private async revokeSessionsVoice(
    userId: string,
    sessionIds: string[],
    reason: SessionTerminatedReason,
  ): Promise<void> {
    try {
      const revoked = new Set(sessionIds);
      const rooms = await this.livekitService.listParticipantRooms(userId);
      const roomNames = rooms
        .filter(({ attributes }) => {
          const sessionId = this.livekitAccessService.sessionOf(
            userId,
            attributes,
          );
          return sessionId !== null && revoked.has(sessionId);
        })
        .map(({ roomName }) => roomName);

      await Promise.allSettled(
        roomNames.map(async (roomName) => {
          await this.livekitService.removeParticipant(roomName, userId);
          // Channel or DM call, whichever the room is
          await this.voicePresenceService.handleWebhookParticipantLeft(
            roomName,
            userId,
          );
        }),
      );

      if (roomNames.length > 0) {
        this.logger.log(
          `Removed user ${userId} from ${roomNames.length} voice room(s) of revoked session(s) (${reason})`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to end the voice of revoked sessions of user ${userId}`,
        error,
      );
    }
  }

  @OnEvent(RoomEvents.AUTH_USER_SESSIONS_ENDED)
  async onUserSessionsEnded({
    userId,
    reason,
  }: AuthUserSessionsEndedEvent): Promise<void> {
    this.websocketService.terminateSessionsInRoom(
      RoomName.user(userId),
      reason,
    );
    this.logger.debug(`Disconnected all sockets of user ${userId} (${reason})`);

    // The account can't sign in any more, or its credentials changed (a
    // reset after a compromise must not leave an attacker in a call): take
    // it out of voice too.
    if (VOICE_REVOKING_REASONS.has(reason)) {
      await this.revokeVoiceAccess(userId, reason);
    }
  }

  /**
   * End the user's voice access: reject the LiveKit tokens they hold (the
   * participant_joined webhook removes a rejoin with one of them, see
   * LivekitAccessService), then remove them from every LiveKit room they are
   * in, community voice channels and DM calls alike, and drop their voice
   * presence so no client shows a ghost.
   *
   * The rooms come from LiveKit itself (the source of truth, which also
   * covers calls whose presence entry expired) merged with the voice
   * presence index (in case LiveKit can't be listed right now). Best effort:
   * logged, never thrown.
   */
  private async revokeVoiceAccess(
    userId: string,
    reason: SessionTerminatedReason,
  ): Promise<void> {
    try {
      // Cutoff first, so a rejoin racing the removal below is caught
      try {
        await this.livekitAccessService.revokeTokensIssuedBefore(userId);
      } catch (error) {
        this.logger.error(
          `Failed to revoke the LiveKit tokens of user ${userId}`,
          error,
        );
      }

      const [livekitRooms, channelIds, dmGroupIds] = await Promise.all([
        this.livekitService.listParticipantRooms(userId),
        this.voicePresenceService.getUserVoiceChannels(userId),
        this.voicePresenceService.getUserDmVoiceCalls(userId),
      ]);
      const rooms = new Set([
        ...livekitRooms.map(({ roomName }) => roomName),
        ...channelIds,
        ...dmGroupIds,
      ]);

      await Promise.allSettled([
        ...[...rooms].map((room) =>
          this.livekitService.removeParticipant(room, userId),
        ),
        ...channelIds.map((channelId) =>
          this.voicePresenceService.leaveVoiceChannel(channelId, userId),
        ),
        ...dmGroupIds.map((dmGroupId) =>
          this.voicePresenceService.leaveDmVoice(dmGroupId, userId),
        ),
      ]);

      if (rooms.size > 0) {
        this.logger.log(
          `Removed user ${userId} from ${rooms.size} voice room(s) (${reason})`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to remove user ${userId} from voice rooms`,
        error,
      );
    }
  }
}
