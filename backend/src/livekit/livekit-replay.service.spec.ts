import { TestBed } from '@suites/unit';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CLIP_MESSAGE_CREATE } from '@/common/events/clip-message.events';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LivekitReplayService } from './livekit-replay.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { AudioCodec, EgressStatus } from 'livekit-server-sdk';
import { ThumbnailService } from '@/file/thumbnail.service';
import { FfmpegService } from './ffmpeg.service';
import { ReplaySegmentsService } from './replay-segments.service';
import { EGRESS_CLIENT } from './providers/egress-client.provider';
import { ROOM_SERVICE_CLIENT } from './providers/room-service.provider';
import { PermissionsService } from '@/roles/permissions.service';
import { RbacActions } from '@prisma/client';

describe('LivekitReplayService', () => {
  let service: LivekitReplayService;

  let databaseService: any;

  let storageService: any;

  let websocketService: any;

  let thumbnailService: any;

  let ffmpegService: any;

  let replaySegmentsService: any;

  let eventEmitter: any;
  let permissionsService: any;

  const mockEgressClient = {
    startTrackCompositeEgress: jest.fn(),
    stopEgress: jest.fn(),
    listEgress: jest.fn(),
  };

  const mockRoomServiceClient = {
    getParticipant: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const { unit, unitRef } = await TestBed.solitary(LivekitReplayService)
      .mock(EGRESS_CLIENT)
      .final(mockEgressClient)
      .mock(ROOM_SERVICE_CLIENT)
      .final(mockRoomServiceClient)
      .mock(ConfigService)
      .final({
        get: jest.fn().mockImplementation((key: string) => {
          const config: Record<string, string> = {
            LIVEKIT_URL: 'wss://test.livekit.io',
            LIVEKIT_API_KEY: 'test-api-key',
            LIVEKIT_API_SECRET: 'test-api-secret',
            REPLAY_SEGMENTS_PATH: '/app/storage/replay-segments',
            REPLAY_EGRESS_OUTPUT_PATH: '/out',
            REPLAY_CLIPS_PATH: '/app/uploads/replays',
            REPLAY_SEGMENT_CLEANUP_AGE_MINUTES: '20',
          };
          return config[key];
        }),
      })
      .compile();

    service = unit;
    databaseService = unitRef.get(DatabaseService);
    storageService = unitRef.get(StorageService);
    websocketService = unitRef.get(WebsocketService);

    thumbnailService = unitRef.get(ThumbnailService);
    ffmpegService = unitRef.get(FfmpegService);
    replaySegmentsService = unitRef.get(ReplaySegmentsService);
    eventEmitter = unitRef.get(EventEmitter2);
    permissionsService = unitRef.get(PermissionsService);
    // Default: the user may post files in the target channel
    permissionsService.userHasChannelActions.mockResolvedValue(true);

    // Set up default return values for StorageService
    storageService.getSegmentsPrefix.mockReturnValue(
      '/app/storage/replay-segments',
    );
    storageService.resolveSegmentPath.mockImplementation(
      (relativePath: string) => `/app/storage/replay-segments/${relativePath}`,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startReplayBuffer', () => {
    const startParams = {
      userId: 'user-123',
      channelId: 'channel-456',
      roomName: 'room-789',
      videoTrackId: 'video-track-1',
      audioTrackId: 'audio-track-1',
    };

    beforeEach(() => {
      databaseService.egressSession.findFirst.mockResolvedValue(null);
      mockEgressClient.startTrackCompositeEgress.mockResolvedValue({
        egressId: 'egress-123',
      });
      databaseService.egressSession.create.mockResolvedValue({
        id: 'session-1',
        egressId: 'egress-123',
        status: 'active',
      });
      storageService.deleteDirectory.mockResolvedValue(undefined);
    });

    it('should start new egress session', async () => {
      const result = await service.startReplayBuffer(startParams);

      expect(result.egressId).toBe('egress-123');
      expect(result.sessionId).toBe('session-1');
      expect(result.status).toBe('active');
      expect(mockEgressClient.startTrackCompositeEgress).toHaveBeenCalled();
      expect(databaseService.egressSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            channelId: 'channel-456',
            roomName: 'room-789',
            egressId: 'egress-123',
            status: 'active',
          }),
        }),
      );
    });

    it('should stop existing session before starting new one', async () => {
      const existingSession = {
        id: 'old-session',
        egressId: 'old-egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'old-session', // Relative path (just sessionId)
      };

      databaseService.egressSession.findFirst
        .mockResolvedValueOnce(existingSession) // For startReplayBuffer check
        .mockResolvedValueOnce(existingSession) // For stopReplayBuffer lookup
        .mockResolvedValueOnce(null); // After stop, for new start
      mockEgressClient.stopEgress.mockResolvedValue(undefined);
      databaseService.egressSession.update.mockResolvedValue({
        ...existingSession,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.startReplayBuffer(startParams);

      expect(mockEgressClient.stopEgress).toHaveBeenCalledWith(
        'old-egress-123',
      );
      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-session' },
          data: expect.objectContaining({
            status: 'stopped',
          }),
        }),
      );
    });

    it('should use AAC audio codec (not Opus) for HLS/MPEG-TS compatibility', async () => {
      const paramsWithIdentity = {
        ...startParams,
        participantIdentity: 'user-identity',
      };

      mockRoomServiceClient.getParticipant.mockResolvedValue({
        tracks: [
          {
            sid: 'video-track-1',
            type: 1, // TrackType.VIDEO
            width: 1920,
            height: 1080,
          },
        ],
      });

      await service.startReplayBuffer(paramsWithIdentity);

      expect(mockEgressClient.startTrackCompositeEgress).toHaveBeenCalledWith(
        'room-789',
        expect.objectContaining({ segments: expect.any(Object) }),
        expect.objectContaining({
          encodingOptions: expect.objectContaining({
            audioCodec: AudioCodec.AAC,
          }),
        }),
      );
    });

    it('should throw BadRequestException when egress client fails to start', async () => {
      mockEgressClient.startTrackCompositeEgress.mockRejectedValue(
        new Error('LiveKit connection failed'),
      );

      await expect(service.startReplayBuffer(startParams)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('stopReplayBuffer', () => {
    it('should stop active egress session', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);
      mockEgressClient.stopEgress.mockResolvedValue(undefined);
      databaseService.egressSession.update.mockResolvedValue({
        ...activeSession,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      const result = await service.stopReplayBuffer('user-123');

      expect(result.sessionId).toBe('session-1');
      expect(result.egressId).toBe('egress-123');
      expect(result.status).toBe('stopped');
      expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('egress-123');
      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: 'stopped',
          }),
        }),
      );
    });

    it('should throw NotFoundException when no active session', async () => {
      databaseService.egressSession.findFirst.mockResolvedValue(null);

      await expect(service.stopReplayBuffer('user-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle egress already stopped on LiveKit side', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);
      mockEgressClient.stopEgress.mockRejectedValue(
        new Error('egress does not exist'),
      );
      databaseService.egressSession.update.mockResolvedValue({
        ...activeSession,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      // Should still succeed and update database
      const result = await service.stopReplayBuffer('user-123');
      expect(result.status).toBe('stopped');
      expect(databaseService.egressSession.update).toHaveBeenCalled();
    });

    it('should tolerate "not active"-family stop errors (case-insensitive) and still clean up', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'session-1',
      };

      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);
      // Zombie-active row: the egress already completed on the LiveKit side
      mockEgressClient.stopEgress.mockRejectedValue(
        new Error('twirp error failed_precondition: Egress is not active'),
      );
      databaseService.egressSession.update.mockResolvedValue({
        ...activeSession,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      // Must not throw — otherwise the zombie row would block the next
      // screen-share start forever
      const result = await service.stopReplayBuffer('user-123');
      expect(result.status).toBe('stopped');
      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({ status: 'stopped' }),
        }),
      );
    });

    it('should throw BadRequestException for other egress stop failures', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);
      mockEgressClient.stopEgress.mockRejectedValue(
        new Error('Network timeout'),
      );

      await expect(service.stopReplayBuffer('user-123')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should cleanup segment directory after stopping', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);
      mockEgressClient.stopEgress.mockResolvedValue(undefined);
      databaseService.egressSession.update.mockResolvedValue({
        ...activeSession,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.stopReplayBuffer('user-123');

      // Now uses deleteSegmentDirectory with relative path
      expect(storageService.deleteSegmentDirectory).toHaveBeenCalledWith(
        'session-1',
        { recursive: true, force: true },
      );
    });
  });

  describe('handleVoiceUserLeft', () => {
    it('should stop the replay buffer for the user who left voice', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'session-1',
      };

      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);
      mockEgressClient.stopEgress.mockResolvedValue(undefined);
      databaseService.egressSession.update.mockResolvedValue({
        ...activeSession,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.handleVoiceUserLeft({
        userId: 'user-123',
        channelId: 'channel-1',
      });

      expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('egress-123');
    });

    it('should swallow NotFoundException when user has no active session', async () => {
      databaseService.egressSession.findFirst.mockResolvedValue(null);

      await expect(
        service.handleVoiceUserLeft({
          userId: 'user-123',
          channelId: 'channel-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('should not throw when stopping the buffer fails', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'egress-123',
        userId: 'user-123',
        status: 'active',
        segmentPath: 'session-1',
      };

      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);
      mockEgressClient.stopEgress.mockRejectedValue(
        new Error('Network timeout'),
      );

      await expect(
        service.handleVoiceUserLeft({
          userId: 'user-123',
          channelId: 'channel-1',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleEgressEnded', () => {
    it('should update session status to stopped on success', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-123',
        egressId: 'egress-123',
        channelId: 'channel-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findUnique.mockResolvedValue(session);
      databaseService.egressSession.update.mockResolvedValue({
        ...session,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.handleEgressEnded('egress-123', 'stopped');

      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: 'stopped',
          }),
        }),
      );
    });

    it('should update session status to failed on error', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-123',
        egressId: 'egress-123',
        channelId: 'channel-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findUnique.mockResolvedValue(session);
      databaseService.egressSession.update.mockResolvedValue({
        ...session,
        status: 'failed',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.handleEgressEnded(
        'egress-123',
        'failed',
        'Network timeout',
      );

      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: 'failed',
            error: 'Network timeout',
          }),
        }),
      );
    });

    it('should handle session not found', async () => {
      databaseService.egressSession.findUnique.mockResolvedValue(null);

      // Should not throw, just log warning
      await expect(
        service.handleEgressEnded('unknown-egress', 'stopped'),
      ).resolves.toBeUndefined();
    });

    it('should skip update if session already stopped', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-123',
        egressId: 'egress-123',
        status: 'stopped', // Already stopped
      };

      databaseService.egressSession.findUnique.mockResolvedValue(session);

      await service.handleEgressEnded('egress-123', 'stopped');

      // Should not call update
      expect(databaseService.egressSession.update).not.toHaveBeenCalled();
    });

    it('should send REPLAY_BUFFER_FAILED websocket event on failure', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-123',
        egressId: 'egress-123',
        channelId: 'channel-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findUnique.mockResolvedValue(session);
      databaseService.egressSession.update.mockResolvedValue({
        ...session,
        status: 'failed',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.handleEgressEnded('egress-123', 'failed', 'Codec error');

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.REPLAY_BUFFER_FAILED,
        expect.objectContaining({
          sessionId: 'session-1',
          egressId: 'egress-123',
          channelId: 'channel-1',
          error: 'Codec error',
        }),
      );
    });

    it('should send REPLAY_BUFFER_STOPPED websocket event on success', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-123',
        egressId: 'egress-123',
        channelId: 'channel-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findUnique.mockResolvedValue(session);
      databaseService.egressSession.update.mockResolvedValue({
        ...session,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.handleEgressEnded('egress-123', 'stopped');

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.REPLAY_BUFFER_STOPPED,
        expect.objectContaining({
          sessionId: 'session-1',
          egressId: 'egress-123',
          channelId: 'channel-1',
        }),
      );
    });

    it('should cleanup segment directory after handling', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-123',
        egressId: 'egress-123',
        channelId: 'channel-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
      };

      databaseService.egressSession.findUnique.mockResolvedValue(session);
      databaseService.egressSession.update.mockResolvedValue({
        ...session,
        status: 'stopped',
      });
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.handleEgressEnded('egress-123', 'stopped');

      // Now uses deleteSegmentDirectory with relative path
      expect(storageService.deleteSegmentDirectory).toHaveBeenCalledWith(
        'session-1',
        { recursive: true, force: true },
      );
    });
  });

  describe('getSessionInfo', () => {
    it('should return session info for active session with segments', async () => {
      const session = {
        id: 'session-1',
        egressId: 'egress-123',
        status: 'active',
        segmentPath: 'session-1', // Relative path
        startedAt: new Date('2025-01-01'),
      };

      databaseService.egressSession.findFirst.mockResolvedValue(session);
      // Segment listing/filtering is delegated to ReplaySegmentsService
      replaySegmentsService.listCompleteSegments.mockResolvedValue([
        {
          filename: '2025-01-01T000000-segment_00000.ts',
          sequence: 0,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000000-segment_00000.ts',
        },
        {
          filename: '2025-01-01T000010-segment_00001.ts',
          sequence: 1,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000010-segment_00001.ts',
        },
      ]);

      const result = await service.getSessionInfo('user-123');

      expect(result.hasActiveSession).toBe(true);
      expect(result.sessionId).toBe('session-1');
      expect(result.totalSegments).toBe(2);
      expect(result.totalDurationSeconds).toBe(20); // 2 segments * 10 seconds
      // Verify resolveSegmentPath was called with relative path
      expect(storageService.resolveSegmentPath).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should return inactive status when no session', async () => {
      databaseService.egressSession.findFirst.mockResolvedValue(null);

      const result = await service.getSessionInfo('user-123');

      expect(result.hasActiveSession).toBe(false);
      expect(result.sessionId).toBeUndefined();
    });

    it('should handle empty segment directory', async () => {
      const session = {
        id: 'session-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
        startedAt: new Date('2025-01-01'),
      };

      databaseService.egressSession.findFirst.mockResolvedValue(session);
      replaySegmentsService.listCompleteSegments.mockResolvedValue([]);

      const result = await service.getSessionInfo('user-123');

      expect(result.hasActiveSession).toBe(true);
      expect(result.totalSegments).toBe(0);
      expect(result.totalDurationSeconds).toBe(0);
    });

    it('should heal a stranded session and report it active when LiveKit says the egress is still running', async () => {
      const staleSession = {
        id: 'session-1',
        userId: 'user-123',
        channelId: 'channel-1',
        egressId: 'egress-123',
        status: 'stopped',
        error: null,
        segmentPath: 'session-1',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        endedAt: new Date(Date.now() - 60 * 1000),
      };

      databaseService.egressSession.findFirst
        .mockResolvedValueOnce(null) // active-session lookup misses
        .mockResolvedValueOnce(staleSession); // most-recent session lookup
      mockEgressClient.listEgress.mockResolvedValue([
        { status: EgressStatus.EGRESS_ACTIVE },
      ]);
      databaseService.egressSession.updateMany.mockResolvedValue({ count: 1 });
      replaySegmentsService.listCompleteSegments.mockResolvedValue([
        {
          filename: '2025-01-01T000000-segment_00000.ts',
          sequence: 0,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000000-segment_00000.ts',
        },
      ]);

      const result = await service.getSessionInfo('user-123');

      // The Custom Trim modal stays alive instead of showing "no session"
      expect(result.hasActiveSession).toBe(true);
      expect(result.sessionId).toBe('session-1');
      expect(result.totalSegments).toBe(1);
      expect(databaseService.egressSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', status: 'stopped' },
        data: { status: 'active', endedAt: null, error: null },
      });
    });

    it('should emit the missed stop event and report inactive when the egress is genuinely gone', async () => {
      const staleSession = {
        id: 'session-1',
        userId: 'user-123',
        channelId: 'channel-1',
        egressId: 'egress-123',
        status: 'stopped',
        error: null,
        segmentPath: 'session-1',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        endedAt: new Date(Date.now() - 60 * 1000),
      };

      databaseService.egressSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(staleSession);
      mockEgressClient.listEgress.mockResolvedValue([]); // Egress gone

      const result = await service.getSessionInfo('user-123');

      expect(result.hasActiveSession).toBe(false);
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.REPLAY_BUFFER_STOPPED,
        expect.objectContaining({
          sessionId: 'session-1',
          egressId: 'egress-123',
          channelId: 'channel-1',
        }),
      );
    });

    it('should propagate a 503 instead of reporting inactive when LiveKit cannot be checked during the heal', async () => {
      const staleSession = {
        id: 'session-1',
        userId: 'user-123',
        channelId: 'channel-1',
        egressId: 'egress-123',
        status: 'stopped',
        error: null,
        segmentPath: 'session-1',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        endedAt: new Date(Date.now() - 60 * 1000),
      };

      databaseService.egressSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(staleSession);
      mockEgressClient.listEgress.mockRejectedValue(
        new Error('LiveKit unreachable'),
      );

      // hasActiveSession: false would wrongly kill the Custom Trim UI for a
      // possibly-live buffer — a retryable 503 must surface instead
      await expect(service.getSessionInfo('user-123')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
      expect(databaseService.egressSession.updateMany).not.toHaveBeenCalled();
    });
  });

  // Clip library tests (getUserClips, getPublicClips, updateClip, deleteClip, shareClip)
  // have been moved to clip-library.service.spec.ts

  describe('getRemuxedSegmentPath', () => {
    it('should delegate to ReplaySegmentsService', async () => {
      replaySegmentsService.getRemuxedSegmentPath.mockResolvedValue(
        '/tmp/hls-remux-cache/user-123/segment_00001.ts',
      );

      const result = await service.getRemuxedSegmentPath(
        'user-123',
        'segment_00001.ts',
      );

      expect(replaySegmentsService.getRemuxedSegmentPath).toHaveBeenCalledWith(
        'user-123',
        'segment_00001.ts',
      );
      expect(result).toBe('/tmp/hls-remux-cache/user-123/segment_00001.ts');
    });
  });

  // Segment lifecycle tests (cleanupOldSegments, cleanupOrphanedSessions,
  // cleanupRemuxCache, listCompleteSegments, getSegmentPath, getRemuxedSegmentPath)
  // have been moved to replay-segments.service.spec.ts

  describe('captureReplay', () => {
    const userId = 'user-123';
    const dto = {
      durationMinutes: 1 as const,
      destination: 'library' as const,
    };

    beforeEach(() => {
      databaseService.egressSession.findFirst.mockResolvedValue({
        id: 'session-1',
        userId,
        channelId: 'channel-1',
        status: 'active',
        segmentPath: 'session-1',
      });
      // Segment listing/filtering is delegated to ReplaySegmentsService
      replaySegmentsService.listCompleteSegments.mockResolvedValue([
        {
          filename: '2025-01-01T000000-segment_00000.ts',
          sequence: 0,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000000-segment_00000.ts',
        },
        {
          filename: '2025-01-01T000010-segment_00001.ts',
          sequence: 1,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000010-segment_00001.ts',
        },
      ]);
      storageService.ensureDirectory.mockResolvedValue(undefined);
      ffmpegService.concatenateSegments.mockResolvedValue(undefined);
      ffmpegService.getVideoDuration.mockResolvedValue(20);
      storageService.getFileStats.mockResolvedValue({ size: 1024000 });
      storageService.createReadStream.mockReturnValue({
        on: jest.fn().mockImplementation(function (
          this: any,
          event: string,
          cb: (arg?: any) => void,
        ) {
          if (event === 'end') cb();
          return this;
        }),
      });
      databaseService.file.create.mockResolvedValue({
        id: 'file-1',
        filename: 'replay-123.mp4',
      });
      databaseService.replayClip.create.mockResolvedValue({
        id: 'clip-1',
      });
      thumbnailService.generateVideoThumbnail.mockResolvedValue(
        '/app/uploads/thumbnails/file-1.jpg',
      );
      databaseService.file.update.mockResolvedValue({});
    });

    it('should call generateVideoThumbnail after file creation', async () => {
      await service.captureReplay(userId, dto);

      expect(thumbnailService.generateVideoThumbnail).toHaveBeenCalledWith(
        expect.stringContaining('replay-'),
        'file-1',
      );
    });

    it('should update file record with thumbnailPath on success', async () => {
      await service.captureReplay(userId, dto);

      expect(databaseService.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { thumbnailPath: '/app/uploads/thumbnails/file-1.jpg' },
      });
    });

    it('should not fail captureReplay when thumbnail generation fails', async () => {
      thumbnailService.generateVideoThumbnail.mockRejectedValue(
        new Error('FFmpeg not found'),
      );

      // captureReplay should still succeed (error is logged, not thrown)
      const result = await service.captureReplay(userId, dto);

      expect(result.clipId).toBe('clip-1');
      expect(result.fileId).toBe('file-1');
    });

    it('should finish thumbnail generation before emitting the clip message event', async () => {
      const channelDto = {
        durationMinutes: 1 as const,
        destination: 'channel' as const,
        targetChannelId: 'target-channel-1',
      };
      databaseService.channel.findUnique.mockResolvedValue({
        id: 'target-channel-1',
        communityId: 'community-1',
      });
      databaseService.membership.findFirst.mockResolvedValue({
        id: 'membership-1',
        userId,
        communityId: 'community-1',
      });
      eventEmitter.emitAsync.mockResolvedValue([{ messageId: 'message-1' }]);

      const callOrder: string[] = [];
      databaseService.file.update.mockImplementation(() => {
        callOrder.push('thumbnail-saved');
        return Promise.resolve({});
      });
      eventEmitter.emitAsync.mockImplementation(() => {
        callOrder.push('message-emitted');
        return Promise.resolve([{ messageId: 'message-1' }]);
      });

      await service.captureReplay(userId, channelDto);

      // The broadcast message must carry hasThumbnail: true, so the
      // thumbnail has to be persisted before the message is created
      expect(callOrder).toEqual(['thumbnail-saved', 'message-emitted']);
    });

    it('should pass only complete segments (from ReplaySegmentsService) to FFmpeg', async () => {
      // ReplaySegmentsService already filtered out the incomplete segment_00000
      replaySegmentsService.listCompleteSegments.mockResolvedValue([
        {
          filename: '2025-01-01T000010-segment_00001.ts',
          sequence: 1,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000010-segment_00001.ts',
        },
        {
          filename: '2025-01-01T000020-segment_00002.ts',
          sequence: 2,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000020-segment_00002.ts',
        },
      ]);

      await service.captureReplay(userId, dto);

      // FFmpeg should only receive the 2 complete segments
      expect(ffmpegService.concatenateSegments).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('segment_00001.ts'),
          expect.stringContaining('segment_00002.ts'),
        ]),
        expect.any(String),
        undefined,
      );
      const segmentPaths = ffmpegService.concatenateSegments.mock.calls[0][0];
      expect(segmentPaths).toHaveLength(2);
      expect(segmentPaths[0]).not.toContain('segment_00000.ts');
    });

    it('should clamp custom range when end exceeds available buffer', async () => {
      // 5 segments available (50 seconds)
      replaySegmentsService.listCompleteSegments.mockResolvedValue(
        [0, 1, 2, 3, 4].map((sequence) => ({
          filename: `2025-01-01T0000${sequence}0-segment_0000${sequence}.ts`,
          sequence,
          path: `/app/storage/replay-segments/session-1/2025-01-01T0000${sequence}0-segment_0000${sequence}.ts`,
        })),
      );

      const customDto = {
        startSeconds: 10,
        endSeconds: 130, // Exceeds 50s buffer
        destination: 'library' as const,
      };

      const result = await service.captureReplay(userId, customDto);

      // Should succeed (clamped) instead of throwing
      expect(result.clipId).toBe('clip-1');
      // Verify FFmpeg was called (meaning it didn't throw)
      expect(ffmpegService.concatenateSegments).toHaveBeenCalled();
    });

    it('should throw when no complete segments are available', async () => {
      // All segments are incomplete (< 10KB), so listCompleteSegments returns empty
      replaySegmentsService.listCompleteSegments.mockResolvedValue([]);

      const customDto = {
        startSeconds: 0,
        endSeconds: 10,
        destination: 'library' as const,
      };

      await expect(service.captureReplay(userId, customDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when start time is after end time', async () => {
      const customDto = {
        startSeconds: 30,
        endSeconds: 10,
        destination: 'library' as const,
      };

      await expect(service.captureReplay(userId, customDto)).rejects.toThrow(
        'Start time must be before end time',
      );
    });

    describe('stale session recovery', () => {
      // Ended recently — within the 24h notify window
      const staleSession = {
        id: 'session-1',
        userId,
        channelId: 'channel-1',
        egressId: 'egress-123',
        status: 'stopped',
        error: null,
        segmentPath: 'session-1',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        endedAt: new Date(Date.now() - 60 * 1000),
      };

      it('should heal the session and proceed when LiveKit says the egress is still running', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null) // active-session lookup misses
          .mockResolvedValueOnce(staleSession); // most-recent session lookup
        mockEgressClient.listEgress.mockResolvedValue([
          { status: EgressStatus.EGRESS_ACTIVE },
        ]);
        databaseService.egressSession.updateMany.mockResolvedValue({
          count: 1,
        });

        const result = await service.captureReplay(userId, dto);

        expect(result.clipId).toBe('clip-1');
        // Compare-and-swap on the status we read, not a blind update
        expect(databaseService.egressSession.updateMany).toHaveBeenCalledWith({
          where: { id: 'session-1', status: 'stopped' },
          data: { status: 'active', endedAt: null, error: null },
        });
        expect(websocketService.sendToRoom).not.toHaveBeenCalled();
      });

      it('should heal the session when LiveKit says the egress is starting', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(staleSession);
        mockEgressClient.listEgress.mockResolvedValue([
          { status: EgressStatus.EGRESS_STARTING },
        ]);
        databaseService.egressSession.updateMany.mockResolvedValue({
          count: 1,
        });

        const result = await service.captureReplay(userId, dto);

        expect(result.clipId).toBe('clip-1');
        expect(databaseService.egressSession.updateMany).toHaveBeenCalledWith({
          where: { id: 'session-1', status: 'stopped' },
          data: { status: 'active', endedAt: null, error: null },
        });
      });

      it('should NOT heal when LiveKit says the egress is ending', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(staleSession);
        mockEgressClient.listEgress.mockResolvedValue([
          { status: EgressStatus.EGRESS_ENDING },
        ]);

        await expect(service.captureReplay(userId, dto)).rejects.toThrow(
          'Your replay recording has ended — start screen sharing again to capture.',
        );

        // No resurrect attempt for a winding-down egress
        expect(databaseService.egressSession.updateMany).not.toHaveBeenCalled();
        expect(websocketService.sendToRoom).toHaveBeenCalledWith(
          'user:user-123',
          ServerEvents.REPLAY_BUFFER_STOPPED,
          expect.any(Object),
        );
      });

      it('should consult LiveKit before attempting any resurrect update', async () => {
        const callOrder: string[] = [];
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(staleSession);
        mockEgressClient.listEgress.mockImplementation(() => {
          callOrder.push('listEgress');
          return Promise.resolve([{ status: EgressStatus.EGRESS_ACTIVE }]);
        });
        databaseService.egressSession.updateMany.mockImplementation(() => {
          callOrder.push('updateMany');
          return Promise.resolve({ count: 1 });
        });

        await service.captureReplay(userId, dto);

        expect(callOrder).toEqual(['listEgress', 'updateMany']);
      });

      it('should fall through to the ended path when the resurrect CAS loses the race', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(staleSession);
        mockEgressClient.listEgress.mockResolvedValue([
          { status: EgressStatus.EGRESS_ACTIVE },
        ]);
        // Row status changed between our read and the update (webhook or
        // another replica) — CAS matches nothing
        databaseService.egressSession.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(service.captureReplay(userId, dto)).rejects.toThrow(
          NotFoundException,
        );

        // Capture must not proceed on a lost CAS
        expect(ffmpegService.concatenateSegments).not.toHaveBeenCalled();
        expect(databaseService.replayClip.create).not.toHaveBeenCalled();
      });

      it('should emit REPLAY_BUFFER_STOPPED and throw an accurate 404 when the egress is gone', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(staleSession);
        mockEgressClient.listEgress.mockResolvedValue([]); // Egress gone

        await expect(service.captureReplay(userId, dto)).rejects.toThrow(
          'Your replay recording has ended — start screen sharing again to capture.',
        );

        expect(websocketService.sendToRoom).toHaveBeenCalledWith(
          'user:user-123',
          ServerEvents.REPLAY_BUFFER_STOPPED,
          expect.objectContaining({
            sessionId: 'session-1',
            egressId: 'egress-123',
            channelId: 'channel-1',
          }),
        );
        expect(databaseService.egressSession.updateMany).not.toHaveBeenCalled();
      });

      it('should skip the stop event and throw the generic 404 when the session ended more than 24h ago', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...staleSession,
            startedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
            endedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
          });
        mockEgressClient.listEgress.mockResolvedValue([]);

        await expect(service.captureReplay(userId, dto)).rejects.toThrow(
          'No active replay found. Start screen sharing first.',
        );

        // No phantom "Replay ended" toast for ancient sessions (stale tabs)
        expect(websocketService.sendToRoom).not.toHaveBeenCalled();
      });

      it('should emit REPLAY_BUFFER_FAILED when the stale session had failed', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...staleSession,
            status: 'failed',
            error: 'Codec error',
          });
        mockEgressClient.listEgress.mockResolvedValue([]);

        await expect(service.captureReplay(userId, dto)).rejects.toThrow(
          NotFoundException,
        );

        expect(websocketService.sendToRoom).toHaveBeenCalledWith(
          'user:user-123',
          ServerEvents.REPLAY_BUFFER_FAILED,
          expect.objectContaining({
            sessionId: 'session-1',
            error: 'Codec error',
          }),
        );
      });

      it('should throw a retryable 503 when listEgress itself fails, without emitting or touching the row', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(staleSession);
        mockEgressClient.listEgress.mockRejectedValue(
          new Error('LiveKit unreachable'),
        );

        const promise = service.captureReplay(userId, dto);
        await expect(promise).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        await expect(promise).rejects.toThrow(
          'Could not check your replay status — please try again.',
        );

        // LiveKit unreachable means the recording may still be alive —
        // no "ended" event, no DB state change
        expect(websocketService.sendToRoom).not.toHaveBeenCalled();
        expect(databaseService.egressSession.update).not.toHaveBeenCalled();
        expect(databaseService.egressSession.updateMany).not.toHaveBeenCalled();
      });

      it('should throw the generic 404 when the user has no sessions at all', async () => {
        databaseService.egressSession.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null);

        await expect(service.captureReplay(userId, dto)).rejects.toThrow(
          'No active replay found. Start screen sharing first.',
        );

        expect(websocketService.sendToRoom).not.toHaveBeenCalled();
        expect(mockEgressClient.listEgress).not.toHaveBeenCalled();
      });
    });

    describe('destination authorization', () => {
      it('should throw ForbiddenException when the user may not post files in the channel (non-member, private, read-only, timed out)', async () => {
        const channelDto = {
          durationMinutes: 1 as const,
          destination: 'channel' as const,
          targetChannelId: 'target-channel-1',
        };

        // Channel exists and belongs to a community
        databaseService.channel.findUnique.mockResolvedValue({
          id: 'target-channel-1',
          communityId: 'community-1',
        });
        permissionsService.userHasChannelActions.mockResolvedValue(false);

        await expect(service.captureReplay(userId, channelDto)).rejects.toThrow(
          ForbiddenException,
        );
        expect(permissionsService.userHasChannelActions).toHaveBeenCalledWith(
          userId,
          'target-channel-1',
          [RbacActions.CREATE_MESSAGE, RbacActions.ATTACH_FILES],
        );
      });

      it('should throw NotFoundException when posting to nonexistent channel', async () => {
        const channelDto = {
          durationMinutes: 1 as const,
          destination: 'channel' as const,
          targetChannelId: 'nonexistent-channel',
        };

        databaseService.channel.findUnique.mockResolvedValue(null);

        await expect(service.captureReplay(userId, channelDto)).rejects.toThrow(
          NotFoundException,
        );
      });

      it('should throw ForbiddenException when posting to DM without group membership', async () => {
        const dmDto = {
          durationMinutes: 1 as const,
          destination: 'dm' as const,
          targetDirectMessageGroupId: 'dm-group-1',
        };

        // User is NOT a member of the DM group
        databaseService.directMessageGroupMember.findFirst.mockResolvedValue(
          null,
        );

        await expect(service.captureReplay(userId, dmDto)).rejects.toThrow(
          ForbiddenException,
        );
      });

      it('should succeed when user may post files in the channel', async () => {
        const channelDto = {
          durationMinutes: 1 as const,
          destination: 'channel' as const,
          targetChannelId: 'target-channel-1',
        };

        // Channel exists
        databaseService.channel.findUnique.mockResolvedValue({
          id: 'target-channel-1',
          communityId: 'community-1',
        });
        // User IS a member
        databaseService.membership.findFirst.mockResolvedValue({
          id: 'membership-1',
          userId,
          communityId: 'community-1',
        });
        // Mock the clip-message domain event handled by the messages module
        eventEmitter.emitAsync.mockResolvedValue([{ messageId: 'message-1' }]);

        const result = await service.captureReplay(userId, channelDto);

        expect(result.clipId).toBe('clip-1');
        expect(result.messageId).toBe('message-1');
        expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
          CLIP_MESSAGE_CREATE,
          expect.objectContaining({
            authorId: userId,
            destination: 'channel',
            targetChannelId: 'target-channel-1',
          }),
        );
      });

      it('should succeed when user is a DM group member', async () => {
        const dmDto = {
          durationMinutes: 1 as const,
          destination: 'dm' as const,
          targetDirectMessageGroupId: 'dm-group-1',
        };

        // User IS a member of the DM group
        databaseService.directMessageGroupMember.findFirst.mockResolvedValue({
          id: 'dm-member-1',
          groupId: 'dm-group-1',
          userId,
        });
        // Mock the clip-message domain event handled by the messages module
        eventEmitter.emitAsync.mockResolvedValue([{ messageId: 'message-2' }]);

        const result = await service.captureReplay(userId, dmDto);

        expect(result.clipId).toBe('clip-1');
        expect(result.messageId).toBe('message-2');
        expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
          CLIP_MESSAGE_CREATE,
          expect.objectContaining({
            authorId: userId,
            destination: 'dm',
            targetDirectMessageGroupId: 'dm-group-1',
          }),
        );
      });
    });
  });

  describe('reconcileEgressStatus', () => {
    const missingSession = {
      id: 'session-1',
      egressId: 'missing-egress',
      userId: 'user-123',
      channelId: 'channel-1',
      status: 'active',
    };

    it('should not act on the first listEgress miss (two-strikes rule)', async () => {
      databaseService.egressSession.findMany.mockResolvedValue([
        missingSession,
      ]);
      mockEgressClient.listEgress.mockResolvedValue([]); // Egress not found

      await service.reconcileEgressStatus();

      // A single empty response can be a transient blip — flipping the row
      // and emitting here would kill the capture button for a live share
      expect(databaseService.egressSession.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();
    });

    it('should mark stopped and emit REPLAY_BUFFER_STOPPED on the second consecutive miss', async () => {
      databaseService.egressSession.findMany.mockResolvedValue([
        missingSession,
      ]);
      mockEgressClient.listEgress.mockResolvedValue([]); // Egress not found

      await service.reconcileEgressStatus(); // first miss — strike only
      await service.reconcileEgressStatus(); // second miss — act

      expect(databaseService.egressSession.update).toHaveBeenCalledTimes(1);
      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: 'stopped',
          }),
        }),
      );
      // Without this event the frontend keeps showing the capture button
      // and every capture attempt 404s (issue #302)
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.REPLAY_BUFFER_STOPPED,
        expect.objectContaining({
          sessionId: 'session-1',
          egressId: 'missing-egress',
          channelId: 'channel-1',
        }),
      );
    });

    it('should clear the strike when the egress reappears between passes', async () => {
      databaseService.egressSession.findMany.mockResolvedValue([
        missingSession,
      ]);
      mockEgressClient.listEgress
        .mockResolvedValueOnce([]) // miss #1 — strike
        .mockResolvedValueOnce([{ status: EgressStatus.EGRESS_ACTIVE }]) // found again — strike cleared
        .mockResolvedValueOnce([]); // isolated miss — strike #1 again, no action

      await service.reconcileEgressStatus();
      await service.reconcileEgressStatus();
      await service.reconcileEgressStatus();

      expect(databaseService.egressSession.update).not.toHaveBeenCalled();
      expect(websocketService.sendToRoom).not.toHaveBeenCalled();

      // A fourth pass with a second consecutive miss finally acts
      mockEgressClient.listEgress.mockResolvedValueOnce([]);
      await service.reconcileEgressStatus();

      expect(databaseService.egressSession.update).toHaveBeenCalledTimes(1);
    });

    it('should update session when LiveKit shows failed status', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'failed-egress',
        status: 'active',
      };

      databaseService.egressSession.findMany.mockResolvedValue([activeSession]);
      mockEgressClient.listEgress.mockResolvedValue([
        { status: EgressStatus.EGRESS_FAILED },
      ]);

      await service.reconcileEgressStatus();

      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });

    it('should not update when status matches', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'active-egress',
        status: 'active',
      };

      databaseService.egressSession.findMany.mockResolvedValue([activeSession]);
      mockEgressClient.listEgress.mockResolvedValue([
        { status: EgressStatus.EGRESS_ACTIVE },
      ]);

      await service.reconcileEgressStatus();

      expect(databaseService.egressSession.update).not.toHaveBeenCalled();
    });

    it('should skip a pass while a previous one is still in flight, then run again after it settles', async () => {
      databaseService.egressSession.findMany.mockResolvedValue([
        {
          id: 'session-1',
          egressId: 'active-egress',
          userId: 'user-123',
          channelId: 'channel-1',
          status: 'active',
        },
      ]);

      // Deferred listEgress keeps the first pass hanging mid-reconcile
      // (the bootstrap fire-and-forget vs cron overlap scenario)
      let resolveListEgress!: (value: unknown[]) => void;
      mockEgressClient.listEgress.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveListEgress = resolve;
        }),
      );

      const firstPass = service.reconcileEgressStatus();
      // Let the first pass advance to the in-flight listEgress await
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockEgressClient.listEgress).toHaveBeenCalledTimes(1);

      // Second concurrent invocation must bail out immediately
      await service.reconcileEgressStatus();
      expect(databaseService.egressSession.findMany).toHaveBeenCalledTimes(1);
      expect(mockEgressClient.listEgress).toHaveBeenCalledTimes(1);

      resolveListEgress([{ status: EgressStatus.EGRESS_ACTIVE }]);
      await firstPass;

      // Guard released — a later pass reconciles again
      mockEgressClient.listEgress.mockResolvedValue([
        { status: EgressStatus.EGRESS_ACTIVE },
      ]);
      await service.reconcileEgressStatus();
      expect(databaseService.egressSession.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('streamReplay', () => {
    const userId = 'user-123';
    const activeSession = {
      id: 'session-1',
      userId,
      channelId: 'channel-1',
      egressId: 'egress-123',
      status: 'active',
      error: null,
      segmentPath: 'session-1',
      startedAt: new Date('2025-01-01'),
    };

    beforeEach(() => {
      replaySegmentsService.listCompleteSegments.mockResolvedValue([
        {
          filename: '2025-01-01T000000-segment_00000.ts',
          sequence: 0,
          path: '/app/storage/replay-segments/session-1/2025-01-01T000000-segment_00000.ts',
        },
      ]);
      ffmpegService.concatenateSegments.mockResolvedValue(undefined);
    });

    it('should stream from an active session', async () => {
      databaseService.egressSession.findFirst.mockResolvedValue(activeSession);

      const result = await service.streamReplay(userId, 1);

      expect(result).toContain('replay-stream-user-123');
      expect(ffmpegService.concatenateSegments).toHaveBeenCalled();
    });

    it('should heal the session and stream when LiveKit says the egress is still running', async () => {
      databaseService.egressSession.findFirst
        .mockResolvedValueOnce(null) // active-session lookup misses
        .mockResolvedValueOnce({ ...activeSession, status: 'stopped' });
      mockEgressClient.listEgress.mockResolvedValue([
        { status: EgressStatus.EGRESS_ACTIVE },
      ]);
      databaseService.egressSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.streamReplay(userId, 1);

      expect(result).toContain('replay-stream-user-123');
      expect(databaseService.egressSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', status: 'stopped' },
        data: { status: 'active', endedAt: null, error: null },
      });
    });

    it('should emit REPLAY_BUFFER_STOPPED and throw an accurate 404 when the egress is gone', async () => {
      databaseService.egressSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...activeSession,
          status: 'stopped',
          endedAt: new Date(Date.now() - 60 * 1000),
        });
      mockEgressClient.listEgress.mockResolvedValue([]);

      await expect(service.streamReplay(userId, 1)).rejects.toThrow(
        'Your replay recording has ended — start screen sharing again to capture.',
      );

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        'user:user-123',
        ServerEvents.REPLAY_BUFFER_STOPPED,
        expect.objectContaining({
          sessionId: 'session-1',
          egressId: 'egress-123',
          channelId: 'channel-1',
        }),
      );
    });
  });

  describe('onApplicationBootstrap', () => {
    it('should run egress reconciliation once at startup', () => {
      const reconcileSpy = jest
        .spyOn(service, 'reconcileEgressStatus')
        .mockResolvedValue(undefined);

      service.onApplicationBootstrap();

      expect(reconcileSpy).toHaveBeenCalledTimes(1);
    });

    it('should not await reconciliation, so a hung LiveKit cannot block boot', () => {
      // Never-resolving promise — if bootstrap awaited it, this test would
      // time out (and in production app.listen() would never be reached,
      // failing k8s startup probes)
      const reconcileSpy = jest
        .spyOn(service, 'reconcileEgressStatus')
        .mockReturnValue(new Promise(() => {}));

      const result = service.onApplicationBootstrap();

      expect(result).toBeUndefined();
      expect(reconcileSpy).toHaveBeenCalledTimes(1);
    });

    it('should not throw or leave an unhandled rejection when startup reconciliation fails', async () => {
      jest
        .spyOn(service, 'reconcileEgressStatus')
        .mockRejectedValue(new Error('LiveKit down'));

      expect(() => service.onApplicationBootstrap()).not.toThrow();

      // Flush the microtask queue so the .catch handler runs (an unhandled
      // rejection here would fail the test run)
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});
