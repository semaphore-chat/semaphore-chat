import { Injectable, Inject, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from 'livekit-server-sdk';
import { CreateTokenDto } from './dto/create-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { LivekitException } from './exceptions/livekit.exception';
import { ROOM_SERVICE_CLIENT } from './providers/room-service.provider';
import {
  LIVEKIT_ISSUED_AT_ATTRIBUTE,
  signIssuedAt,
} from './livekit-token-issued-at.util';

@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(ROOM_SERVICE_CLIENT)
    private readonly roomServiceClient: RoomServiceClient | null,
  ) {}

  async generateToken(
    createTokenDto: CreateTokenDto,
  ): Promise<TokenResponseDto> {
    const { identity, roomId, name, ttl } = createTokenDto;

    const apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');
    const livekitUrl = this.configService.get<string>('LIVEKIT_URL');

    if (!apiKey || !apiSecret) {
      this.logger.error('LiveKit API key or secret not configured');
      throw new LivekitException(
        'LiveKit credentials not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const tokenTtl = ttl || 3600; // Default to 1 hour
      const token = new AccessToken(apiKey, apiSecret, {
        identity,
        name: name || identity,
        ttl: tokenTtl,
        // Signed issue time, checked by the participant_joined webhook
        // (LivekitAccessService) against the user's revocation cutoff
        attributes: {
          [LIVEKIT_ISSUED_AT_ATTRIBUTE]: signIssuedAt(
            apiSecret,
            identity,
            Date.now(),
          ),
        },
      });

      // Grant permissions for the room
      token.addGrant({
        room: roomId,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        // Allow participants to update their own metadata (for isDeafened
        // state). This also lets them rewrite their attributes, which is why
        // the issue-time attribute above is signed.
        canUpdateOwnMetadata: true,
      });

      const jwt = await token.toJwt();

      this.logger.log(`Generated token for user ${identity} in room ${roomId}`);

      const response: TokenResponseDto = {
        token: jwt,
        identity,
        roomId,
        url: livekitUrl,
        expiresAt: new Date(Date.now() + tokenTtl * 1000),
      };

      return response;
    } catch (error) {
      this.logger.error('Failed to generate LiveKit token', error);
      throw new LivekitException(
        'Failed to generate token',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get LiveKit server connection information
   */
  getConnectionInfo(): { url?: string } {
    const livekitUrl = this.configService.get<string>('LIVEKIT_URL');
    return { url: livekitUrl };
  }

  /**
   * Validate LiveKit configuration
   */
  validateConfiguration(): boolean {
    const apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');
    const livekitUrl = this.configService.get<string>('LIVEKIT_URL');

    if (!apiKey || !apiSecret || !livekitUrl) {
      this.logger.warn('LiveKit configuration incomplete');
      return false;
    }

    this.logger.log('LiveKit configuration validated successfully');
    return true;
  }

  /**
   * Remove a participant from a LiveKit room.
   * Errors are swallowed — the caller (e.g. ban/kick) must succeed regardless of LiveKit state.
   */
  async removeParticipant(
    roomId: string,
    participantIdentity: string,
  ): Promise<void> {
    if (!this.roomServiceClient) {
      this.logger.warn(
        'LiveKit credentials not configured, cannot remove participant',
      );
      return;
    }

    try {
      await this.roomServiceClient.removeParticipant(
        roomId,
        participantIdentity,
      );
      this.logger.log(
        `Removed participant ${participantIdentity} from room ${roomId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to remove participant ${participantIdentity} from room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The LiveKit rooms a participant identity is currently in, asked of
   * LiveKit itself (every room, then its participants), so it also finds
   * rooms no presence index knows about (e.g. DM calls whose presence
   * expired). Best effort: rooms that can't be listed are skipped, and an
   * unreachable or unconfigured LiveKit yields [].
   */
  async listParticipantRooms(participantIdentity: string): Promise<string[]> {
    const client = this.roomServiceClient;
    if (!client) return [];

    try {
      const rooms = await client.listRooms();
      const results = await Promise.allSettled(
        rooms.map(async (room) => {
          const participants = await client.listParticipants(room.name);
          return participants.some((p) => p.identity === participantIdentity)
            ? room.name
            : null;
        }),
      );
      const roomNames: string[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value) roomNames.push(result.value);
        } else {
          this.logger.warn(
            `Failed to list participants of a LiveKit room: ${String(result.reason)}`,
          );
        }
      }
      return roomNames;
    } catch (error) {
      this.logger.warn(
        `Failed to list LiveKit rooms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * Mute or unmute a participant's audio tracks in a room
   */
  async muteParticipant(
    roomId: string,
    participantIdentity: string,
    mute: boolean,
  ): Promise<void> {
    if (!this.roomServiceClient) {
      throw new LivekitException(
        'LiveKit credentials not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const participant = await this.roomServiceClient.getParticipant(
        roomId,
        participantIdentity,
      );

      for (const track of participant.tracks) {
        if (track.source === TrackSource.MICROPHONE) {
          await this.roomServiceClient.mutePublishedTrack(
            roomId,
            participantIdentity,
            track.sid,
            mute,
          );
        }
      }

      this.logger.log(
        `${mute ? 'Muted' : 'Unmuted'} participant ${participantIdentity} in room ${roomId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to ${mute ? 'mute' : 'unmute'} participant ${participantIdentity} in room ${roomId}`,
        error,
      );
      throw new LivekitException(
        `Failed to ${mute ? 'mute' : 'unmute'} participant`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
