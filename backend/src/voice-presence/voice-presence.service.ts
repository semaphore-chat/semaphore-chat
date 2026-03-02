import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import Redis from 'ioredis';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@kraken/shared';
import { DatabaseService } from '@/database/database.service';
import { LivekitReplayService } from '@/livekit/livekit-replay.service';

/**
 * Voice presence user data
 *
 * NOTE: We only store minimal state here now.
 * Media states (video, screen share, mic mute) are managed by LiveKit
 * and read directly from LiveKit participants on the frontend.
 *
 * We only store:
 * - User identity info (id, username, displayName, avatarUrl)
 * - joinedAt timestamp
 * - isDeafened (custom UI state not in LiveKit)
 */
export interface VoicePresenceUser {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  joinedAt: Date;
  isDeafened: boolean;
  isServerMuted: boolean;
}

@Injectable()
export class VoicePresenceService {
  private readonly logger = new Logger(VoicePresenceService.name);
  // Channel voice keys
  private readonly VOICE_PRESENCE_USER_DATA_PREFIX = 'voice_presence:user';
  private readonly VOICE_PRESENCE_CHANNEL_MEMBERS_PREFIX =
    'voice_presence:channel';
  private readonly VOICE_PRESENCE_USER_CHANNELS_PREFIX =
    'voice_presence:user_channels';
  // DM voice keys
  private readonly DM_VOICE_PRESENCE_USER_DATA_PREFIX =
    'dm_voice_presence:user';
  private readonly DM_VOICE_PRESENCE_MEMBERS_PREFIX = 'dm_voice_presence:dm';
  private readonly DM_VOICE_PRESENCE_USER_DMS_PREFIX =
    'dm_voice_presence:user_dms';
  private readonly VOICE_PRESENCE_TTL = 90; // 90 seconds (3 missed heartbeats at 30s interval)

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly websocketService: WebsocketService,
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LivekitReplayService))
    private readonly livekitReplayService: LivekitReplayService,
  ) {}

  /**
   * Join a voice channel directly - called by frontend as belt-and-suspenders
   * alongside LiveKit webhooks. Ensures presence is registered even if
   * webhooks are delayed or misconfigured.
   */
  async joinVoiceChannelDirect(
    channelId: string,
    userId: string,
  ): Promise<void> {
    // Delegate to the same logic used by the webhook handler
    await this.handleWebhookChannelParticipantJoined(
      channelId,
      userId,
      undefined,
      undefined,
    );
  }

  /**
   * Leave a voice channel - called by LiveKit webhook handler
   */
  async leaveVoiceChannel(channelId: string, userId: string): Promise<void> {
    try {
      // Keys for Redis SET architecture
      const userDataKey = `${this.VOICE_PRESENCE_USER_DATA_PREFIX}:${channelId}:${userId}`;
      const channelMembersKey = `${this.VOICE_PRESENCE_CHANNEL_MEMBERS_PREFIX}:${channelId}:members`;
      const userChannelsKey = `${this.VOICE_PRESENCE_USER_CHANNELS_PREFIX}:${userId}`;

      // Get user info before removing
      const userDataStr = await this.redis.get(userDataKey);
      if (!userDataStr) {
        this.logger.warn(
          `User ${userId} not found in voice channel ${channelId}`,
        );
        return;
      }

      const userData = JSON.parse(userDataStr) as VoicePresenceUser;

      // Use pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Remove user data
      pipeline.del(userDataKey);

      // Remove user from channel members set
      pipeline.srem(channelMembersKey, userId);

      // Remove channel from user's channels set
      pipeline.srem(userChannelsKey, channelId);

      await pipeline.exec();

      // Notify other users in the channel
      this.websocketService.sendToRoom(
        channelId,
        ServerEvents.VOICE_CHANNEL_USER_LEFT,
        {
          channelId,
          userId,
          user: userData,
        },
      );

      // Stop any active replay buffer egress for this user
      try {
        await this.livekitReplayService.stopReplayBuffer(userId);
      } catch (error: unknown) {
        // Ignore if no session found (404), log other errors
        const isNotFoundError =
          error instanceof Error &&
          'status' in error &&
          (error as Error & { status: number }).status === 404;
        if (!isNotFoundError) {
          this.logger.warn(
            `Failed to stop replay buffer on leave for user ${userId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      this.logger.log(`User ${userId} left voice channel ${channelId}`);
    } catch (error) {
      this.logger.error(
        `Failed to leave voice channel ${channelId} for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all users currently in a voice channel
   */
  async getChannelPresence(channelId: string): Promise<VoicePresenceUser[]> {
    try {
      const channelMembersKey = `${this.VOICE_PRESENCE_CHANNEL_MEMBERS_PREFIX}:${channelId}:members`;

      // Get all user IDs in the channel (O(1) operation)
      const userIds = await this.redis.smembers(channelMembersKey);

      if (userIds.length === 0) {
        return [];
      }

      // Build keys for user data
      const userDataKeys = userIds.map(
        (userId) =>
          `${this.VOICE_PRESENCE_USER_DATA_PREFIX}:${channelId}:${userId}`,
      );

      // Fetch all user data in one operation (O(m) where m is number of users)
      const values = await this.redis.mget(userDataKeys);

      const users: VoicePresenceUser[] = [];

      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value) {
          try {
            const user = JSON.parse(value) as VoicePresenceUser;
            users.push(user);
          } catch (error) {
            this.logger.warn('Failed to parse voice presence data', error);
          }
        } else {
          // User data expired but still in set - clean up
          const userId = userIds[i];
          this.logger.debug(
            `Cleaning up expired presence for user ${userId} in channel ${channelId}`,
          );
          await this.redis.srem(channelMembersKey, userId);
        }
      }

      // Sort by join time
      return users.sort(
        (a, b) =>
          new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
      );
    } catch (error) {
      this.logger.error(
        `Failed to get presence for voice channel ${channelId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Refresh a user's presence in the voice channel (extend TTL).
   * If the key has expired (e.g. tab was backgrounded too long),
   * re-register the user so presence is restored on the next heartbeat.
   */
  async refreshPresence(channelId: string, userId: string): Promise<void> {
    try {
      const userDataKey = `${this.VOICE_PRESENCE_USER_DATA_PREFIX}:${channelId}:${userId}`;
      const result = await this.redis.expire(
        userDataKey,
        this.VOICE_PRESENCE_TTL,
      );

      if (result === 0) {
        // Key expired or missing — re-register the user
        this.logger.log(
          `Presence expired for user ${userId} in channel ${channelId}, re-registering`,
        );
        await this.handleWebhookChannelParticipantJoined(channelId, userId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to refresh presence for user ${userId} in channel ${channelId}`,
        error,
      );
    }
  }

  /**
   * Refresh a user's presence in a DM voice call (extend TTL).
   * If the key has expired, re-register the user so presence is restored.
   */
  async refreshDmPresence(dmGroupId: string, userId: string): Promise<void> {
    try {
      const userDataKey = `${this.DM_VOICE_PRESENCE_USER_DATA_PREFIX}:${dmGroupId}:${userId}`;
      const result = await this.redis.expire(
        userDataKey,
        this.VOICE_PRESENCE_TTL,
      );

      if (result === 0) {
        // Key expired or missing — verify membership before re-registering
        const member =
          await this.databaseService.directMessageGroupMember.findFirst({
            where: { groupId: dmGroupId, userId },
          });

        if (!member) {
          this.logger.warn(
            `User ${userId} is not a member of DM ${dmGroupId}, skipping re-registration`,
          );
          return;
        }

        this.logger.log(
          `DM presence expired for user ${userId} in DM ${dmGroupId}, re-registering`,
        );
        await this.handleWebhookDmParticipantJoined(dmGroupId, userId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to refresh DM presence for user ${userId} in DM ${dmGroupId}`,
        error,
      );
    }
  }

  /**
   * Clean up expired presence entries (called periodically)
   * Note: This is now less critical since getChannelPresence automatically
   * cleans up stale entries when detected.
   */
  cleanupExpiredPresence(): void {
    // With the new SET architecture, cleanup happens automatically:
    // 1. User data keys have TTL and expire naturally
    // 2. getChannelPresence() removes stale set members when detected
    // 3. This method is kept for potential future needs but is essentially a no-op
    this.logger.debug('Cleanup cron triggered (passive cleanup in use)');
  }

  /**
   * Handle participant join from LiveKit webhook
   *
   * This is the authoritative source of truth for voice presence.
   * When LiveKit notifies us a participant joined, we update Redis
   * and emit WebSocket events to all clients.
   */
  async handleWebhookParticipantJoined(
    roomName: string,
    userId: string,
    participantName?: string,
    metadata?: string,
  ): Promise<void> {
    try {
      // Determine if this is a channel or DM based on the room name
      // Room names are either channelId (UUID) or dmGroupId (UUID)
      // We need to check if the room is a DM by looking it up

      const dmGroup = await this.databaseService.directMessageGroup.findUnique({
        where: { id: roomName },
      });

      if (dmGroup) {
        // This is a DM voice call
        await this.handleWebhookDmParticipantJoined(
          roomName,
          userId,
          participantName,
          metadata,
        );
      } else {
        // This is a channel voice call
        await this.handleWebhookChannelParticipantJoined(
          roomName,
          userId,
          participantName,
          metadata,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle webhook participant_joined for user ${userId} in room ${roomName}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle participant leave from LiveKit webhook
   *
   * This is the authoritative source of truth for voice presence.
   * When LiveKit notifies us a participant left, we update Redis
   * and emit WebSocket events to all clients.
   */
  async handleWebhookParticipantLeft(
    roomName: string,
    userId: string,
  ): Promise<void> {
    try {
      // Check if this is a DM or channel
      const dmGroup = await this.databaseService.directMessageGroup.findUnique({
        where: { id: roomName },
      });

      if (dmGroup) {
        await this.leaveDmVoice(roomName, userId);
      } else {
        await this.leaveVoiceChannel(roomName, userId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle webhook participant_left for user ${userId} in room ${roomName}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle channel participant join from webhook
   */
  private async handleWebhookChannelParticipantJoined(
    channelId: string,
    userId: string,
    participantName?: string,
    metadata?: string,
  ): Promise<void> {
    // Check if user is already in the channel (duplicate webhook or reconnection)
    const userDataKey = `${this.VOICE_PRESENCE_USER_DATA_PREFIX}:${channelId}:${userId}`;
    const existingData = await this.redis.get(userDataKey);

    if (existingData) {
      // User already in channel - just refresh TTL and maybe update metadata
      this.logger.debug(
        `User ${userId} already in channel ${channelId}, refreshing presence`,
      );
      await this.redis.expire(userDataKey, this.VOICE_PRESENCE_TTL);

      // Update metadata if provided (for isDeafened sync)
      if (metadata) {
        const userData = JSON.parse(existingData) as VoicePresenceUser;
        try {
          const parsedMeta = JSON.parse(metadata) as { isDeafened?: boolean };
          if (parsedMeta.isDeafened !== undefined) {
            userData.isDeafened = parsedMeta.isDeafened;
            await this.redis.set(
              userDataKey,
              JSON.stringify(userData),
              'EX',
              this.VOICE_PRESENCE_TTL,
            );
          }
        } catch {
          // Invalid metadata JSON, ignore
        }
      }
      return;
    }

    // Look up user info from database
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(
        `User ${userId} not found in database for voice presence`,
      );
      return;
    }

    // Parse metadata for isDeafened
    let isDeafened = false;
    if (metadata) {
      try {
        const parsedMeta = JSON.parse(metadata) as { isDeafened?: boolean };
        isDeafened = parsedMeta.isDeafened ?? false;
      } catch {
        // Invalid metadata JSON, use default
      }
    }

    const voiceUser: VoicePresenceUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
      joinedAt: new Date(),
      isDeafened,
      isServerMuted: false,
    };

    // Keys for Redis SET architecture
    const channelMembersKey = `${this.VOICE_PRESENCE_CHANNEL_MEMBERS_PREFIX}:${channelId}:members`;
    const userChannelsKey = `${this.VOICE_PRESENCE_USER_CHANNELS_PREFIX}:${userId}`;

    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline();

    // Store user data with TTL
    pipeline.set(
      userDataKey,
      JSON.stringify(voiceUser),
      'EX',
      this.VOICE_PRESENCE_TTL,
    );

    // Add user to channel members set
    pipeline.sadd(channelMembersKey, userId);

    // Add channel to user's channels set
    pipeline.sadd(userChannelsKey, channelId);

    await pipeline.exec();

    // Notify other users in the channel
    this.websocketService.sendToRoom(
      channelId,
      ServerEvents.VOICE_CHANNEL_USER_JOINED,
      {
        channelId,
        user: voiceUser,
      },
    );

    this.logger.log(
      `[Webhook] User ${userId} joined voice channel ${channelId}`,
    );
  }

  /**
   * Handle DM participant join from webhook
   */
  private async handleWebhookDmParticipantJoined(
    dmGroupId: string,
    userId: string,
    participantName?: string,
    metadata?: string,
  ): Promise<void> {
    // Check if user is already in the DM call
    const userDataKey = `${this.DM_VOICE_PRESENCE_USER_DATA_PREFIX}:${dmGroupId}:${userId}`;
    const existingData = await this.redis.get(userDataKey);

    if (existingData) {
      // User already in DM call - refresh TTL
      this.logger.debug(
        `User ${userId} already in DM ${dmGroupId}, refreshing presence`,
      );
      await this.redis.expire(userDataKey, this.VOICE_PRESENCE_TTL);
      return;
    }

    // Look up user info from database
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(
        `User ${userId} not found in database for DM voice presence`,
      );
      return;
    }

    // Parse metadata for isDeafened
    let isDeafened = false;
    if (metadata) {
      try {
        const parsedMeta = JSON.parse(metadata) as { isDeafened?: boolean };
        isDeafened = parsedMeta.isDeafened ?? false;
      } catch {
        // Invalid metadata JSON, use default
      }
    }

    const voiceUser: VoicePresenceUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? undefined,
      avatarUrl: user.avatarUrl ?? undefined,
      joinedAt: new Date(),
      isDeafened,
      isServerMuted: false,
    };

    // Keys for Redis SET architecture (DM-specific)
    const dmMembersKey = `${this.DM_VOICE_PRESENCE_MEMBERS_PREFIX}:${dmGroupId}:members`;
    const userDmsKey = `${this.DM_VOICE_PRESENCE_USER_DMS_PREFIX}:${userId}`;

    // Check if this is the first user joining
    const existingMembers = await this.redis.smembers(dmMembersKey);
    const isFirstUser = existingMembers.length === 0;

    // Use pipeline for atomic operations
    const pipeline = this.redis.pipeline();

    // Store user data with TTL
    pipeline.set(
      userDataKey,
      JSON.stringify(voiceUser),
      'EX',
      this.VOICE_PRESENCE_TTL,
    );

    // Add user to DM members set
    pipeline.sadd(dmMembersKey, userId);

    // Add DM to user's DMs set
    pipeline.sadd(userDmsKey, dmGroupId);

    await pipeline.exec();

    if (isFirstUser) {
      // First user joining - emit "call started" event
      this.websocketService.sendToRoom(
        dmGroupId,
        ServerEvents.DM_VOICE_CALL_STARTED,
        {
          dmGroupId,
          startedBy: userId,
          starter: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
        },
      );
      this.logger.log(
        `[Webhook] User ${userId} started DM voice call in ${dmGroupId}`,
      );
    } else {
      // Not first user - just notify that someone joined
      this.websocketService.sendToRoom(
        dmGroupId,
        ServerEvents.DM_VOICE_USER_JOINED,
        {
          dmGroupId,
          user: voiceUser,
        },
      );
      this.logger.log(
        `[Webhook] User ${userId} joined DM voice call ${dmGroupId}`,
      );
    }
  }

  /**
   * Update a user's deafen state in a voice channel
   * Updates Redis and broadcasts the change to all clients in the channel
   */
  async updateDeafenState(
    channelId: string,
    userId: string,
    isDeafened: boolean,
  ): Promise<void> {
    const userDataKey = `${this.VOICE_PRESENCE_USER_DATA_PREFIX}:${channelId}:${userId}`;
    const userDataStr = await this.redis.get(userDataKey);

    if (!userDataStr) {
      this.logger.warn(
        `User ${userId} not found in voice channel ${channelId} for deafen update`,
      );
      return;
    }

    const userData = JSON.parse(userDataStr) as VoicePresenceUser;
    userData.isDeafened = isDeafened;

    await this.redis.set(
      userDataKey,
      JSON.stringify(userData),
      'EX',
      this.VOICE_PRESENCE_TTL,
    );

    this.websocketService.sendToRoom(
      channelId,
      ServerEvents.VOICE_CHANNEL_USER_UPDATED,
      {
        channelId,
        userId,
        user: userData,
      },
    );

    this.logger.debug(
      `User ${userId} deafen state updated to ${isDeafened} in channel ${channelId}`,
    );
  }

  /**
   * Update a user's server mute state in a voice channel
   * Updates Redis and broadcasts the change to all clients in the channel
   */
  async updateServerMuteState(
    channelId: string,
    userId: string,
    isServerMuted: boolean,
  ): Promise<void> {
    const userDataKey = `${this.VOICE_PRESENCE_USER_DATA_PREFIX}:${channelId}:${userId}`;
    const userDataStr = await this.redis.get(userDataKey);

    if (!userDataStr) {
      this.logger.warn(
        `User ${userId} not found in voice channel ${channelId} for server mute update`,
      );
      return;
    }

    const userData = JSON.parse(userDataStr) as VoicePresenceUser;
    userData.isServerMuted = isServerMuted;

    await this.redis.set(
      userDataKey,
      JSON.stringify(userData),
      'EX',
      this.VOICE_PRESENCE_TTL,
    );

    this.websocketService.sendToRoom(
      channelId,
      ServerEvents.VOICE_CHANNEL_USER_UPDATED,
      {
        channelId,
        userId,
        user: userData,
      },
    );

    this.logger.debug(
      `User ${userId} server mute state updated to ${isServerMuted} in channel ${channelId}`,
    );
  }

  /**
   * Get all channels where a user is currently in voice
   */
  async getUserVoiceChannels(userId: string): Promise<string[]> {
    try {
      const userChannelsKey = `${this.VOICE_PRESENCE_USER_CHANNELS_PREFIX}:${userId}`;

      // Get all channel IDs from the user's channels set (O(1) operation)
      const channelIds = await this.redis.smembers(userChannelsKey);

      return channelIds;
    } catch (error) {
      this.logger.error(
        `Failed to get voice channels for user ${userId}`,
        error,
      );
      return [];
    }
  }

  /**
   * Leave a DM voice call - called by LiveKit webhook handler
   */
  async leaveDmVoice(dmGroupId: string, userId: string): Promise<void> {
    try {
      // Keys for Redis SET architecture (DM-specific)
      const userDataKey = `${this.DM_VOICE_PRESENCE_USER_DATA_PREFIX}:${dmGroupId}:${userId}`;
      const dmMembersKey = `${this.DM_VOICE_PRESENCE_MEMBERS_PREFIX}:${dmGroupId}:members`;
      const userDmsKey = `${this.DM_VOICE_PRESENCE_USER_DMS_PREFIX}:${userId}`;

      // Get user info before removing
      const userDataStr = await this.redis.get(userDataKey);
      if (!userDataStr) {
        this.logger.warn(
          `User ${userId} not found in DM voice call ${dmGroupId}`,
        );
        return;
      }

      const userData = JSON.parse(userDataStr) as VoicePresenceUser;

      // Use pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Remove user data
      pipeline.del(userDataKey);

      // Remove user from DM members set
      pipeline.srem(dmMembersKey, userId);

      // Remove DM from user's DMs set
      pipeline.srem(userDmsKey, dmGroupId);

      await pipeline.exec();

      // Notify other users in the DM call
      this.websocketService.sendToRoom(
        dmGroupId,
        ServerEvents.DM_VOICE_USER_LEFT,
        {
          dmGroupId,
          userId,
          user: userData,
        },
      );

      this.logger.log(`User ${userId} left DM voice call ${dmGroupId}`);
    } catch (error) {
      this.logger.error(
        `Failed to leave DM voice call ${dmGroupId} for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all users currently in a DM voice call
   */
  async getDmPresence(dmGroupId: string): Promise<VoicePresenceUser[]> {
    try {
      const dmMembersKey = `${this.DM_VOICE_PRESENCE_MEMBERS_PREFIX}:${dmGroupId}:members`;

      // Get all user IDs in the DM call (O(1) operation)
      const userIds = await this.redis.smembers(dmMembersKey);

      if (userIds.length === 0) {
        return [];
      }

      // Build keys for user data
      const userDataKeys = userIds.map(
        (userId) =>
          `${this.DM_VOICE_PRESENCE_USER_DATA_PREFIX}:${dmGroupId}:${userId}`,
      );

      // Fetch all user data in one operation (O(m) where m is number of users)
      const values = await this.redis.mget(userDataKeys);

      const users: VoicePresenceUser[] = [];

      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value) {
          try {
            const user = JSON.parse(value) as VoicePresenceUser;
            users.push(user);
          } catch (error) {
            this.logger.warn('Failed to parse DM voice presence data', error);
          }
        } else {
          // User data expired but still in set - clean up
          const userId = userIds[i];
          this.logger.debug(
            `Cleaning up expired presence for user ${userId} in DM ${dmGroupId}`,
          );
          await this.redis.srem(dmMembersKey, userId);
        }
      }

      // Sort by join time
      return users.sort(
        (a, b) =>
          new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
      );
    } catch (error) {
      this.logger.error(
        `Failed to get presence for DM voice call ${dmGroupId}`,
        error,
      );
      throw error;
    }
  }
}
