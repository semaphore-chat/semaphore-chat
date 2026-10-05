import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  EgressClient,
  RoomServiceClient,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  EncodingOptions,
  EncodingOptionsPreset,
  EgressInfo,
  EgressStatus,
  VideoCodec,
  AudioCodec,
  TrackType,
} from 'livekit-server-sdk';
import { randomUUID } from 'crypto';
import { EgressSession, RbacActions } from '@prisma/client';
import { PermissionsService } from '@/roles/permissions.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { RoomName } from '@/common/utils/room-name.util';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  ClipMessageCreateEvent,
  emitClipMessageCreate,
} from '@/common/events/clip-message.events';
import {
  VOICE_USER_LEFT,
  VoiceUserLeftEvent,
} from '@/common/events/voice-presence.events';
import { getErrorMessage } from '@/common/utils/error.utils';
import { ThumbnailService } from '@/file/thumbnail.service';
import { FfmpegService } from './ffmpeg.service';
import { ReplaySegmentsService } from './replay-segments.service';
import {
  CaptureReplayDto,
  CaptureReplayResponseDto,
} from './dto/capture-replay.dto';
import { createHash } from 'crypto';
import * as path from 'path';
import { EGRESS_CLIENT } from './providers/egress-client.provider';
import { ROOM_SERVICE_CLIENT } from './providers/room-service.provider';

