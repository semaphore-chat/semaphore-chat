import { TestBed } from '@suites/unit';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LivekitReplayService } from './livekit-replay.service';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@kraken/shared';
import { AudioCodec, EgressStatus } from 'livekit-server-sdk';
import { ThumbnailService } from '@/file/thumbnail.service';
import { FfmpegService } from './ffmpeg.service';
import { EGRESS_CLIENT } from './providers/egress-client.provider';
import { ROOM_SERVICE_CLIENT } from './providers/room-service.provider';

// Mock fluent-ffmpeg
const mockFfmpegCommand = {
  input: jest.fn().mockReturnThis(),
  outputOptions: jest.fn().mockReturnThis(),
  output: jest.fn().mockReturnThis(),
  on: jest.fn().mockImplementation(function (
    this: typeof mockFfmpegCommand,
    event: string,
    cb: () => void,
  ) {
    if (event === 'end') {
      (this as { _endCb?: () => void })._endCb = cb;
    }
    return this;
  }),
  run: jest.fn().mockImplementation(function (this: typeof mockFfmpegCommand) {
    const self = this as { _endCb?: () => void };
    if (self._endCb) self._endCb();
  }),
};
jest.mock('fluent-ffmpeg', () => {
  return jest.fn(() => mockFfmpegCommand);
});

