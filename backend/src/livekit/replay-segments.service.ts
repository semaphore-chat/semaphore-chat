import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EgressClient } from 'livekit-server-sdk';
import { DatabaseService } from '@/database/database.service';
import { StorageService } from '@/storage/storage.service';
import { FileStats } from '@/storage/interfaces/storage-provider.interface';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { RoomName } from '@/common/utils/room-name.util';
import { getErrorMessage } from '@/common/utils/error.utils';
import * as ffmpegModule from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import * as path from 'path';
import { EGRESS_CLIENT } from './providers/egress-client.provider';

/**
 * Handles replay buffer segment lifecycle: discovery/listing of HLS segments
 * on disk, serving segment paths (with HLS.js remuxing), and the cron-driven
 * cleanup of old segments, orphaned sessions, and the remux cache.
 *
 * Extracted from LivekitReplayService, which orchestrates egress and clip
 * capture and delegates segment concerns to this service.
 */
@Injectable()
export class ReplaySegmentsService {
  private readonly logger = new Logger(ReplaySegmentsService.name);
  private readonly cleanupAgeMinutes: number;
  private readonly orphanSweepEnabled: boolean;
  private readonly orphanSweepGraceHours: number;
  private readonly REMUX_CACHE_DIR = '/tmp/hls-remux-cache';
  private readonly REMUX_CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    @Inject(EGRESS_CLIENT)
    private readonly egressClient: EgressClient,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly storageService: StorageService,
    private readonly websocketService: WebsocketService,
  ) {
    this.cleanupAgeMinutes = parseInt(
      this.configService.get<string>('REPLAY_SEGMENT_CLEANUP_AGE_MINUTES') ||
        '20',
      10,
    );

    // Filesystem reconciliation sweep (issue: segment directories with no
    // matching egressSession row orphan permanently — see
    // sweepOrphanedSegmentDirectories doc). Defaults to enabled.
    this.orphanSweepEnabled =
      this.configService.get<string>('REPLAY_ORPHAN_SWEEP_ENABLED') !== 'false';
    this.orphanSweepGraceHours = parseInt(
      this.configService.get<string>('REPLAY_ORPHAN_SWEEP_GRACE_HOURS') || '24',
      10,
    );

    this.logger.log('ReplaySegmentsService initialized');
    this.logger.log(`Cleanup age: ${this.cleanupAgeMinutes} minutes`);
    this.logger.log(
      `Orphan directory sweep: ${this.orphanSweepEnabled ? 'enabled' : 'disabled'} (grace: ${this.orphanSweepGraceHours}h)`,
    );
  }

  /**
   * Cleanup old segment files from active sessions
   *
   * Runs every 5 minutes, deletes segments older than REPLAY_SEGMENT_CLEANUP_AGE_MINUTES
   * Note: Playlist files (.m3u8) are continuously updated by LiveKit and won't be deleted
   */
  @Cron('*/5 * * * *')
  async cleanupOldSegments() {
    this.logger.debug('Running cleanup of old replay buffer segments...');

    try {
      // Find all active sessions
      const activeSessions = await this.databaseService.egressSession.findMany({
        where: { status: 'active' },
      });

      if (activeSessions.length === 0) {
        this.logger.debug('No active sessions to clean up');
        return;
      }

      const cutoffDate = new Date(
        Date.now() - this.cleanupAgeMinutes * 60 * 1000,
      );
      let totalDeleted = 0;

      for (const session of activeSessions) {
        try {
          // Resolve relative segment path to full path
          const resolvedPath = this.storageService.resolveSegmentPath(
            session.segmentPath,
          );

          // Check if segment directory exists
          const exists = await this.storageService.segmentDirectoryExists(
            session.segmentPath,
          );
          if (!exists) {
            this.logger.warn(`Segment path does not exist: ${resolvedPath}`);
            continue;
          }

          // Delete old files in the segment directory
          // This will delete old .ts segment files but preserve the .m3u8 playlist
          // (playlist is continuously updated so its mtime will be recent)
          const deletedCount = await this.storageService.deleteOldFiles(
            resolvedPath,
            cutoffDate,
          );

          totalDeleted += deletedCount;

          if (deletedCount > 0) {
            this.logger.debug(
              `Deleted ${deletedCount} old segments from session ${session.id}`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Failed to cleanup segments for session ${session.id}: ${getErrorMessage(error)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        this.logger.log(`Cleaned up ${totalDeleted} old segment files`);
      } else {
        this.logger.debug('No old segments to clean up');
      }
    } catch (error) {
      this.logger.error(`Cleanup job failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Cleanup orphaned egress sessions
   *
   * Runs every hour to find and cleanup sessions that have been active for >3 hours
   * These are likely orphaned due to browser crashes, network issues, or server restarts
   */
  @Cron('0 * * * *') // Every hour at minute 0
  async cleanupOrphanedSessions() {
    this.logger.debug('Running cleanup of orphaned egress sessions...');

    try {
      // Find sessions that have been active for more than 3 hours
      const staleThreshold = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago

      const orphanedSessions =
        await this.databaseService.egressSession.findMany({
          where: {
            status: 'active',
            startedAt: { lt: staleThreshold },
          },
        });

      if (orphanedSessions.length === 0) {
        this.logger.debug('No orphaned sessions found');
        return;
      }

      this.logger.warn(
        `Found ${orphanedSessions.length} orphaned sessions, cleaning up...`,
      );

      let cleanedCount = 0;

      for (const session of orphanedSessions) {
        try {
          // Try to stop the egress (might already be stopped by LiveKit)
          try {
            await this.egressClient.stopEgress(session.egressId);
            this.logger.debug(`Stopped orphaned egress: ${session.egressId}`);
          } catch {
            // Egress might already be stopped - that's fine
            this.logger.debug(
              `Egress ${session.egressId} already stopped or not found`,
            );
          }

          // Update session status in database
          await this.databaseService.egressSession.update({
            where: { id: session.id },
            data: {
              status: 'stopped',
              endedAt: new Date(),
            },
          });

          // Notify the client so the capture button clears — force-stopping
          // without an event strands the UI and every capture 404s (#302).
          this.websocketService.sendToRoom(
            RoomName.user(session.userId),
            ServerEvents.REPLAY_BUFFER_STOPPED,
            {
              sessionId: session.id,
              egressId: session.egressId,
              channelId: session.channelId,
            },
          );

          // Delete segment directory
          // session.segmentPath is now relative, resolve it using StorageService
          const exists = await this.storageService.segmentDirectoryExists(
            session.segmentPath,
          );

          if (exists) {
            await this.storageService.deleteSegmentDirectory(
              session.segmentPath,
              {
                recursive: true,
                force: true,
              },
            );
            const resolvedPath = this.storageService.resolveSegmentPath(
              session.segmentPath,
            );
            this.logger.debug(`Deleted orphaned segments: ${resolvedPath}`);
          }

          cleanedCount++;
        } catch (error) {
          this.logger.error(
            `Failed to cleanup orphaned session ${session.id}: ${getErrorMessage(error)}`,
          );
          // Continue with next session
        }
      }

      this.logger.log(
        `Cleaned up ${cleanedCount} orphaned sessions out of ${orphanedSessions.length} found`,
      );
    } catch (error) {
      this.logger.error(
        `Orphaned session cleanup job failed: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Sweep segment directories on disk that have no matching `egressSession`
   * DB row (or whose row is no longer active).
   *
   * Every other cleanup path here starts from a DB row (graceful stop,
   * egress-ended webhook, cleanupOldSegments, cleanupOrphanedSessions) — none
   * of them can catch a directory whose row was wiped, whose webhook was
   * missed, or whose one-time `deleteSegmentDirectory` call failed after the
   * row was already marked 'stopped'. This is a filesystem-first pass:
   * list what's actually on disk, and delete anything old enough and not
   * claimed by a currently-active session.
   *
   * Runs hourly at :30 (offset from cleanupOrphanedSessions at :00) so the
   * two sweeps don't overlap. A directory must be older than
   * REPLAY_ORPHAN_SWEEP_GRACE_HOURS (default 24h) before it's eligible —
   * comfortably longer than any legitimate in-progress session — to avoid
   * racing a session that is starting up or between webhook and DB write.
   */
  @Cron('30 * * * *')
  async sweepOrphanedSegmentDirectories(): Promise<void> {
    if (!this.orphanSweepEnabled) {
      this.logger.debug(
        'Orphaned segment directory sweep disabled via REPLAY_ORPHAN_SWEEP_ENABLED',
      );
      return;
    }

    try {
      const dirNames = await this.storageService.listSegmentDirectories();

      if (dirNames.length === 0) {
        this.logger.debug('No segment directories found to sweep');
        return;
      }

      // Query active sessions once per sweep, not per directory.
      const activeSessions = await this.databaseService.egressSession.findMany({
        where: { status: 'active' },
      });
      // segmentPath is stored as the flat sessionId directory name (see
      // startReplayBuffer), the same form readdir yields here — so exact Set
      // membership is correct; no prefix/substring matching involved.
      const activeSegmentPaths = new Set(
        activeSessions.map((session) => session.segmentPath),
      );

      const cutoffDate = new Date(
        Date.now() - this.orphanSweepGraceHours * 60 * 60 * 1000,
      );

      let deletedCount = 0;
      let skippedActiveCount = 0;
      let skippedYoungCount = 0;

      for (const dirName of dirNames) {
        if (activeSegmentPaths.has(dirName)) {
          skippedActiveCount++;
          continue;
        }

        let stats: FileStats;
        try {
          stats = await this.storageService.getSegmentDirectoryStats(dirName);
        } catch (error) {
          this.logger.debug(
            `Failed to stat segment directory ${dirName}, skipping: ${getErrorMessage(error)}`,
          );
          continue;
        }

        if (stats.mtime >= cutoffDate) {
          skippedYoungCount++;
          continue;
        }

        try {
          await this.storageService.deleteSegmentDirectory(dirName, {
            recursive: true,
            force: true,
          });
          deletedCount++;
        } catch (error) {
          this.logger.warn(
            `Failed to delete orphaned segment directory ${dirName}: ${getErrorMessage(error)}`,
          );
        }
      }

      const summary = `Swept ${deletedCount} orphaned segment directories (skipped ${skippedActiveCount} active, ${skippedYoungCount} young)`;
      if (deletedCount > 0) {
        this.logger.log(summary);
      } else {
        this.logger.debug(summary);
      }
    } catch (error) {
      this.logger.error(
        `Orphaned segment directory sweep failed: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Cleanup stale remux cache files
   *
   * Runs every 30 minutes to delete remuxed segment files older than 1 hour.
   * These files are created by getRemuxedSegmentPath() at /tmp/hls-remux-cache/{userId}/
   * and accumulate over time if not cleaned up.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async cleanupRemuxCache(): Promise<void> {
    try {
      const exists = await fs
        .access(this.REMUX_CACHE_DIR)
        .then(() => true)
        .catch(() => false);
      if (!exists) return;

      const userDirs = await fs.readdir(this.REMUX_CACHE_DIR);
      const now = Date.now();
      let cleaned = 0;

      for (const userDir of userDirs) {
        const userPath = path.join(this.REMUX_CACHE_DIR, userDir);
        try {
          const stat = await fs.stat(userPath);
          if (!stat.isDirectory()) continue;
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            'code' in error &&
            (error as NodeJS.ErrnoException).code === 'ENOENT'
          )
            continue;
          throw error;
        }

        const files = await fs.readdir(userPath).catch(() => [] as string[]);
        for (const file of files) {
          try {
            const filePath = path.join(userPath, file);
            const fileStat = await fs.stat(filePath);
            if (now - fileStat.mtimeMs > this.REMUX_CACHE_MAX_AGE_MS) {
              await fs.unlink(filePath);
              cleaned++;
            }
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              'code' in error &&
              (error as NodeJS.ErrnoException).code === 'ENOENT'
            )
              continue;
            throw error;
          }
        }

        // Remove empty user directories
        const remaining = await fs
          .readdir(userPath)
          .catch(() => [] as string[]);
        if (remaining.length === 0) {
          await fs.rmdir(userPath).catch(() => {});
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Cleaned up ${cleaned} stale remux cache files`);
      }
    } catch (error) {
      this.logger.warn(
        `Remux cache cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List all segments in directory and sort by sequence number
   *
   * Filenames follow format: 2025-11-15T040603-segment_00000.ts
   * Extracts sequence number (_00000) for proper ordering since timestamps are identical
   *
   * @param segmentDir - Directory containing segment files
   * @returns Array of segment info sorted by sequence number (oldest first)
   * @private
   */
  private async listAndSortSegments(
    segmentDir: string,
  ): Promise<Array<{ filename: string; sequence: number; path: string }>> {
    try {
      const files = await this.storageService.listFiles(segmentDir, {
        filter: (filename) =>
          filename.endsWith('.ts') && filename.includes('segment'),
      });

      const segments: Array<{
        filename: string;
        sequence: number;
        path: string;
      }> = [];

      for (const filename of files) {
        // Extract sequence number from filename
        // Format: 2025-11-15T040603-segment_00000.ts
        const sequenceMatch = filename.match(/_(\d+)\.ts$/);

        if (sequenceMatch) {
          const sequence = parseInt(sequenceMatch[1], 10);
          segments.push({
            filename,
            sequence,
            path: path.join(segmentDir, filename),
          });
        } else {
          this.logger.warn(`Skipping file with unexpected format: ${filename}`);
        }
      }

      // Sort by sequence number (oldest to newest)
      return segments.sort((a, b) => a.sequence - b.sequence);
    } catch (error) {
      this.logger.error(
        `Failed to list segments in ${segmentDir}: ${getErrorMessage(error)}`,
      );
      return [];
    }
  }

  /**
   * List segments that are complete (>= 10KB), filtering out segments still being written.
   *
   * @param segmentDir - Absolute path to segment directory
   * @returns Sorted array of complete segments
   */
  async listCompleteSegments(
    segmentDir: string,
  ): Promise<Array<{ filename: string; sequence: number; path: string }>> {
    const allSegments = await this.listAndSortSegments(segmentDir);
    const complete: Array<{
      filename: string;
      sequence: number;
      path: string;
    }> = [];
    for (const segment of allSegments) {
      try {
        const stats = await this.storageService.getFileStats(segment.path);
        if (stats.size >= 10000) {
          complete.push(segment);
        }
      } catch (error) {
        this.logger.warn(
          `Skipping segment that could not be stat-ed (${segment.path}): ${getErrorMessage(error)}`,
        );
      }
    }
    return complete;
  }

  /**
   * Get the full path to a specific segment file
   * Verifies that the segment belongs to the user's active session
   *
   * @param userId - ID of the user
   * @param segmentFile - Filename of the segment (e.g., "2025-11-15T040603-segment_00000.ts")
   * @returns Full path to the segment file
   */
  async getSegmentPath(userId: string, segmentFile: string): Promise<string> {
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

    // Validate segment filename format to prevent path traversal
    if (
      !segmentFile.match(/^[\w-]+\.ts$/) ||
      segmentFile.includes('..') ||
      segmentFile.includes('/')
    ) {
      this.logger.warn(`Rejected invalid segment filename: ${segmentFile}`);
      throw new BadRequestException('That replay segment is not valid.');
    }

    // Resolve relative session path to full path, then join with segment filename
    const resolvedSessionDir = this.storageService.resolveSegmentPath(
      session.segmentPath,
    );
    const segmentPath = path.join(resolvedSessionDir, segmentFile);

    // Verify file exists
    const exists = await this.storageService.fileExists(segmentPath);
    if (!exists) {
      this.logger.warn(`Segment file not found on disk: ${segmentFile}`);
      throw new NotFoundException(
        'That part of the replay is no longer available.',
      );
    }

    return segmentPath;
  }

  /**
   * Get a remuxed segment file path for HLS.js compatibility
   * LiveKit egress v1.14.1 writes 188-byte MPEG-TS segments. This remuxes a
   * segment with FFmpeg to standard MPEG-TS format, a stream copy.
   *
   * @param userId - ID of the user
   * @param segmentFile - Filename of the segment
   * @returns Full path to the remuxed segment file
   */
  async getRemuxedSegmentPath(
    userId: string,
    segmentFile: string,
  ): Promise<string> {
    const originalPath = await this.getSegmentPath(userId, segmentFile);

    // Create a cache directory for remuxed segments
    const cacheDir = `${this.REMUX_CACHE_DIR}/${userId}`;
    await this.storageService.ensureDirectory(cacheDir);

    const remuxedPath = path.join(cacheDir, segmentFile);

    // Check if already remuxed
    const remuxedExists = await this.storageService.fileExists(remuxedPath);
    if (remuxedExists) {
      return remuxedPath;
    }

    // Check if the segment file is large enough to be complete
    // A valid segment should be at least a few KB (has headers + some data)
    const stats = await this.storageService.getFileStats(originalPath);
    if (stats.size < 10000) {
      // Less than 10KB, likely incomplete
      this.logger.warn(
        `Segment ${segmentFile} appears incomplete (${stats.size} bytes), serving original`,
      );
      // Return original path - HLS.js will fail but it's better than crashing
      return originalPath;
    }

    // Remux using FFmpeg to standard MPEG-TS
    // This is a fast stream copy operation, not transcoding
    this.logger.debug(`Remuxing segment ${segmentFile} for HLS.js`);

    try {
      await this.remuxSegment(originalPath, remuxedPath);
    } catch (error) {
      this.logger.error(
        `Failed to remux segment ${segmentFile}: ${getErrorMessage(error)}`,
      );
      // If remuxing fails, return the original path as fallback
      // This allows the player to at least try to play it
      return originalPath;
    }

    return remuxedPath;
  }

  /**
   * Remux a single segment file to standard MPEG-TS format
   * Uses stream copy for speed, no re-encoding needed
   *
   * @param inputPath - Path to original segment
   * @param outputPath - Path for remuxed segment
   * @private
   */
  private async remuxSegment(
    inputPath: string,
    outputPath: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      ffmpegModule(inputPath)
        .outputOptions([
          '-c copy', // Stream copy, no transcoding
          '-f mpegts', // Force standard MPEG-TS output (re-muxes stream IDs)
          '-copyts', // Preserve original PTS (don't normalize to 0)
        ])
        .output(outputPath)
        .on('end', () => {
          this.logger.debug(`Successfully remuxed segment to ${outputPath}`);
          resolve();
        })
        .on('error', (err: Error) => {
          this.logger.error(`Failed to remux segment: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }
}
