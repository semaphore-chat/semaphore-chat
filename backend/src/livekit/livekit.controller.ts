import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  UseGuards,
  Req,
  Res,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { LivekitService } from './livekit.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { LivekitAccessService } from './livekit-access.service';
import { DatabaseService } from '@/database/database.service';
import { assertNotBlockedInDm } from '@/common/utils/user-block.utils';
import { FULL_PUBLISH_GRANT, publishGrantFor } from './publish-grant.util';
import { LivekitReplayService } from './livekit-replay.service';
import { ClipLibraryService } from './clip-library.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { CreateTokenDto } from './dto/create-token.dto';
import { MuteParticipantDto } from './dto/mute-participant.dto';
import { RemoveParticipantDto } from './dto/remove-participant.dto';
import { StartReplayBufferDto } from './dto/start-replay-buffer.dto';
import {
  CaptureReplayDto,
  StreamReplayDto,
  SessionInfoResponseDto,
  CaptureReplayResponseDto,
} from './dto/capture-replay.dto';
import {
  UpdateClipDto,
  ShareClipDto,
  ClipResponseDto,
  ShareClipResponseDto,
} from './dto/clip-library.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import {
  ConnectionInfoResponseDto,
  LivekitHealthResponseDto,
  StartReplayResponseDto,
  StopReplayResponseDto,
} from './dto/livekit-response.dto';
import { StorageService } from '@/storage/storage.service';
import { SuccessResponseDto } from '@/common/dto/common-response.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { AuthenticatedRequest } from '@/types';
import { JwtService } from '@nestjs/jwt';
import { extractAccessToken } from '@/auth/access-token-extractor';
import type { AccessTokenClaims } from '@/auth/token-blacklist.service';

@Controller('livekit')
@UseGuards(JwtAuthGuard, RbacGuard)
export class LivekitController {
  private readonly logger = new Logger(LivekitController.name);

  constructor(
    private readonly livekitService: LivekitService,
    private readonly livekitReplayService: LivekitReplayService,
    private readonly clipLibraryService: ClipLibraryService,
    private readonly storageService: StorageService,
    private readonly voicePresenceService: VoicePresenceService,
    private readonly jwtService: JwtService,
    private readonly channelAccessService: ChannelAccessService,
    private readonly livekitAccessService: LivekitAccessService,
    private readonly databaseService: DatabaseService,
  ) {}

  /**
   * The participant in a token is who's asking, with their account's name.
   * Neither comes from the request: other participants see that name on their
   * tile, so a client-chosen one could pose as anybody.
   */
  private participantOf(dto: CreateTokenDto, req: AuthenticatedRequest) {
    return {
      ...dto,
      identity: req.user.id,
      name: req.user.displayName || req.user.username,
    };
  }

  /**
   * The auth session (`sid`) of the access token JwtAuthGuard authenticated
   * this request with: the same token (same extractor), already verified, so
   * decoding it is enough. Undefined for tokens without a session.
   */
  private sessionIdOf(req: AuthenticatedRequest): string | undefined {
    const token = extractAccessToken(req);
    if (!token) return undefined;
    const claims = this.jwtService.decode<AccessTokenClaims | null>(token);
    return typeof claims?.sid === 'string' ? claims.sid : undefined;
  }

