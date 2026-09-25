import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebsocketService } from '@/websocket/websocket.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { LivekitService } from '@/livekit/livekit.service';
import { RoomName } from '@/common/utils/room-name.util';
import {
  AuthSessionsRevokedEvent,
  AuthUserSessionsEndedEvent,
  RoomEvents,
} from './room-subscription.events';

/**
 * Disconnects the sockets of revoked sessions (SessionRevocationService's
 * domain events). Every socket joins `user:<id>`, `session:<sid>` and
 * `token:<jti>` when it connects (SocketSessionService), and the Socket.IO
 * Redis adapter carries `disconnectSockets()` to every instance.
 */
@Injectable()
export class SessionRevocationHandler {
  private readonly logger = new Logger(SessionRevocationHandler.name);

  constructor(
    private readonly websocketService: WebsocketService,
    private readonly voicePresenceService: VoicePresenceService,
    private readonly livekitService: LivekitService,
  ) {}

  @OnEvent(RoomEvents.AUTH_SESSIONS_REVOKED)
  onSessionsRevoked({
    userId,
    sessionIds,
    tokenIds,
    reason,
  }: AuthSessionsRevokedEvent): void {
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

    // The account can't sign in any more: take it out of voice too.
    if (reason === 'ACCOUNT_BANNED' || reason === 'ACCOUNT_DELETED') {
      await this.removeFromVoiceChannels(userId);
    }
  }

  /**
   * Remove the user from every voice channel they are in (LiveKit session and
   * voice presence). Best effort: logged, never thrown. DM calls are not
   * covered (no per-user index of them), and LiveKit tokens can't be revoked,
   * so a client could rejoin a room until its LiveKit token expires.
   */
  private async removeFromVoiceChannels(userId: string): Promise<void> {
    try {
      const channelIds =
        await this.voicePresenceService.getUserVoiceChannels(userId);
      await Promise.allSettled(
        channelIds.map((channelId) =>
          Promise.allSettled([
            this.livekitService.removeParticipant(channelId, userId),
            this.voicePresenceService.leaveVoiceChannel(channelId, userId),
          ]),
        ),
      );
      if (channelIds.length > 0) {
        this.logger.log(
          `Removed user ${userId} from ${channelIds.length} voice channel(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to remove user ${userId} from voice channels`,
        error,
      );
    }
  }
}
