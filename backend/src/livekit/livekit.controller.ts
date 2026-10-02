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
  Logger,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { LivekitService } from './livekit.service';
import { LivekitReplayService } from './livekit-replay.service';
import { ClipLibraryService } from './clip-library.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { CreateTokenDto } from './dto/create-token.dto';
import { MuteParticipantDto } from './dto/mute-participant.dto';
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
  ) {}

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
    // Always use the authenticated user's ID to prevent identity spoofing
    const tokenDto = {
      ...createTokenDto,
      identity: req.user.id,
    };
    return this.livekitService.generateToken(tokenDto, this.sessionIdOf(req));
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
    // Always use the authenticated user's ID to prevent identity spoofing
    const tokenDto = {
      ...createTokenDto,
      identity: req.user.id,
    };
    return this.livekitService.generateToken(tokenDto, this.sessionIdOf(req));
  }

  @Post('channels/:channelId/mute-participant')
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
  ): Promise<{ success: boolean }> {
    await this.livekitService.muteParticipant(
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
  @RequiredActions(RbacActions.JOIN_CHANNEL)
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
      roomName: dto.roomName,
      videoTrackId: dto.videoTrackId,
      audioTrackId: dto.audioTrackId,
      participantIdentity: dto.participantIdentity,
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