  @Post('token')
  @RequiredActions(RbacActions.JOIN_CHANNEL)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'roomId',
    source: ResourceIdSource.BODY,
  })
  @ApiCreatedResponse({ type: TokenResponseDto })
  async generateToken(
    @Body() createTokenDto: CreateTokenDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TokenResponseDto> {
    const tokenDto = this.participantOf(createTokenDto, req);
    // What they may publish follows their channel voice capabilities
    // (SPEAK/VIDEO/SCREEN_SHARE overwrites, community timeouts) and any
    // server mute a moderator set
    const caps = await this.channelAccessService.channelCapabilities(
      req.user.id,
      createTokenDto.roomId,
    );
    // No such channel: only an instance owner gets here (the guard stops
    // everyone else), and a DM id is what dm-token and its membership check
    // are for.
    if (!caps) throw new NotFoundException('Channel not found');
    return this.livekitService.generateToken(
      tokenDto,
      this.sessionIdOf(req),
      publishGrantFor(
        caps,
        await this.voicePresenceService.isServerMuted(
          createTokenDto.roomId,
          req.user.id,
        ),
      ),
    );
  }

  @Post('dm-token')
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.DM_GROUP,
    idKey: 'roomId',
    source: ResourceIdSource.BODY,
  })
  @ApiCreatedResponse({ type: TokenResponseDto })
  async generateDmToken(
    @Body() createTokenDto: CreateTokenDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TokenResponseDto> {
    // The guard lets instance owners through; a DM call is for its members
    await this.livekitAccessService.assertDmMember(
      req.user.id,
      createTokenDto.roomId,
    );
    await assertNotBlockedInDm(
      this.databaseService,
      req.user.id,
      createTokenDto.roomId,
    );
    const tokenDto = this.participantOf(createTokenDto, req);
    // DM calls: timeouts are community-scoped, so DMs publish freely
    return this.livekitService.generateToken(
      tokenDto,
      this.sessionIdOf(req),
      FULL_PUBLISH_GRANT,
    );
  }

  @Post('channels/:channelId/mute-participant')
  @HttpCode(HttpStatus.OK)
  @RequiredActions(RbacActions.MUTE_PARTICIPANT)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  async muteParticipant(
    @Param('channelId') channelId: string,
    @Body() dto: MuteParticipantDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.channelAccessService.assertMayModerateParticipant(
      req.user,
      channelId,
      dto.participantIdentity,
    );

    // Lifting a mute never touches tracks: LiveKit won't turn someone's mic back
    // on for them, and they may have left since (a mute outlives the call). It
    // gives the microphone back; the user unmutes when they want to.
    if (dto.mute) {
      await this.livekitService.muteParticipant(
        channelId,
        dto.participantIdentity,
      );
    }

    // Muting the track alone doesn't hold: the client can unmute it, or
    // publish a new one. The mute also takes the microphone out of what they
    // may publish, now and on every later join — and lifting it gives the
    // microphone back. Only once LiveKit accepted the new grant do we record
    // and announce the change.
    const caps = await this.channelAccessService.channelCapabilities(
      dto.participantIdentity,
      channelId,
    );
    await this.livekitService.updatePublishPermissions(
      channelId,
      dto.participantIdentity,
      caps ? publishGrantFor(caps, dto.mute) : { canPublish: false },
    );
    await this.voicePresenceService.setServerMuted(
      channelId,
      dto.participantIdentity,
      dto.mute,
    );
    await this.voicePresenceService.updateServerMuteState(
      channelId,
      dto.participantIdentity,
      dto.mute,
    );
    return { success: true };
  }

  /**
   * Remove someone from this voice call only: they leave the LiveKit room but
   * stay a community member, and may rejoin. The participant_left webhook
   * announces the leave and clears their presence.
   */
  @Post('channels/:channelId/remove-participant')
  @HttpCode(HttpStatus.OK)
  @RequiredActions(RbacActions.MUTE_PARTICIPANT)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  async removeParticipant(
    @Param('channelId') channelId: string,
    @Body() dto: RemoveParticipantDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.channelAccessService.assertMayModerateParticipant(
      req.user,
      channelId,
      dto.participantIdentity,
      'remove',
    );
    await this.livekitService.disconnectParticipant(
      channelId,
      dto.participantIdentity,
    );
    return { success: true };
  }

  @Get('connection-info')
  @ApiOkResponse({ type: ConnectionInfoResponseDto })
  getConnectionInfo(): ConnectionInfoResponseDto {
    return this.livekitService.getConnectionInfo();
  }

  @Get('health')
  @ApiOkResponse({ type: LivekitHealthResponseDto })
  validateConfiguration(): LivekitHealthResponseDto {
    const isValid = this.livekitService.validateConfiguration();
    return {
      status: isValid ? 'healthy' : 'unhealthy',
      configured: isValid,
    };
  }

  /**
   * Start replay buffer egress for screen share
   */
  @Post('replay/start')
  @RequiredActions(RbacActions.JOIN_CHANNEL, RbacActions.CAPTURE_REPLAY)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.BODY,
  })
  @ApiCreatedResponse({ type: StartReplayResponseDto })
  async startReplayBuffer(
    @Body() dto: StartReplayBufferDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StartReplayResponseDto> {
    return this.livekitReplayService.startReplayBuffer({
      userId: req.user.id,
      channelId: dto.channelId,
      videoTrackId: dto.videoTrackId,
      audioTrackId: dto.audioTrackId,
    });
  }

  /**
   * Stop replay buffer egress for current user
   */
  @Post('replay/stop')
  @ApiCreatedResponse({ type: StopReplayResponseDto })
  async stopReplayBuffer(
    @Req() req: AuthenticatedRequest,
  ): Promise<StopReplayResponseDto> {
    return this.livekitReplayService.stopReplayBuffer(req.user.id);
  }

  /**
   * Stream a replay clip directly (download-only, no persistence)
   * Creates a temporary file, streams it, and deletes it after streaming completes
   */
  @Get('replay/stream')
  @ApiOkResponse({
    description: 'MP4 replay clip download',
    content: {
      'video/mp4': { schema: { type: 'string', format: 'binary' } },
    },
  })
  async streamReplay(
    @Query() query: StreamReplayDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    let tempPath: string | null = null;

    try {
      // Create temp file with concatenated segments
      tempPath = await this.livekitReplayService.streamReplay(
        req.user.id,
        query.durationMinutes,
      );

      // Get file stats for content-length header
      const stats = await this.storageService.getFileStats(tempPath);

      // Set headers for file download
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="replay-${Date.now()}.mp4"`,
      );
      res.setHeader('Content-Length', stats.size);

      // Stream the file and delete after completion
      res.sendFile(tempPath, (err) => {
        // Clean up temp file after streaming (success or failure)
        if (tempPath) {
          this.storageService.deleteFile(tempPath).catch((cleanupError) => {
            // Log but don't throw - file might already be deleted
            this.logger.error('Failed to cleanup temp file:', cleanupError);
          });
        }

        // If there was an error streaming, log it
        if (err) {
          this.logger.error('Error streaming replay file:', err);
        }
      });
    } catch (error) {
      // If error before streaming started, clean up temp file
      if (tempPath) {
        try {
          await this.storageService.deleteFile(tempPath);
        } catch (cleanupError) {
          this.logger.error(
            'Failed to cleanup temp file after error:',
            cleanupError,
          );
        }
      }
      throw error;
    }
  }

  /**
   * Get session info for active replay buffer (for trim UI)
   */
  @Get('replay/session-info')
  @ApiOkResponse({ type: SessionInfoResponseDto })
  async getSessionInfo(
    @Req() req: AuthenticatedRequest,
  ): Promise<SessionInfoResponseDto> {
    return this.livekitReplayService.getSessionInfo(req.user.id);
  }

  /**
   * Serve HLS playlist (m3u8) for preview
   * Returns the playlist file for the user's active session
   */
  @Get('replay/preview/playlist.m3u8')
  @ApiOkResponse({
    description: 'HLS playlist (m3u8) for the active preview session',
    content: {
      'application/vnd.apple.mpegurl': { schema: { type: 'string' } },
    },
  })
  async getPreviewPlaylist(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const playlist = await this.livekitReplayService.getPlaylistContent(
      req.user.id,
    );

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(playlist);
  }

  /**
   * Serve individual HLS segment (.ts file) for preview
   * Segments are remuxed on-the-fly to standard MPEG-TS format
   * for HLS.js compatibility (LiveKit egress creates HDMV-style TS)
   */
  @Get('replay/preview/segment/:segmentFile')
  @ApiOkResponse({
    description: 'Remuxed MPEG-TS segment',
    content: {
      'video/mp2t': { schema: { type: 'string', format: 'binary' } },
    },
  })
  async getPreviewSegment(
    @Param('segmentFile') segmentFile: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    // Get remuxed segment path (with caching)
    const segmentPath = await this.livekitReplayService.getRemuxedSegmentPath(
      req.user.id,
      segmentFile,
    );

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'max-age=86400'); // Segments are immutable
    res.sendFile(segmentPath, (err) => {
      if (err) {
        this.logger.error(`Error serving segment ${segmentFile}:`, err);
        if (!res.headersSent) {
          res.status(500).send('Error serving segment');
        }
      }
    });
  }

  /**
   * Capture a replay clip from the buffer and post to channel or DM
   * Rate limited: 3 per minute, 15 per hour to prevent abuse
   */
  @Post('replay/capture')
  @Throttle({
    short: { limit: 3, ttl: 60000 }, // 3 per minute
    long: { limit: 15, ttl: 3600000 }, // 15 per hour
  })
  @ApiCreatedResponse({ type: CaptureReplayResponseDto })
  async captureReplay(
    @Body() dto: CaptureReplayDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CaptureReplayResponseDto> {
    return this.livekitReplayService.captureReplay(req.user.id, dto);
  }

  /**
   * Get current user's clip library
   */
  @Get('clips')
  @ApiOkResponse({ type: [ClipResponseDto] })
  async getMyClips(
    @Req() req: AuthenticatedRequest,
  ): Promise<ClipResponseDto[]> {
    return this.clipLibraryService.getUserClips(req.user.id);
  }

  /**
   * Get public clips for a specific user (for profile viewing)
   */
  @Get('clips/user/:userId')
  @ApiOkResponse({ type: [ClipResponseDto] })
  async getUserPublicClips(
    @Param('userId') userId: string,
  ): Promise<ClipResponseDto[]> {
    return this.clipLibraryService.getPublicClips(userId);
  }

  /**
   * Update a clip (e.g., toggle public visibility)
   */
  @Put('clips/:clipId')
  @ApiOkResponse({ type: ClipResponseDto })
  async updateClip(
    @Param('clipId') clipId: string,
    @Body() dto: UpdateClipDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ClipResponseDto> {
    return this.clipLibraryService.updateClip(req.user.id, clipId, dto);
  }

  /**
   * Delete a clip from user's library
   */
  @Delete('clips/:clipId')
  @ApiOkResponse({ type: SuccessResponseDto })
  async deleteClip(
    @Param('clipId') clipId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.clipLibraryService.deleteClip(req.user.id, clipId);
    return { success: true };
  }

  /**
   * Share an existing clip to a channel or DM
   */
  @Post('clips/:clipId/share')
  @ApiCreatedResponse({ type: ShareClipResponseDto })
  async shareClip(
    @Param('clipId') clipId: string,
    @Body() dto: ShareClipDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ShareClipResponseDto> {
    return this.clipLibraryService.shareClip(req.user.id, clipId, dto);
  }
}