describe('LivekitReplayService', () => {
  let service: LivekitReplayService;

  let databaseService: any;

  let storageService: any;

  let websocketService: any;

  let thumbnailService: any;

  let ffmpegService: any;

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
        'user-123',
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
        'user-123',
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
      // listFiles is called with the resolved path (via listAndSortSegments)
      storageService.listFiles.mockResolvedValue([
        '2025-01-01T000000-segment_00000.ts',
        '2025-01-01T000010-segment_00001.ts',
      ]);
      storageService.getFileStats
        .mockResolvedValueOnce({ size: 50000 }) // Complete segment
        .mockResolvedValueOnce({ size: 50000 }); // Complete segment

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

    it('should filter out incomplete segments', async () => {
      const session = {
        id: 'session-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
        startedAt: new Date('2025-01-01'),
      };

      databaseService.egressSession.findFirst.mockResolvedValue(session);
      storageService.listFiles.mockResolvedValue([
        '2025-01-01T000000-segment_00000.ts',
        '2025-01-01T000010-segment_00001.ts',
      ]);
      storageService.getFileStats
        .mockResolvedValueOnce({ size: 50000 }) // Complete
        .mockResolvedValueOnce({ size: 1000 }); // Incomplete (< 10KB)

      const result = await service.getSessionInfo('user-123');

      expect(result.totalSegments).toBe(1); // Only 1 complete segment
      expect(result.totalDurationSeconds).toBe(10);
    });

    it('should handle empty segment directory', async () => {
      const session = {
        id: 'session-1',
        status: 'active',
        segmentPath: 'session-1', // Relative path
        startedAt: new Date('2025-01-01'),
      };

      databaseService.egressSession.findFirst.mockResolvedValue(session);
      storageService.listFiles.mockResolvedValue([]);

      const result = await service.getSessionInfo('user-123');

      expect(result.hasActiveSession).toBe(true);
      expect(result.totalSegments).toBe(0);
      expect(result.totalDurationSeconds).toBe(0);
    });
  });

  // Clip library tests (getUserClips, getPublicClips, updateClip, deleteClip, shareClip)
  // have been moved to clip-library.service.spec.ts

  describe('getRemuxedSegmentPath', () => {
    const userId = 'user-123';
    const segmentFile = 'segment_00001.ts';

    beforeEach(() => {
      databaseService.egressSession.findFirst.mockResolvedValue({
        id: 'session-1',
        userId,
        status: 'active',
        segmentPath: 'session-1',
      });
      storageService.ensureDirectory.mockResolvedValue(undefined);
      // First call: original segment exists (getSegmentPath check)
      // Second call: remuxed cache doesn't exist yet
      storageService.fileExists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      storageService.getFileStats.mockResolvedValue({ size: 50000 });
    });

    it('should pass -copyts to FFmpeg to preserve segment timestamps', async () => {
      await service.getRemuxedSegmentPath(userId, segmentFile);

      expect(mockFfmpegCommand.outputOptions).toHaveBeenCalledWith(
        expect.arrayContaining(['-copyts']),
      );
    });

    it('should pass all required output options', async () => {
      await service.getRemuxedSegmentPath(userId, segmentFile);

      expect(mockFfmpegCommand.outputOptions).toHaveBeenCalledWith([
        '-c copy',
        '-f mpegts',
        '-copyts',
      ]);
    });

    it('should return cached path if already remuxed', async () => {
      storageService.fileExists
        .mockReset()
        .mockResolvedValueOnce(true) // original exists
        .mockResolvedValueOnce(true); // cache exists

      const result = await service.getRemuxedSegmentPath(userId, segmentFile);

      expect(result).toContain(segmentFile);
      expect(mockFfmpegCommand.outputOptions).not.toHaveBeenCalled();
    });

    it('should return original path for incomplete segments', async () => {
      storageService.fileExists
        .mockReset()
        .mockResolvedValueOnce(true) // original exists
        .mockResolvedValueOnce(false); // cache doesn't exist
      storageService.getFileStats.mockResolvedValue({ size: 500 });

      const result = await service.getRemuxedSegmentPath(userId, segmentFile);

      // Should return the original path (resolved from segmentPath)
      expect(result).toContain('session-1');
      expect(mockFfmpegCommand.outputOptions).not.toHaveBeenCalled();
    });

    it('should return original path when remux fails', async () => {
      storageService.fileExists
        .mockReset()
        .mockResolvedValueOnce(true) // original exists
        .mockResolvedValueOnce(false); // cache doesn't exist
      mockFfmpegCommand.on.mockImplementation(function (
        this: typeof mockFfmpegCommand,
        event: string,
        cb: (err?: Error) => void,
      ) {
        if (event === 'error') {
          (this as { _errorCb?: (err: Error) => void })._errorCb = cb;
        }
        return this;
      });
      mockFfmpegCommand.run.mockImplementation(function (
        this: typeof mockFfmpegCommand,
      ) {
        const self = this as { _errorCb?: (err: Error) => void };
        if (self._errorCb) self._errorCb(new Error('FFmpeg failed'));
      });

      const result = await service.getRemuxedSegmentPath(userId, segmentFile);

      // Falls back to original path
      expect(result).toContain('session-1');

      // Restore default mock behavior for other tests
      mockFfmpegCommand.on.mockImplementation(function (
        this: typeof mockFfmpegCommand,
        event: string,
        cb: () => void,
      ) {
        if (event === 'end') {
          (this as { _endCb?: () => void })._endCb = cb;
        }
        return this;
      });
      mockFfmpegCommand.run.mockImplementation(function (
        this: typeof mockFfmpegCommand,
      ) {
        const self = this as { _endCb?: () => void };
        if (self._endCb) self._endCb();
      });
    });
  });

  describe('cleanupOldSegments', () => {
    it('should delete old segment files from active sessions', async () => {
      const activeSessions = [
        {
          id: 'session-1',
          segmentPath: 'session-1', // Relative path
          status: 'active',
        },
      ];

      databaseService.egressSession.findMany.mockResolvedValue(activeSessions);
      storageService.segmentDirectoryExists.mockResolvedValue(true);
      storageService.deleteOldFiles.mockResolvedValue(5);

      await service.cleanupOldSegments();

      // deleteOldFiles is called with resolved path
      expect(storageService.deleteOldFiles).toHaveBeenCalledWith(
        '/app/storage/replay-segments/session-1',
        expect.any(Date),
      );
      expect(storageService.resolveSegmentPath).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should skip non-existent directories', async () => {
      const activeSessions = [
        {
          id: 'session-1',
          segmentPath: 'missing', // Relative path
          status: 'active',
        },
      ];

      databaseService.egressSession.findMany.mockResolvedValue(activeSessions);
      storageService.segmentDirectoryExists.mockResolvedValue(false);

      await service.cleanupOldSegments();

      expect(storageService.deleteOldFiles).not.toHaveBeenCalled();
    });

    it('should handle deletion failure gracefully', async () => {
      const activeSessions = [
        {
          id: 'session-1',
          segmentPath: 'session-1', // Relative path
          status: 'active',
        },
      ];

      databaseService.egressSession.findMany.mockResolvedValue(activeSessions);
      storageService.segmentDirectoryExists.mockResolvedValue(true);
      storageService.deleteOldFiles.mockRejectedValue(
        new Error('Permission denied'),
      );

      // Should not throw
      await expect(service.cleanupOldSegments()).resolves.toBeUndefined();
    });
  });

  describe('cleanupOrphanedSessions', () => {
    it('should cleanup sessions older than 3 hours', async () => {
      const oldSession = {
        id: 'old-session',
        egressId: 'old-egress',
        segmentPath: 'old-session', // Relative path
        status: 'active',
        startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
      };

      databaseService.egressSession.findMany.mockResolvedValue([oldSession]);
      mockEgressClient.stopEgress.mockResolvedValue(undefined);
      databaseService.egressSession.update.mockResolvedValue({
        ...oldSession,
        status: 'stopped',
      });
      storageService.segmentDirectoryExists.mockResolvedValue(true);
      storageService.deleteSegmentDirectory.mockResolvedValue(undefined);

      await service.cleanupOrphanedSessions();

      expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('old-egress');
      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-session' },
          data: expect.objectContaining({
            status: 'stopped',
          }),
        }),
      );
      // Now uses deleteSegmentDirectory with relative path
      expect(storageService.deleteSegmentDirectory).toHaveBeenCalledWith(
        'old-session',
        { recursive: true, force: true },
      );
    });

    it('should handle egress already stopped', async () => {
      const oldSession = {
        id: 'old-session',
        egressId: 'old-egress',
        segmentPath: 'old-session', // Relative path
        status: 'active',
        startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      };

      databaseService.egressSession.findMany.mockResolvedValue([oldSession]);
      mockEgressClient.stopEgress.mockRejectedValue(
        new Error('Egress not found'),
      );
      databaseService.egressSession.update.mockResolvedValue({
        ...oldSession,
        status: 'stopped',
      });
      storageService.segmentDirectoryExists.mockResolvedValue(false);

      // Should still cleanup DB record
      await service.cleanupOrphanedSessions();

      expect(databaseService.egressSession.update).toHaveBeenCalled();
    });
  });

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
      storageService.listFiles.mockResolvedValue([
        '2025-01-01T000000-segment_00000.ts',
        '2025-01-01T000010-segment_00001.ts',
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

      // Allow the fire-and-forget async to settle
      await new Promise((r) => setImmediate(r));

      expect(thumbnailService.generateVideoThumbnail).toHaveBeenCalledWith(
        expect.stringContaining('replay-'),
        'file-1',
      );
    });

    it('should update file record with thumbnailPath on success', async () => {
      await service.captureReplay(userId, dto);

      // Allow the fire-and-forget async to settle
      await new Promise((r) => setImmediate(r));

      expect(databaseService.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { thumbnailPath: '/app/uploads/thumbnails/file-1.jpg' },
      });
    });

    it('should not fail captureReplay when thumbnail generation fails', async () => {
      thumbnailService.generateVideoThumbnail.mockRejectedValue(
        new Error('FFmpeg not found'),
      );

      // captureReplay should still succeed
      const result = await service.captureReplay(userId, dto);

      expect(result.clipId).toBe('clip-1');
      expect(result.fileId).toBe('file-1');

      // Allow the fire-and-forget async to settle (error is logged, not thrown)
      await new Promise((r) => setImmediate(r));
    });

    it('should exclude incomplete segments (< 10KB) from capture', async () => {
      storageService.listFiles.mockResolvedValue([
        '2025-01-01T000000-segment_00000.ts',
        '2025-01-01T000010-segment_00001.ts',
        '2025-01-01T000020-segment_00002.ts',
      ]);
      // First segment is incomplete (< 10KB), others are complete
      // getFileStats is called: once per segment in listCompleteSegments, then again for file stats after FFmpeg
      storageService.getFileStats
        .mockResolvedValueOnce({ size: 500 }) // segment 0: incomplete
        .mockResolvedValueOnce({ size: 50000 }) // segment 1: complete
        .mockResolvedValueOnce({ size: 50000 }) // segment 2: complete
        .mockResolvedValue({ size: 1024000 }); // subsequent calls for file stats

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
      storageService.listFiles.mockResolvedValue([
        '2025-01-01T000000-segment_00000.ts',
        '2025-01-01T000010-segment_00001.ts',
        '2025-01-01T000020-segment_00002.ts',
        '2025-01-01T000030-segment_00003.ts',
        '2025-01-01T000040-segment_00004.ts',
      ]);
      storageService.getFileStats.mockResolvedValue({ size: 50000 });

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

    it('should throw when all segments are incomplete', async () => {
      storageService.listFiles.mockResolvedValue([
        '2025-01-01T000000-segment_00000.ts',
      ]);
      // All segments are incomplete (< 10KB), so listCompleteSegments returns empty
      storageService.getFileStats.mockResolvedValue({ size: 500 });

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
  });

  describe('reconcileEgressStatus', () => {
    it('should update session when egress not found in LiveKit', async () => {
      const activeSession = {
        id: 'session-1',
        egressId: 'missing-egress',
        status: 'active',
      };

      databaseService.egressSession.findMany.mockResolvedValue([activeSession]);
      mockEgressClient.listEgress.mockResolvedValue([]); // Egress not found

      await service.reconcileEgressStatus();

      expect(databaseService.egressSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: 'stopped',
          }),
        }),
      );
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
  });
});
