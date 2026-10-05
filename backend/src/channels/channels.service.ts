import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { DatabaseService } from '@/database/database.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import { ChannelType, InstanceRole, Prisma, RbacActions } from '@prisma/client';
import { WebsocketService } from '@/websocket/websocket.service';
import { Channel as SharedChannel, ServerEvents } from '@semaphore-chat/shared';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { RoomName } from '@/common/utils/room-name.util';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { PermissionsService } from '@/roles/permissions.service';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  /**
   * Converts a Prisma Channel row into the shared wire-DTO shape.
   * Prisma's `ChannelType` enum and the shared `ChannelType` enum have
   * identical string values (TEXT/VOICE) but are structurally distinct TS
   * types, so `type` is a pure relabeling cast — no value change at all.
   * `createdAt` is cast rather than converted: the shared type's declared
   * wire shape is a post-serialization ISO string, and this hands the raw
   * Date straight through — WebsocketService.sendToRoom()/sendToAll() now
   * JSON-roundtrip every payload (Date -> ISO string, same conversion
   * socket.io's own same-node encoder performs) immediately before
   * `.emit()`, so this cast is purely a static-type relabeling and the
   * runtime already matches it. See toWirePayload in
   * `@/websocket/websocket-wire.util`. Fixes #440.
   */
  private toSharedChannel(channel: {
    id: string;
    name: string;
    communityId: string;
    type: ChannelType;
    isPrivate: boolean;
    createdAt: Date;
    position: number;
    slowmodeSeconds: number;
  }): SharedChannel {
    return {
      ...channel,
      type: channel.type as unknown as SharedChannel['type'],
      createdAt: channel.createdAt as unknown as string,
    };
  }

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly websocketService: WebsocketService,
    private readonly eventEmitter: EventEmitter2,
    private readonly channelAccessService: ChannelAccessService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async create(createChannelDto: CreateChannelDto, user: UserEntity) {
    try {
      // Use a transaction to create the channel and the membership
      const result = await this.databaseService.$transaction(async (prisma) => {
        // Get max position for this channel type in the community
        const maxPosition = await prisma.channel.aggregate({
          where: {
            communityId: createChannelDto.communityId,
            type: createChannelDto.type,
          },
          _max: { position: true },
        });

        const newPosition = (maxPosition._max.position ?? -1) + 1;

        const channel = await prisma.channel.create({
          data: {
            ...createChannelDto,
            position: newPosition,
          },
        });
        await prisma.channelMembership.create({
          data: {
            userId: user.id,
            channelId: channel.id,
          },
        });
        return channel;
      });
      // Domain event: the RoomSubscriptionHandler joins the viewers' sockets
      this.eventEmitter.emit(RoomEvents.CHANNEL_CREATED, {
        channelId: result.id,
        communityId: result.communityId,
      });

      // Tell whoever can see it: the community, or (hidden channel) the
      // creator, its only viewer so far.
      const audience = await this.channelAccessService.audienceRoomFor(
        result.id,
      );
      this.websocketService.sendToRoom(
        audience === RoomName.community(result.communityId)
          ? audience
          : RoomName.user(user.id),
        ServerEvents.CHANNEL_CREATED,
        {
          communityId: result.communityId,
          channel: this.toSharedChannel(result),
        },
      );

      return result;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        this.logger.warn(
          'Channel already exists with the same name in this community',
        );
        throw new ConflictException(
          'Channel with this name already exists in the community',
        );
      }
      this.logger.error('Error creating channel', error);
      throw error;
    }
  }

  /** The community's channels that `userId` can see. */
  async findAll(communityId: string, userId: string) {
    const visibleIds = await this.channelAccessService.visibleChannelIds(
      userId,
      communityId,
    );
    const visible = new Set(visibleIds);
    const channels = await this.findAllUnfiltered(communityId);
    return channels.filter((c) => visible.has(c.id));
  }

  /** Every channel, hidden ones included: internal use only, never returned. */
  private findAllUnfiltered(
    communityId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.databaseService;
    return client.channel.findMany({
      where: { communityId },
      orderBy: [
        { type: 'asc' }, // TEXT before VOICE (alphabetically)
        { position: 'asc' },
        { createdAt: 'asc' }, // Tiebreaker for existing channels with position 0
      ],
      take: 500,
    });
  }

  async findOne(id: string) {
    const channel = await this.databaseService.channel.findUnique({
      where: { id },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  async update(
    id: string,
    updateChannelDto: UpdateChannelDto,
    actor: { id: string; role: InstanceRole },
  ) {
    try {
      const before = await this.databaseService.channel.findUnique({
        where: { id },
        // channel-visibility: compared below to detect a privacy toggle
        select: { isPrivate: true, communityId: true },
      });

      // Changing who can see a channel is a permission change: it needs
      // MANAGE_CHANNEL_PERMISSIONS (like an EVERYONE overwrite), on top of
      // the UPDATE_CHANNEL + view the guard already checked.
      if (
        before &&
        // channel-visibility: detects a privacy toggle (both lines)
        updateChannelDto.isPrivate !== undefined &&
        updateChannelDto.isPrivate !== before.isPrivate && // channel-visibility: same check
        actor.role !== InstanceRole.OWNER
      ) {
        const held = await this.permissionsService.getCommunityActions(
          actor.id,
          before.communityId,
        );
        if (!held.includes(RbacActions.MANAGE_CHANNEL_PERMISSIONS)) {
          throw new ForbiddenException(
            'Changing channel privacy requires the manage channel permissions permission',
          );
        }
      }

      const updated = await this.databaseService.channel.update({
        where: { id },
        data: updateChannelDto,
      });

      // channel-visibility: detects a privacy toggle, then resyncs via ChannelAccessService
      if (before && before.isPrivate !== updated.isPrivate) {
        // Resync who is in the channel's socket room (awaited, so users who
        // lost access are out before the update below is sent), then tell
        // the community to refetch: the id is all non-viewers get.
        await this.eventEmitter.emitAsync(
          RoomEvents.CHANNEL_VISIBILITY_CHANGED,
          { channelId: id, communityId: updated.communityId },
        );
        this.websocketService.sendToRoom(
          RoomName.community(updated.communityId),
          ServerEvents.CHANNEL_PERMISSIONS_UPDATED,
          { communityId: updated.communityId, channelId: id },
        );
      }

      // Notify whoever can see the channel about the update
      this.websocketService.sendToRoom(
        await this.channelAccessService.audienceRoomFor(id),
        ServerEvents.CHANNEL_UPDATED,
        {
          communityId: updated.communityId,
          channel: this.toSharedChannel(updated),
        },
      );

      return updated;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        this.logger.warn(
          'Channel already exists with the same name in this community',
        );
        throw new ConflictException(
          'Channel with this name already exists in the community',
        );
      }
      this.logger.error('Error updating channel', error);
      throw error;
    }
  }

  async remove(id: string) {
    const channel = await this.databaseService.channel.findUnique({
      where: { id },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Notify before deletion so clients still have the room subscription;
    // only whoever could see the channel learns about it
    this.websocketService.sendToRoom(
      await this.channelAccessService.audienceRoomFor(id),
      ServerEvents.CHANNEL_DELETED,
      { communityId: channel.communityId, channelId: id },
    );

    await this.databaseService.$transaction(async (tx) => {
      // Delete records that depend on channel messages
      await tx.notification.deleteMany({
        where: { channelId: id },
      });

      await tx.channelNotificationOverride.deleteMany({
        where: { channelId: id },
      });

      await tx.readReceipt.deleteMany({
        where: { channelId: id },
      });

      await tx.webhook.deleteMany({
        where: { channelId: id },
      });

      await tx.threadSubscriber.deleteMany({
        where: { parentMessage: { channelId: id } },
      });

      await tx.channelMembership.deleteMany({
        where: { channelId: id },
      });

      await tx.message.deleteMany({
        where: { channelId: id },
      });

      await tx.channel.delete({
        where: { id },
      });
    });

    // Emit domain event — the RoomSubscriptionHandler will remove sockets
    this.eventEmitter.emit(RoomEvents.CHANNEL_DELETED, { channelId: id });
  }

  async createDefaultGeneralChannel(
    communityId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx || this.databaseService;

    try {
      const channel = await prisma.channel.create({
        data: {
          name: 'general',
          communityId,
          type: ChannelType.TEXT,
          // channel-visibility: a write (the default channel is public)
          isPrivate: false,
        },
      });

      await prisma.channelMembership.create({
        data: {
          userId,
          channelId: channel.id,
        },
      });

      return channel;
    } catch (error) {
      this.logger.error('Error creating default general channel', error);
      throw error;
    }
  }

  async addUserToGeneralChannel(communityId: string, userId: string) {
    try {
      // Find the general channel in the community
      const generalChannel = await this.databaseService.channel.findFirst({
        where: {
          communityId,
          name: 'general',
        },
      });

      if (!generalChannel) {
        this.logger.warn(
          `No general channel found for community ${communityId}`,
        );
        return;
      }

      // Check if user is already a member
      const existingMembership =
        // channel-visibility: idempotency check before a membership write
        await this.databaseService.channelMembership.findFirst({
          where: {
            userId,
            channelId: generalChannel.id,
          },
        });

      if (existingMembership) {
        this.logger.debug(
          `User ${userId} is already a member of general channel`,
        );
        return;
      }

      // Add user to the general channel
      await this.databaseService.channelMembership.create({
        data: {
          userId,
          channelId: generalChannel.id,
        },
      });

      this.logger.debug(
        `Added user ${userId} to general channel in community ${communityId}`,
      );
    } catch (error) {
      this.logger.error('Error adding user to general channel', error);
      throw error;
    }
  }

  async findMentionableChannels(communityId: string, userId: string) {
    const visibleIds = await this.channelAccessService.visibleChannelIds(
      userId,
      communityId,
    );
    return this.databaseService.channel.findMany({
      where: { communityId, id: { in: visibleIds } },
      orderBy: { name: 'asc' },
    });
  }

  async moveChannelUp(channelId: string, communityId: string, userId: string) {
    await this.databaseService.$transaction(async (prisma) => {
      await this.normalizePositions(prisma, communityId);

      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
      });

      if (!channel) {
        throw new NotFoundException('Channel not found');
      }

      // Find the channel above with the same type and lower position
      const channelAbove = await prisma.channel.findFirst({
        where: {
          communityId,
          type: channel.type,
          position: { lt: channel.position },
        },
        orderBy: { position: 'desc' },
      });

      if (!channelAbove) {
        // Already at the top
        return;
      }

      // Swap positions
      await prisma.channel.update({
        where: { id: channel.id },
        data: { position: channelAbove.position },
      });
      await prisma.channel.update({
        where: { id: channelAbove.id },
        data: { position: channel.position },
      });

      await this.broadcastReorder(communityId, prisma);
    });
    return this.findAll(communityId, userId);
  }

  async moveChannelDown(
    channelId: string,
    communityId: string,
    userId: string,
  ) {
    await this.databaseService.$transaction(async (prisma) => {
      await this.normalizePositions(prisma, communityId);

      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
      });

      if (!channel) {
        throw new NotFoundException('Channel not found');
      }

      // Find the channel below with the same type and higher position
      const channelBelow = await prisma.channel.findFirst({
        where: {
          communityId,
          type: channel.type,
          position: { gt: channel.position },
        },
        orderBy: { position: 'asc' },
      });

      if (!channelBelow) {
        // Already at the bottom
        return;
      }

      // Swap positions
      await prisma.channel.update({
        where: { id: channel.id },
        data: { position: channelBelow.position },
      });
      await prisma.channel.update({
        where: { id: channelBelow.id },
        data: { position: channel.position },
      });

      await this.broadcastReorder(communityId, prisma);
    });
    return this.findAll(communityId, userId);
  }

  /**
   * CHANNELS_REORDERED goes to the whole community room, so it carries only
   * the channels everyone there can see (clients refetch their own list).
   */
  private async broadcastReorder(
    communityId: string,
    tx: Prisma.TransactionClient,
  ) {
    const [channels, publicIds] = await Promise.all([
      this.findAllUnfiltered(communityId, tx),
      this.channelAccessService.publicChannelIds(communityId),
    ]);
    this.websocketService.sendToRoom(
      RoomName.community(communityId),
      ServerEvents.CHANNELS_REORDERED,
      {
        communityId,
        channels: channels
          .filter((c) => publicIds.has(c.id))
          .map((c) => this.toSharedChannel(c)),
      },
    );
  }

  /**
   * Normalize channel positions for a community.
   * This ensures each channel has a unique position within its type,
   * handling legacy channels that may have position 0.
   */
  private async normalizePositions(
    prisma: Prisma.TransactionClient,
    communityId: string,
  ) {
    // Get all channels grouped by type, ordered by position then createdAt
    for (const type of [ChannelType.TEXT, ChannelType.VOICE]) {
      const channels = await prisma.channel.findMany({
        where: { communityId, type },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });

      // Check if normalization is needed (duplicate positions)
      const positions = channels.map((c) => c.position);
      const hasDuplicates = positions.length !== new Set(positions).size;

      if (hasDuplicates) {
        // Reassign sequential positions
        for (let i = 0; i < channels.length; i++) {
          if (channels[i].position !== i) {
            await prisma.channel.update({
              where: { id: channels[i].id },
              data: { position: i },
            });
          }
        }
      }
    }
  }
}