@Injectable()
export class LivekitReplayService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LivekitReplayService.name);
  private readonly segmentsPath: string;
  private readonly egressOutputPath: string;
  private readonly clipsPath: string;

  /**
   * Egress IDs the reconcile cron failed to find in LiveKit exactly once.
   *
   * A single empty listEgress response can be a transient LiveKit blip; if
   * we flipped the session to 'stopped' (and emitted REPLAY_BUFFER_STOPPED)
   * on the first miss we would kill the client's capture button for a
   * perfectly live screen share. We only act on the second consecutive
   * miss. Per-pod memory is fine here: a duplicate stop event from another
   * replica is harmless, entries are removed when the egress reappears or
   * once we act, and the set is pruned to currently-active sessions.
   */
  private readonly egressMissedOnce = new Set<string>();

  /** Skip the heal's dead-path stop event for sessions older than this. */
  private static readonly STALE_NOTIFY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  /**
   * Non-reentrancy guard for reconcileEgressStatus. The bootstrap kick-off
   * is fire-and-forget and listEgress has no timeout, so a hung LiveKit
   * call could still be in flight when the cron fires — overlapping passes
   * would double-count strikes in egressMissedOnce and race their DB
   * updates. Per-instance state is fine: the cron is per-pod anyway.
   */
  private reconcileInProgress = false;

  constructor(
    @Inject(EGRESS_CLIENT)
    private readonly egressClient: EgressClient,
    @Inject(ROOM_SERVICE_CLIENT)
    private readonly roomServiceClient: RoomServiceClient,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly storageService: StorageService,
    private readonly websocketService: WebsocketService,
    private readonly ffmpegService: FfmpegService,
    private readonly replaySegmentsService: ReplaySegmentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly thumbnailService: ThumbnailService,
    private readonly permissionsService: PermissionsService,
  ) {
    // Load configuration
    // segmentsPath is now loaded from StorageService which handles prefix resolution
    this.segmentsPath = this.storageService.getSegmentsPrefix();
    this.egressOutputPath =
      this.configService.get<string>('REPLAY_EGRESS_OUTPUT_PATH') || '/out';

    // Convert clips path to absolute path for FFmpeg compatibility
    // Default must be absolute — relative paths resolve against process.cwd()
    // (/app/backend), but the uploads volume is mounted at /app/uploads.
    const rawClipsPath =
      this.configService.get<string>('REPLAY_CLIPS_PATH') ||
      '/app/uploads/replays';
    this.clipsPath = path.resolve(rawClipsPath);

    this.logger.log('LivekitReplayService initialized');
    this.logger.log(
      `Segments path (for reading): ${this.segmentsPath} (via StorageService)`,
    );
    this.logger.log(
      `Egress output path (for LiveKit API): ${this.egressOutputPath}`,
    );
    this.logger.log(`Clips path: ${this.clipsPath}`);
  }

  /**
   * Reconcile egress state once at startup.
   *
   * Sessions left 'active' in the database across a backend restart (missed
   * webhooks, crash mid-egress) would otherwise linger until the first cron
   * tick. Deliberately fire-and-forget: listEgress has no timeout, so
   * awaiting it here would let an unreachable LiveKit stall app.listen()
   * and fail k8s startup/readiness probes. Failures are logged, never
   * propagated.
   */
  onApplicationBootstrap(): void {
    void this.reconcileEgressStatus().catch((error) => {
      this.logger.warn(
        `Startup egress reconciliation failed: ${getErrorMessage(error)}`,
      );
    });
  }

  /**
   * Start replay buffer egress for a user's screen share
   *
   * Automatically stops any existing active session for the user before starting new one.
   * Queries the source track to match encoding resolution to the actual screen share quality.
   */
  async startReplayBuffer(params: {
    userId: string;
    channelId: string;
    roomName: string;
    videoTrackId: string;
    audioTrackId?: string;
    participantIdentity?: string;
  }) {
    const {
      userId,
      channelId,
      roomName,
      videoTrackId,
      audioTrackId,
      participantIdentity,
    } = params;

    this.logger.log(
      `Starting replay buffer for user ${userId} in room ${roomName}`,
    );

    // Check if user already has an active session (enforce one session per user)
    const existingSession = await this.databaseService.egressSession.findFirst({
      where: {
        userId,
        status: 'active',
      },
    });

    if (existingSession) {
      this.logger.warn(
        `User ${userId} already has active session ${existingSession.egressId}, stopping it first`,
      );
      await this.stopReplayBuffer(userId);
    }

    // Create unique session ID for directory isolation
    // We generate this BEFORE calling LiveKit API so we know the exact path
    const sessionId = randomUUID();

    // Create unique segment path using LiveKit egress output directory
    // This is the path we tell LiveKit Egress to write to (absolute path for LiveKit API)
    // Organize by session directory for isolation, use {time} template for unique segment names
    const egressSegmentPath = `${this.egressOutputPath}/${sessionId}/{time}-segment`;

    // Configure segmented HLS output for replay buffer
    const outputs = {
      segments: new SegmentedFileOutput({
        filenamePrefix: egressSegmentPath,
        playlistName: 'playlist.m3u8',
        segmentDuration: 10, // 10-second segments
        protocol: SegmentedFileProtocol.HLS_PROTOCOL,
      }),
    };

    try {
      // Query track resolution to match egress encoding to source quality
      let encodingOptions: EncodingOptions | EncodingOptionsPreset =
        EncodingOptionsPreset.H264_1080P_30;

      if (participantIdentity) {
        try {
          const participant = await this.roomServiceClient.getParticipant(
            roomName,
            participantIdentity,
          );

          const videoTrack = participant.tracks.find(
            (track) =>
              track.sid === videoTrackId && track.type === TrackType.VIDEO,
          );

          if (videoTrack?.width && videoTrack?.height) {
            // Calculate intelligent bitrate based on resolution
            // Screen content needs higher bitrates than camera for sharp text/edges
            const videoBitrate = this.calculateVideoBitrate(
              videoTrack.width,
              videoTrack.height,
            );

            // Create custom encoding options matching source track resolution
            encodingOptions = new EncodingOptions({
              width: videoTrack.width,
              height: videoTrack.height,
              framerate: 30, // Cap at 30fps for reasonable file sizes
              videoCodec: VideoCodec.H264_HIGH,
              videoBitrate, // Intelligent bitrate based on resolution
              audioBitrate: 128000, // 128kbps audio
              audioCodec: AudioCodec.AAC,
            });

            this.logger.log(
              `Using source track: ${videoTrack.width}x${videoTrack.height} @ ${videoBitrate / 1000}kbps`,
            );
          } else {
            this.logger.warn(
              `Track ${videoTrackId} has no resolution info, using default preset`,
            );
          }
        } catch (queryError) {
          this.logger.warn(
            `Failed to query track resolution, using default preset: ${getErrorMessage(queryError)}`,
          );
        }
      } else {
        this.logger.log(
          'No participantIdentity provided, using default encoding preset',
        );
      }

      // Start track composite egress
      const egressInfo = await this.egressClient.startTrackCompositeEgress(
        roomName,
        outputs,
        {
          videoTrackId,
          ...(audioTrackId ? { audioTrackId } : {}),
          encodingOptions,
        },
      );

      this.logger.log(
        `Egress started successfully: ${egressInfo.egressId} for user ${userId} in ${sessionId}`,
      );

      // Store RELATIVE path in DB (just the sessionId directory)
      // StorageService will resolve this to full path using REPLAY_SEGMENTS_PATH prefix
      const relativeSegmentPath = sessionId;

      const session = await this.databaseService.egressSession.create({
        data: {
          egressId: egressInfo.egressId,
          userId,
          roomName,
          channelId,
          segmentPath: relativeSegmentPath, // Store relative path for portability
          status: 'active',
          startedAt: new Date(),
        },
      });

      // Schedule a delayed check to notify the client when segments are available
      setTimeout(() => {
        this.checkAndNotifySegmentsReady(session.id, userId, channelId).catch(
          (err) =>
            this.logger.warn(
              `Segment readiness check failed: ${getErrorMessage(err)}`,
            ),
        );
      }, 15_000);

      return {
        sessionId: session.id,
        egressId: session.egressId,
        status: session.status,
      };
    } catch (error) {
      this.logger.error(
        `Failed to start egress for user ${userId}: ${getErrorMessage(error)}`,
      );
      throw new BadRequestException(
        'Could not start the replay recorder. Please try screen sharing again.',
      );
    }
  }

  /**
   * Check if segments are available and notify the user via WebSocket.
   */
  private async checkAndNotifySegmentsReady(
    sessionId: string,
    userId: string,
    channelId: string,
  ): Promise<void> {
    const session = await this.databaseService.egressSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.status !== 'active') return;

    // Check if segments exist on disk
    const segments = await this.storageService.listFiles(session.segmentPath);
    if (segments.length > 0) {
      this.websocketService.sendToRoom(
        RoomName.user(userId),
        ServerEvents.EGRESS_SEGMENTS_READY,
        { sessionId, channelId },
      );
    }
  }

  /**
   * Stop replay buffer egress for a user
   *
   * Finds the user's active session and stops it
   */
  async stopReplayBuffer(userId: string) {
    this.logger.log(`Stopping replay buffer for user ${userId}`);

    // Find active session for user
    const session = await this.databaseService.egressSession.findFirst({
      where: {
        userId,
        status: 'active',
      },
    });

    if (!session) {
      this.logger.warn(`No active session found for user ${userId}`);
      throw new NotFoundException(
        'No active replay found. Start screen sharing to record a replay.',
      );
    }

    try {
      // Stop LiveKit egress
      await this.egressClient.stopEgress(session.egressId);
      this.logger.log(`Egress stopped: ${session.egressId}`);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      // If the egress is already gone/ended on the LiveKit side, that's
      // fine - just update the DB. Anything else (network timeout, auth)
      // is a real failure. Without this tolerance a zombie 'active' row
      // whose egress already ended would block the next screen-share start.
      if (this.isEgressAlreadyEndedError(errorMsg)) {
        this.logger.warn(
          `Egress ${session.egressId} already stopped on LiveKit side, cleaning up database`,
        );
      } else {
        this.logger.error(
          `Failed to stop egress ${session.egressId}: ${errorMsg}`,
        );
        throw new BadRequestException(
          'Could not stop the replay recorder. Please try again.',
        );
      }
    }

    // Update session status in database (even if egress was already gone)
    await this.databaseService.egressSession.update({
      where: { id: session.id },
      data: {
        status: 'stopped',
        endedAt: new Date(),
      },
    });

    this.logger.log(
      `Session ${session.id} marked as stopped for user ${userId}`,
    );

    // Delete entire session directory (cleanup segments)
    // session.segmentPath is now relative, resolve it using StorageService
    try {
      await this.storageService.deleteSegmentDirectory(session.segmentPath, {
        recursive: true,
        force: true,
      });
      const resolvedPath = this.storageService.resolveSegmentPath(
        session.segmentPath,
      );
      this.logger.log(`Cleaned up segment directory: ${resolvedPath}`);
    } catch (cleanupError) {
      // Log but don't fail - cleanup is best-effort
      const resolvedPath = this.storageService.resolveSegmentPath(
        session.segmentPath,
      );
      this.logger.warn(
        `Failed to cleanup segments at ${resolvedPath}: ${getErrorMessage(cleanupError)}`,
      );
    }

    return {
      sessionId: session.id,
      egressId: session.egressId,
      status: 'stopped',
    };
  }

  /**
   * True when a stopEgress failure means the egress is already gone or
   * ended on the LiveKit side (so stopping is a no-op, not an error).
   *
   * LiveKit server (twirp) error strings, matched case-insensitively and
   * conservatively:
   * - 'egress does not exist'  — unknown/expired egress ID
   * - 'egress is not active'   — egress already completed/aborted
   */
  private isEgressAlreadyEndedError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('egress does not exist') ||
      normalized.includes('egress is not active')
    );
  }

  /**
   * Stop any active replay buffer when a user leaves a voice channel.
   *
   * Fired by VoicePresenceService via a domain event so the voice-presence
   * module does not need to import the LiveKit module (which would create a
   * circular module dependency). Cleanup is best-effort: a missing session
   * (404) is expected and other errors are logged, never re-thrown.
   */
  @OnEvent(VOICE_USER_LEFT)
  async handleVoiceUserLeft({ userId }: VoiceUserLeftEvent): Promise<void> {
    try {
      await this.stopReplayBuffer(userId);
    } catch (error: unknown) {
      // Ignore if no session found (404), log other errors
      const isNotFoundError =
        error instanceof Error &&
        'status' in error &&
        (error as Error & { status: number }).status === 404;
      if (!isNotFoundError) {
        this.logger.warn(
          `Failed to stop replay buffer on voice leave for user ${userId}: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  /**
   * Handle egress ended event from LiveKit webhook
   *
   * Called when LiveKit automatically stops an egress (user disconnects, track ends, etc.)
   * Updates database and notifies user if egress failed
   *
   * @param egressId - LiveKit egress ID
   * @param status - Final status: 'stopped' or 'failed'
   * @param errorMessage - Optional error message if failed
   */
  async handleEgressEnded(
    egressId: string,
    status: 'stopped' | 'failed',
    errorMessage?: string,
  ) {
    this.logger.log(
      `Handling egress ended: ${egressId} with status: ${status}`,
    );

    // Find session by egress ID
    const session = await this.databaseService.egressSession.findUnique({
      where: { egressId },
    });

    if (!session) {
      this.logger.warn(
        `Received egress_ended for unknown egressId: ${egressId}`,
      );
      return;
    }

    // Don't update if already stopped/failed (idempotency)
    if (session.status !== 'active') {
      this.logger.debug(
        `Session ${session.id} already in status: ${session.status}, skipping update`,
      );
      return;
    }

    // Update session status in database
    await this.databaseService.egressSession.update({
      where: { id: session.id },
      data: {
        status,
        error: errorMessage,
        endedAt: new Date(),
      },
    });

    this.logger.log(
      `Session ${session.id} updated to status: ${status} for user ${session.userId}`,
    );

    // Delete entire session directory (cleanup segments)
    // session.segmentPath is now relative, resolve it using StorageService
    try {
      await this.storageService.deleteSegmentDirectory(session.segmentPath, {
        recursive: true,
        force: true,
      });
      const resolvedPath = this.storageService.resolveSegmentPath(
        session.segmentPath,
      );
      this.logger.log(`Cleaned up segment directory: ${resolvedPath}`);
    } catch (cleanupError) {
      // Log but don't fail - cleanup is best-effort
      const resolvedPath = this.storageService.resolveSegmentPath(
        session.segmentPath,
      );
      this.logger.warn(
        `Failed to cleanup segments at ${resolvedPath}: ${getErrorMessage(cleanupError)}`,
      );
    }

    // Send WebSocket event to user
    // In Socket.IO, users join a room with their userId
    if (status === 'failed') {
      this.websocketService.sendToRoom(
        RoomName.user(session.userId),
        ServerEvents.REPLAY_BUFFER_FAILED,
        {
          sessionId: session.id,
          egressId: session.egressId,
          channelId: session.channelId,
          error: errorMessage || 'Unknown error',
        },
      );
      this.logger.log(
        `Sent REPLAY_BUFFER_FAILED event to user ${session.userId}`,
      );
    } else {
      this.websocketService.sendToRoom(
        RoomName.user(session.userId),
        ServerEvents.REPLAY_BUFFER_STOPPED,
        {
          sessionId: session.id,
          egressId: session.egressId,
          channelId: session.channelId,
        },
      );
      this.logger.log(
        `Sent REPLAY_BUFFER_STOPPED event to user ${session.userId}`,
      );
    }
  }

  /**
   * Reconcile egress status with LiveKit
   *
   * Runs every 1 minute to verify that our database status matches LiveKit's actual egress status
   * This catches edge cases where webhooks might have been missed or failed
   */
  @Cron('*/1 * * * *') // Every 1 minute
  async reconcileEgressStatus() {
    if (this.reconcileInProgress) {
      this.logger.warn(
        'Skipping egress status reconciliation: previous pass still in progress',
      );
      return;
    }
    this.reconcileInProgress = true;

    this.logger.debug('Running egress status reconciliation...');

    try {
      // Find all active sessions in our database
      const activeSessions = await this.databaseService.egressSession.findMany({
        where: { status: 'active' },
      });

      if (activeSessions.length === 0) {
        this.egressMissedOnce.clear();
        this.logger.debug('No active sessions to reconcile');
        return;
      }

      // Prune strikes for sessions that are no longer active in the DB
      // (e.g. resolved by a webhook between passes) so the set can't grow.
      const activeEgressIds = new Set(activeSessions.map((s) => s.egressId));
      for (const egressId of this.egressMissedOnce) {
        if (!activeEgressIds.has(egressId)) {
          this.egressMissedOnce.delete(egressId);
        }
      }

      this.logger.debug(
        `Reconciling ${activeSessions.length} active sessions with LiveKit`,
      );

      let reconciledCount = 0;

      for (const session of activeSessions) {
        try {
          // Query LiveKit for actual egress status
          const egressInfoList = await this.egressClient.listEgress({
            egressId: session.egressId,
          });

          // Check if egress exists and is actually active
          const egressInfo =
            egressInfoList.length > 0 ? egressInfoList[0] : null;

          if (!egressInfo) {
            // Two-strikes rule: a single empty listEgress response can be a
            // transient blip. Only mark the session stopped (and notify the
            // client) on the second consecutive miss.
            if (!this.egressMissedOnce.has(session.egressId)) {
              this.egressMissedOnce.add(session.egressId);
              this.logger.warn(
                `Egress ${session.egressId} not found in LiveKit (first miss) — will mark stopped if still missing on the next reconcile pass`,
              );
              continue;
            }

            // Second consecutive miss — the egress is genuinely gone.
            this.egressMissedOnce.delete(session.egressId);
            this.logger.warn(
              `Egress ${session.egressId} not found in LiveKit (second consecutive miss), marking as stopped`,
            );

            await this.databaseService.egressSession.update({
              where: { id: session.id },
              data: {
                status: 'stopped',
                endedAt: new Date(),
              },
            });

            // Notify the client so the capture button clears — without this
            // the frontend keeps offering capture and gets 404s (issue #302).
            this.websocketService.sendToRoom(
              RoomName.user(session.userId),
              ServerEvents.REPLAY_BUFFER_STOPPED,
              {
                sessionId: session.id,
                egressId: session.egressId,
                channelId: session.channelId,
              },
            );

            reconciledCount++;
            continue;
          }

          // Egress reappeared (or was never missing) — clear any pending
          // first-miss strike so a later isolated blip starts from zero.
          this.egressMissedOnce.delete(session.egressId);

          // Check LiveKit status
          const livekitStatus = egressInfo.status;

          // If LiveKit shows egress is not active, update our database
          if (
            livekitStatus !== EgressStatus.EGRESS_STARTING &&
            livekitStatus !== EgressStatus.EGRESS_ACTIVE
          ) {
            const isFailed =
              livekitStatus === EgressStatus.EGRESS_FAILED ||
              livekitStatus === EgressStatus.EGRESS_ABORTED;

            this.logger.warn(
              `Egress ${session.egressId} status mismatch: DB=active, LiveKit=${livekitStatus}`,
            );

            await this.databaseService.egressSession.update({
              where: { id: session.id },
              data: {
                status: isFailed ? 'failed' : 'stopped',
                endedAt: new Date(),
              },
            });

            // Notify user if egress failed
            if (isFailed) {
              this.websocketService.sendToRoom(
                RoomName.user(session.userId),
                ServerEvents.REPLAY_BUFFER_FAILED,
                {
                  sessionId: session.id,
                  egressId: session.egressId,
                  channelId: session.channelId,
                  error: egressInfo.error || 'Unknown error',
                },
              );
            } else {
              this.websocketService.sendToRoom(
                RoomName.user(session.userId),
                ServerEvents.REPLAY_BUFFER_STOPPED,
                {
                  sessionId: session.id,
                  egressId: session.egressId,
                  channelId: session.channelId,
                },
              );
            }

            reconciledCount++;
          }
        } catch (error) {
          this.logger.error(
            `Failed to reconcile session ${session.id}: ${getErrorMessage(error)}`,
          );
          // Continue with next session
        }
      }

      if (reconciledCount > 0) {
        this.logger.log(
          `Reconciled ${reconciledCount} sessions with LiveKit status`,
        );
      } else {
        this.logger.debug('All sessions are in sync with LiveKit');
      }
    } catch (error) {
      this.logger.error(
        `Egress status reconciliation job failed: ${getErrorMessage(error)}`,
      );
    } finally {
      this.reconcileInProgress = false;
    }
  }

  /**
   * On-demand heal for capture/stream/session-info requests that find no
   * active session.
   *
   * The frontend only clears its capture UI on REPLAY_BUFFER_STOPPED/FAILED
   * events, so a session row that was flipped without an event (missed
   * webhook, silent reconcile, orphan cleanup) strands the button and every
   * capture 404s (issues #302/#188). When the active-session lookup misses,
   * this checks the user's most recent session against LiveKit:
   *
   * - Egress still running → the DB was wrongly marked stopped (e.g. a
   *   transient empty listEgress response); heal the row back to 'active'
   *   and let the capture/stream proceed.
   * - Egress genuinely gone → emit the missing REPLAY_BUFFER_STOPPED/FAILED
   *   event so the client clears its UI, then throw an accurate
   *   NotFoundException.
   * - LiveKit unreachable (listEgress throws) → we cannot tell whether the
   *   recording is alive, so throw a retryable ServiceUnavailableException
   *   without emitting any event or touching the DB row.
   *
   * @param userId - ID of the user requesting capture/stream
   * @returns The healed, active session
   * @throws NotFoundException when no session exists or the egress has ended
   * @throws ServiceUnavailableException when LiveKit cannot be queried
   */
  private async recoverStaleSession(userId: string): Promise<EgressSession> {
    // Most recent session regardless of status — the row the stranded
    // capture button is really pointing at.
    const recentSession = await this.databaseService.egressSession.findFirst({
      where: { userId },
      orderBy: { startedAt: 'desc' },
    });

    if (!recentSession) {
      throw new NotFoundException(
        'No active replay found. Start screen sharing first.',
      );
    }

    // Ask LiveKit whether the egress is actually still running.
    //
    // - Missing client → LiveKit is not configured on this instance at all
    //   (no URL/key/secret), so no egress can possibly be running; falling
    //   through to the "recording ended" path below is accurate.
    // - listEgress throws → LiveKit is configured but unreachable. The
    //   recording may well still be alive, so telling the client it ended
    //   (and emitting REPLAY_BUFFER_STOPPED) would wrongly kill a live
    //   capture UI. Surface a retryable 503 instead — no event, no DB write.
    let egressStatus: EgressStatus | null = null;
    if (this.egressClient) {
      let egressInfoList: EgressInfo[];
      try {
        egressInfoList = await this.egressClient.listEgress({
          egressId: recentSession.egressId,
        });
      } catch (error) {
        this.logger.warn(
          `Could not verify egress ${recentSession.egressId} during heal: ${getErrorMessage(error)}`,
        );
        throw new ServiceUnavailableException(
          'Could not check your replay status — please try again.',
        );
      }
      egressStatus =
        egressInfoList.length > 0 ? egressInfoList[0].status : null;
    }

    if (
      egressStatus === EgressStatus.EGRESS_ACTIVE ||
      egressStatus === EgressStatus.EGRESS_STARTING
    ) {
      // The egress is alive but our row says otherwise (e.g. a transient
      // empty listEgress marked it stopped). Resurrect it with a
      // compare-and-swap on the status we read: if a webhook or another
      // replica changed the row in the meantime, we must not blindly stomp
      // it back to 'active' (heal-vs-webhook zombie-row race).
      const resurrected = await this.databaseService.egressSession.updateMany({
        where: { id: recentSession.id, status: recentSession.status },
        data: {
          status: 'active',
          endedAt: null,
          error: null,
        },
      });

      if (resurrected.count === 1) {
        this.logger.warn(
          `Healed session ${recentSession.id} for user ${userId}: DB status '${recentSession.status}' but LiveKit egress ${recentSession.egressId} is still running`,
        );
        return {
          ...recentSession,
          status: 'active',
          endedAt: null,
          error: null,
        };
      }

      // Lost the CAS — someone else transitioned the row while we were
      // checking LiveKit. Treat this attempt as not-healed and fall through
      // to the accurate-ended handling below.
      this.logger.warn(
        `Skipped healing session ${recentSession.id} for user ${userId}: row status changed from '${recentSession.status}' during heal`,
      );
    }

    // Egress is genuinely gone. If the session ended long ago the client's
    // state is ancient (e.g. a stale tab) — skip the phantom "ended" toast
    // and fail with the plain not-found message instead.
    const endedAtMs = (
      recentSession.endedAt ?? recentSession.startedAt
    ).getTime();
    const notifyMaxAgeMs = LivekitReplayService.STALE_NOTIFY_MAX_AGE_MS;
    if (Date.now() - endedAtMs > notifyMaxAgeMs) {
      throw new NotFoundException(
        'No active replay found. Start screen sharing first.',
      );
    }

    // The client is still showing the capture button (or it wouldn't have
    // hit this endpoint) — emit the event it missed so the UI clears, then
    // fail with an accurate message.
    if (recentSession.status === 'failed') {
      this.websocketService.sendToRoom(
        RoomName.user(recentSession.userId),
        ServerEvents.REPLAY_BUFFER_FAILED,
        {
          sessionId: recentSession.id,
          egressId: recentSession.egressId,
          channelId: recentSession.channelId,
          error: recentSession.error || 'Unknown error',
        },
      );
    } else {
      this.websocketService.sendToRoom(
        RoomName.user(recentSession.userId),
        ServerEvents.REPLAY_BUFFER_STOPPED,
        {
          sessionId: recentSession.id,
          egressId: recentSession.egressId,
          channelId: recentSession.channelId,
        },
      );
    }

    throw new NotFoundException(
      'Your replay recording has ended — start screen sharing again to capture.',
    );
  }

  /**
   * Stream a replay clip directly to the client (download-only, no persistence)
   * Creates a temporary file that should be deleted by the controller after streaming
   *
   * @param userId - ID of the user requesting the stream
   * @param durationMinutes - How many minutes to capture (1, 2, 5, or 10)
   * @returns Path to temporary MP4 file for streaming
   */
  async streamReplay(userId: string, durationMinutes: number): Promise<string> {
    this.logger.log(
      `Streaming ${durationMinutes}-minute replay for user ${userId}`,
    );

    // 1. Find active egress session for this user
    // If the row was flipped without notifying the client, try to heal it
    // (or emit the missed stop event and fail accurately).
    const session =
      (await this.databaseService.egressSession.findFirst({
        where: {
          userId,
          status: 'active',
        },
      })) ?? (await this.recoverStaleSession(userId));

    // 2. Calculate how many segments we need
    // Each segment is ~10 seconds, so 6 segments per minute
    const segmentsNeeded = durationMinutes * 6;

    // 3. Resolve relative segment path to full path
    const segmentDir = this.storageService.resolveSegmentPath(
      session.segmentPath,
    );

    // 4. List only complete segments (>= 10KB) to avoid corrupt/partial data
    const allSegments =
      await this.replaySegmentsService.listCompleteSegments(segmentDir);

    if (allSegments.length === 0) {
      throw new BadRequestException(
        'Your replay is still warming up. Keep sharing your screen for a few seconds, then try again.',
      );
    }

    // 5. Take ONLY the last N segments (most recent)
    const segments = allSegments.slice(-segmentsNeeded);

    this.logger.log(
      `Streaming ${segments.length} segments (requested ${segmentsNeeded}) from total ${allSegments.length} available`,
    );

    // 4. Create temp file path in /tmp
    const timestamp = Date.now();
    const tempFilename = `replay-stream-${userId}-${timestamp}.mp4`;
    const tempPath = path.join('/tmp', tempFilename);

    // 5. Concatenate segments with FFmpeg to temp file
    const segmentPaths = segments.map((s) => s.path);
    await this.ffmpegService.concatenateSegments(segmentPaths, tempPath);

    this.logger.log(`Created temp replay file for streaming at ${tempPath}`);

    return tempPath;
  }

  /**
   * Capture a replay clip from the buffer and post it to a channel or DM
   *
   * Takes the last N minutes of screen share segments, concatenates them into an MP4,
   * creates File and ReplayClip records, and posts a message with the clip attached.
   *
   * @param userId - ID of the user capturing the replay
   * @param dto - Capture request with duration and destination
   * @returns Response with clip info, download URL, and message ID
   */
  async captureReplay(
    userId: string,
    dto: CaptureReplayDto,
  ): Promise<CaptureReplayResponseDto> {
    const isCustomRange =
      dto.startSeconds !== undefined && dto.endSeconds !== undefined;
    const durationDescription = isCustomRange
      ? `custom range ${dto.startSeconds}s-${dto.endSeconds}s`
      : `${dto.durationMinutes}-minute preset`;

    this.logger.log(
      `Capturing ${durationDescription} replay for user ${userId} (destination: ${dto.destination})`,
    );

    // 1. Find active egress session for this user
    // If the row was flipped without notifying the client, try to heal it
    // (or emit the missed stop event and fail accurately).
    const session =
      (await this.databaseService.egressSession.findFirst({
        where: {
          userId,
          status: 'active',
        },
      })) ?? (await this.recoverStaleSession(userId));

    // 2. Resolve relative segment path to full path
    const segmentDir = this.storageService.resolveSegmentPath(
      session.segmentPath,
    );

    // 3. List only complete segments (>= 10KB) to avoid corrupt/partial data
    const allSegments =
      await this.replaySegmentsService.listCompleteSegments(segmentDir);

    if (allSegments.length === 0) {
      throw new BadRequestException(
        'Your replay is still warming up. Keep sharing your screen for a few seconds, then try again.',
      );
    }

    // 4. Select segments based on preset or custom range
    let segments: typeof allSegments;
    let trimOptions: { startOffset: number; duration: number } | undefined =
      undefined;

    if (isCustomRange) {
      if (dto.startSeconds! >= dto.endSeconds!) {
        throw new BadRequestException('Start time must be before end time');
      }

      // Custom range: calculate segment indices from timestamps
      const startSegmentIndex = Math.floor(dto.startSeconds! / 10);
      const endSegmentIndex = Math.ceil(dto.endSeconds! / 10);

      // Clamp to available segments instead of throwing
      const clampedStart = Math.min(
        startSegmentIndex,
        Math.max(0, allSegments.length - 1),
      );
      const clampedEnd = Math.min(endSegmentIndex, allSegments.length);

      if (clampedStart >= clampedEnd) {
        throw new BadRequestException(
          'That part of the replay is no longer available. Try a more recent time range.',
        );
      }

      if (
        clampedStart !== startSegmentIndex ||
        clampedEnd !== endSegmentIndex
      ) {
        this.logger.warn(
          `Clamped capture range: requested [${startSegmentIndex}, ${endSegmentIndex}) -> available [${clampedStart}, ${clampedEnd})`,
        );
      }

      segments = allSegments.slice(clampedStart, clampedEnd);

      // Calculate precise trim options for FFmpeg
      // startOffset: how many seconds into the first segment to skip
      const startOffset = dto.startSeconds! - clampedStart * 10;
      const clampedEndSeconds = Math.min(dto.endSeconds!, clampedEnd * 10);
      const exactDuration = clampedEndSeconds - dto.startSeconds!;

      if (startOffset > 0 || exactDuration !== segments.length * 10) {
        trimOptions = {
          startOffset,
          duration: exactDuration,
        };
        this.logger.log(
          `Precise trim: skip ${startOffset}s into first segment, exact duration ${exactDuration}s`,
        );
      }
    } else {
      // Preset duration: take last N segments
      const segmentsNeeded = (dto.durationMinutes || 1) * 6;
      segments = allSegments.slice(-segmentsNeeded);
    }

    // Estimate duration for logging (actual will come from FFmpeg probe)
    const estimatedDurationSeconds = trimOptions
      ? trimOptions.duration
      : segments.length * 10;

    this.logger.log(
      `Selected ${segments.length} segments from total ${allSegments.length} available. Estimated: ${estimatedDurationSeconds}s`,
    );

    // 6. Prepare output path
    const timestamp = Date.now();
    const clipFilename = `replay-${timestamp}.mp4`;
    const userClipsDir = path.join(this.clipsPath, userId);
    const clipPath = path.join(userClipsDir, clipFilename);

    // Ensure clips directory exists
    await this.storageService.ensureDirectory(userClipsDir);

    // 7. Concatenate segments with FFmpeg (with optional precise trimming)
    const segmentPaths = segments.map((s) => s.path);
    await this.ffmpegService.concatenateSegments(
      segmentPaths,
      clipPath,
      trimOptions,
    );

    // 8. Get ACTUAL duration from FFmpeg probe (not estimated)
    let actualDurationSeconds: number;
    try {
      const actualDurationRaw =
        await this.ffmpegService.getVideoDuration(clipPath);
      actualDurationSeconds = Math.round(actualDurationRaw);
      // Fallback to estimated duration if probe fails or returns invalid value
      if (
        !Number.isFinite(actualDurationSeconds) ||
        actualDurationSeconds <= 0
      ) {
        this.logger.warn(
          `FFprobe returned invalid duration (${actualDurationRaw}), using estimated: ${estimatedDurationSeconds}s`,
        );
        actualDurationSeconds = estimatedDurationSeconds;
      }
    } catch (probeError) {
      this.logger.warn(
        `FFprobe failed, using estimated duration: ${estimatedDurationSeconds}s`,
        probeError,
      );
      actualDurationSeconds = estimatedDurationSeconds;
    }

    this.logger.log(
      `Actual video duration: ${actualDurationSeconds}s (estimated: ${estimatedDurationSeconds}s)`,
    );

    // 9. Get file stats and generate checksum
    const stats = await this.storageService.getFileStats(clipPath);
    const checksum = await this.generateChecksum(clipPath);

    // 7. Create File record with REPLAY_CLIP resourceType
    // resourceId stays as userId for clip library ownership
    const file = await this.databaseService.file.create({
      data: {
        filename: clipFilename,
        mimeType: 'video/mp4',
        fileType: 'VIDEO',
        size: stats.size,
        checksum,
        uploadedById: userId,
        storageType: 'LOCAL',
        storagePath: clipPath,
        resourceType: 'REPLAY_CLIP',
        fileUserId: userId, // Clip owner (doesn't change when shared)
      },
    });

    this.logger.log(`Created file record: ${file.id}`);

    // Generate thumbnail for the video clip before the message is created,
    // so the broadcast/cached message carries hasThumbnail: true.
    // Failure is non-fatal — the clip is still posted without a thumbnail.
    await this.generateThumbnail(clipPath, file.id);

    // 8. Create ReplayClip record
    const clip = await this.databaseService.replayClip.create({
      data: {
        userId,
        fileId: file.id,
        channelId: session.channelId,
        durationSeconds: actualDurationSeconds,
      },
    });

    this.logger.log(
      `Successfully created replay clip ${clip.id} (${stats.size} bytes, ${actualDurationSeconds}s)`,
    );

    // 9. Optionally create message with clip attachment (for channel/dm destinations)
    let messageId: string | undefined;

    // Authorization: verify the user can post to the target destination
    if (dto.destination === 'channel' && dto.targetChannelId) {
      const channel = await this.databaseService.channel.findUnique({
        where: { id: dto.targetChannelId },
      });
      if (!channel) {
        throw new NotFoundException('That channel could not be found.');
      }
      // Posting a clip is sending a message with a file: the same channel
      // permissions as any message (overwrites, timeouts, private channels).
      const allowed = await this.permissionsService.userHasChannelActions(
        userId,
        dto.targetChannelId,
        [RbacActions.CREATE_MESSAGE, RbacActions.ATTACH_FILES],
      );
      if (!allowed) {
        throw new ForbiddenException(
          "You don't have permission to post in that channel.",
        );
      }
    }

    if (dto.destination === 'dm' && dto.targetDirectMessageGroupId) {
      const dmMember =
        await this.databaseService.directMessageGroupMember.findFirst({
          where: { groupId: dto.targetDirectMessageGroupId, userId },
        });
      if (!dmMember) {
        throw new ForbiddenException(
          "You don't have permission to post in that conversation.",
        );
      }
    }

    if (dto.destination === 'channel' || dto.destination === 'dm') {
      const sizeMB = Math.round(stats.size / 1024 / 1024);

      // Delegate message creation + broadcast to the messages module via a
      // domain event (avoids importing MessagesModule, which would create a
      // circular module dependency).
      const eventPayload: ClipMessageCreateEvent = {
        authorId: userId,
        fileId: file.id,
        durationSeconds: actualDurationSeconds,
        sizeMB,
        destination: dto.destination,
        targetChannelId: dto.targetChannelId,
        targetDirectMessageGroupId: dto.targetDirectMessageGroupId,
      };

      this.logger.log(`Requesting clip message for file: ${file.id}`);
      ({ messageId } = await emitClipMessageCreate(
        this.eventEmitter,
        eventPayload,
      ));

      this.logger.log(
        `Posted replay clip message ${messageId} to ${dto.destination}`,
      );
    } else {
      this.logger.log(
        `Clip saved to library only (destination: ${dto.destination})`,
      );
    }

    // 10. Return response with download URL and optional message ID
    const requestedDurationSeconds = isCustomRange
      ? dto.endSeconds! - dto.startSeconds!
      : (dto.durationMinutes || 1) * 60;

    return {
      clipId: clip.id,
      fileId: file.id,
      durationSeconds: actualDurationSeconds,
      requestedDurationSeconds,
      sizeBytes: stats.size,
      downloadUrl: `/file/${file.id}`,
      messageId,
    };
  }

  /**
   * Generate SHA-256 checksum for a file
   *
   * @param filePath - Path to the file
   * @returns Hex-encoded SHA-256 hash
   * @private
   */
  private async generateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = this.storageService.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Generate a thumbnail for a replay clip and persist its path.
   * Errors are logged but never propagate to the capture response.
   */
  private async generateThumbnail(
    filePath: string,
    fileId: string,
  ): Promise<void> {
    try {
      const thumbnailPath = await this.thumbnailService.generateVideoThumbnail(
        filePath,
        fileId,
      );
      if (thumbnailPath) {
        await this.databaseService.file.update({
          where: { id: fileId },
          data: { thumbnailPath },
        });
        this.logger.log(`Generated thumbnail for replay clip ${fileId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to generate thumbnail for replay clip ${fileId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Calculate appropriate video bitrate based on resolution
   * Screen sharing content (text, UI) needs higher bitrates than camera video
   * for sharp, readable output.
   *
   * Bitrate recommendations for screen content (H.264):
   * - 720p (1280x720): 4-5 Mbps
   * - 1080p (1920x1080): 6-8 Mbps
   * - 1440p (2560x1440): 10-12 Mbps
   * - 4K (3840x2160): 15-20 Mbps
   *
   * @param width - Video width in pixels
   * @param height - Video height in pixels
   * @returns Bitrate in bits per second
   */
  private calculateVideoBitrate(width: number, height: number): number {
    const pixels = width * height;

    // Base calculation: ~5 bits per pixel for screen content at 30fps
    // This is higher than typical camera video (~2-3 bpp) due to
    // sharp edges, text, and high-contrast UI elements
    const bitsPerPixel = 5;
    const baseBitrate = pixels * bitsPerPixel;

    // Apply minimum and maximum bounds
    const minBitrate = 3_000_000; // 3 Mbps minimum (decent 720p)
    const maxBitrate = 20_000_000; // 20 Mbps maximum (high quality 4K)

    const bitrate = Math.max(minBitrate, Math.min(maxBitrate, baseBitrate));

    this.logger.debug(
      `Calculated bitrate for ${width}x${height}: ${bitrate / 1_000_000} Mbps`,
    );

    return bitrate;
  }

  /**
   * Get session info for the user's active replay buffer
   * Used by frontend to display buffer status and available segments
   *
   * @param userId - ID of the user
   * @returns Session info including segment count and duration
   */
  async getSessionInfo(userId: string): Promise<{
    hasActiveSession: boolean;
    sessionId?: string;
    totalSegments?: number;
    totalDurationSeconds?: number;
    bufferStartTime?: Date;
    bufferEndTime?: Date;
  }> {
    let session = await this.databaseService.egressSession.findFirst({
      where: {
        userId,
        status: 'active',
      },
    });

    if (!session) {
      // Same heal as captureReplay/streamReplay: a row silently flipped to
      // stopped while the egress is still running would otherwise leave the
      // capture modal's Custom Trim dead (hasActiveSession: false) even
      // though plain Capture heals. If the session is genuinely dead,
      // recoverStaleSession has already emitted the missed stop/fail event.
      //
      // A ServiceUnavailableException (LiveKit unreachable during the heal)
      // deliberately propagates as a 503 rather than being mapped to
      // hasActiveSession: false — the frontend gates Custom Trim on that
      // flag, and a transient LiveKit blip must not report a live buffer as
      // gone. A 503 lets the client keep its current state and retry.
      try {
        session = await this.recoverStaleSession(userId);
      } catch (error) {
        if (error instanceof NotFoundException) {
          return { hasActiveSession: false };
        }
        throw error;
      }
    }

    // Resolve relative segment path to full path
    const segmentDir = this.storageService.resolveSegmentPath(
      session.segmentPath,
    );
    const completeSegments =
      await this.replaySegmentsService.listCompleteSegments(segmentDir);

    if (completeSegments.length === 0) {
      return {
        hasActiveSession: true,
        sessionId: session.id,
        totalSegments: 0,
        totalDurationSeconds: 0,
      };
    }

    const totalDurationSeconds = completeSegments.length * 10; // Each segment is ~10 seconds

    return {
      hasActiveSession: true,
      sessionId: session.id,
      totalSegments: completeSegments.length,
      totalDurationSeconds,
      bufferStartTime: session.startedAt,
      bufferEndTime: new Date(), // Segments are being created in real-time
    };
  }

  /**
   * Get the HLS playlist content for the user's active session
   * Generates a valid m3u8 playlist that references all available segments
   *
   * @param userId - ID of the user
   * @returns m3u8 playlist content as string
   */
  async getPlaylistContent(userId: string): Promise<string> {
    const session = await this.databaseService.egressSession.findFirst({
      where: {
        userId,
        status: 'active',
      },
    });

    if (!session) {
      throw new NotFoundException(
        'No active replay found. Start screen sharing first.',
      );
    }

    // Resolve relative segment path to full path
    const segmentDir = this.storageService.resolveSegmentPath(
      session.segmentPath,
    );
    const completeSegments =
      await this.replaySegmentsService.listCompleteSegments(segmentDir);

    if (completeSegments.length === 0) {
      throw new BadRequestException(
        'Your replay is still warming up. Please wait a few seconds and try again.',
      );
    }

    // Generate m3u8 playlist with absolute segment URLs
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:EVENT', // Indicate this is a growing playlist
    ];

    for (const segment of completeSegments) {
      lines.push(`#EXTINF:10.0,`);
      // Use absolute URL that maps to our segment endpoint
      lines.push(`/api/livekit/replay/preview/segment/${segment.filename}`);
    }

    // Add ENDLIST to indicate this is the complete playlist for preview purposes
    // Without this, HLS.js may only load the last few segments thinking it's live
    lines.push('#EXT-X-ENDLIST');

    return lines.join('\n');
  }

  /**
   * Get a remuxed segment file path for HLS.js compatibility.
   * Delegates to ReplaySegmentsService (segment lifecycle lives there).
   *
   * @param userId - ID of the user
   * @param segmentFile - Filename of the segment
   * @returns Full path to the remuxed segment file
   */
  async getRemuxedSegmentPath(
    userId: string,
    segmentFile: string,
  ): Promise<string> {
    return this.replaySegmentsService.getRemuxedSegmentPath(
      userId,
      segmentFile,
    );
  }
}

// Clip library methods (getUserClips, getPublicClips, updateClip, deleteClip, shareClip)
// have been extracted to ClipLibraryService for better separation of concerns.
