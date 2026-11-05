import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { DatabaseService } from '@/database/database.service';
import { ChannelsService } from '@/channels/channels.service';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { assertOwnFiles } from '@/common/utils/attachable-files.utils';
import { Prisma, ResourceType } from '@prisma/client';
import {
  EpochBump,
  PermissionsCacheService,
} from '@/roles/permissions-cache.service';

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly channelsService: ChannelsService,
    private readonly communityRolesService: CommunityRolesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly permissionsCacheService: PermissionsCacheService,
  ) {}
  async create(createCommunityDto: CreateCommunityDto, creatorId: string) {
    await this.assertImagesUsable(
      this.databaseService,
      creatorId,
      createCommunityDto,
      { avatar: null, banner: null },
    );

    // Epoch bumps from the tx-nested role mutations below are collected here
    // and executed only after the transaction commits — bumping while the
    // transaction is still open would let a concurrent reader cache
    // pre-commit permission data under the post-commit epoch.
    const pendingBumps: EpochBump[] = [];
    try {
      const community = await this.databaseService.$transaction(async (tx) => {
        const community = await tx.community.create({
          data: createCommunityDto,
        });

        await tx.membership.create({
          data: {
            userId: creatorId,
            communityId: community.id,
          },
        });

        // Create default "general" channel and add creator as member
        await this.channelsService.createDefaultGeneralChannel(
          community.id,
          creatorId,
          tx,
        );

        // Create default roles for the community
        const adminRoleId =
          await this.communityRolesService.createDefaultCommunityRoles(
            community.id,
            tx,
            pendingBumps,
          );

        // Assign the creator as admin of the community
        await this.communityRolesService.assignUserToCommunityRole(
          creatorId,
          community.id,
          adminRoleId,
          tx,
          pendingBumps,
        );

        return community;
      });

      // Transaction committed — flush the deferred epoch bumps. On rollback
      // (transaction threw) this is never reached, which is correct: nothing
      // changed in the DB. executeBumps never throws (fail-open, logged).
      await this.permissionsCacheService.executeBumps(pendingBumps);

      return community;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Duplicate community name');
      }
      this.logger.error('Error creating community', error);
      throw error;
    }
  }

  async findAll(userId?: string) {
    if (userId) {
      const communities = await this.databaseService.membership.findMany({
        where: { userId },
        include: { community: true },
      });

      return communities.map((membership) => membership.community);
    } else {
      return this.databaseService.community.findMany({ take: 100 });
    }
  }

  async findOne(id: string) {
    const community = await this.databaseService.community.findUnique({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    return community;
  }

  /** A community can only use images uploaded by whoever is setting them. */
  private async assertImagesUsable(
    db: Prisma.TransactionClient | DatabaseService,
    userId: string,
    next: { avatar?: string | null; banner?: string | null },
    current: { avatar: string | null; banner: string | null },
  ) {
    for (const [fileId, existing, resourceType] of [
      [next.avatar, current.avatar, ResourceType.COMMUNITY_AVATAR],
      [next.banner, current.banner, ResourceType.COMMUNITY_BANNER],
    ] as const) {
      if (fileId && fileId !== existing) {
        await assertOwnFiles(
          db,
          userId,
          [fileId],
          [resourceType],
          'You can only use images you uploaded',
        );
      }
    }
  }

  /**
   * Replacing an image deletes the old one, but only if it really is this
   * community's image: older rows can point at a file that belongs elsewhere.
   */
  private async markImageForDeletion(
    tx: Prisma.TransactionClient,
    fileId: string,
    resourceType: ResourceType,
    communityId: string,
  ) {
    await tx.file.updateMany({
      where: {
        id: fileId,
        resourceType,
        OR: [{ fileCommunityId: communityId }, { fileCommunityId: null }],
      },
      data: { deletedAt: new Date() },
    });
  }

  async update(
    id: string,
    updateCommunityDto: UpdateCommunityDto,
    userId: string,
  ) {
    const updated = await this.databaseService.$transaction(async (tx) => {
      const currentCommunity = await tx.community.findUnique({
        where: { id },
      });

      if (!currentCommunity) {
        throw new NotFoundException('Community not found');
      }

      await this.assertImagesUsable(
        tx,
        userId,
        updateCommunityDto,
        currentCommunity,
      );

      // Mark old avatar for deletion if being replaced
      if (
        updateCommunityDto.avatar &&
        currentCommunity.avatar &&
        updateCommunityDto.avatar !== currentCommunity.avatar
      ) {
        await this.markImageForDeletion(
          tx,
          currentCommunity.avatar,
          ResourceType.COMMUNITY_AVATAR,
          id,
        );
      }

      // Mark old banner for deletion if being replaced
      if (
        updateCommunityDto.banner &&
        currentCommunity.banner &&
        updateCommunityDto.banner !== currentCommunity.banner
      ) {
        await this.markImageForDeletion(
          tx,
          currentCommunity.banner,
          ResourceType.COMMUNITY_BANNER,
          id,
        );
      }

      return tx.community.update({
        where: { id },
        data: updateCommunityDto,
      });
    });

    this.eventEmitter.emit(RoomEvents.COMMUNITY_UPDATED, {
      communityId: id,
      name: updated.name,
      description: updated.description,
      avatar: updated.avatar,
      banner: updated.banner,
    });

    return updated;
  }

  async addMemberToGeneralChannel(communityId: string, userId: string) {
    try {
      await this.channelsService.addUserToGeneralChannel(communityId, userId);
    } catch (error) {
      this.logger.error(
        `Failed to add user ${userId} to general channel in community ${communityId}`,
        error,
      );
      // Don't throw error to avoid breaking membership creation
    }
  }

  async remove(id: string) {
    const community = await this.databaseService.community.findUnique({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    // Notify members before deletion so they still have the room subscription
    this.eventEmitter.emit(RoomEvents.COMMUNITY_DELETED, { communityId: id });

    await this.cascadeDeleteCommunity(id);
  }

  // ============================================
  // Admin Community Management Methods
  // ============================================

  /**
   * Get all communities with stats for admin dashboard
   */
  async findAllWithStats(
    limit: number = 50,
    continuationToken?: string,
    search?: string,
  ): Promise<{
    communities: Array<{
      id: string;
      name: string;
      description: string | null;
      avatar: string | null;
      banner: string | null;
      createdAt: Date;
      memberCount: number;
      channelCount: number;
    }>;
    continuationToken?: string;
  }> {
    const whereClause: { name?: { contains: string; mode: 'insensitive' } } =
      {};

    if (search) {
      whereClause.name = { contains: search, mode: 'insensitive' };
    }

    const communities = await this.databaseService.community.findMany({
      where: whereClause,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      ...(continuationToken
        ? { cursor: { id: continuationToken }, skip: 1 }
        : {}),
      include: {
        _count: {
          select: {
            memberships: true,
            channels: true,
          },
        },
      },
    });

    const hasMore = communities.length > limit;
    const resultCommunities = hasMore ? communities.slice(0, -1) : communities;

    return {
      communities: resultCommunities.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        avatar: c.avatar,
        banner: c.banner,
        createdAt: c.createdAt,
        memberCount: c._count.memberships,
        channelCount: c._count.channels,
      })),
      continuationToken: hasMore
        ? resultCommunities[resultCommunities.length - 1].id
        : undefined,
    };
  }

  /**
   * Get a single community with detailed stats for admin
   */
  async findOneWithStats(id: string): Promise<{
    id: string;
    name: string;
    description: string | null;
    avatar: string | null;
    banner: string | null;
    createdAt: Date;
    memberCount: number;
    channelCount: number;
    messageCount: number;
  }> {
    const community = await this.databaseService.community.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            memberships: true,
            channels: true,
          },
        },
      },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    // Get message count for this community
    const messageCount = await this.databaseService.message.count({
      where: {
        channel: {
          communityId: id,
        },
        deletedAt: null,
      },
    });

    return {
      id: community.id,
      name: community.name,
      description: community.description,
      avatar: community.avatar,
      banner: community.banner,
      createdAt: community.createdAt,
      memberCount: community._count.memberships,
      channelCount: community._count.channels,
      messageCount,
    };
  }

  /**
   * Force delete a community (admin action - bypasses ownership check)
   */
  async forceRemove(id: string): Promise<void> {
    const community = await this.databaseService.community.findUnique({
      where: { id },
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    await this.cascadeDeleteCommunity(id);
  }

  /**
   * Delete a community and all associated records in a transaction.
   */
  private async cascadeDeleteCommunity(id: string): Promise<void> {
    await this.databaseService.$transaction(async (tx) => {
      // Get all channel IDs for this community (needed for dependent record cleanup)
      const channels = await tx.channel.findMany({
        where: { communityId: id },
        select: { id: true },
      });
      const channelIds = channels.map((c) => c.id);

      // Delete records that depend on channels/messages
      if (channelIds.length > 0) {
        await tx.notification.deleteMany({
          where: { channelId: { in: channelIds } },
        });

        await tx.channelNotificationOverride.deleteMany({
          where: { channelId: { in: channelIds } },
        });

        await tx.readReceipt.deleteMany({
          where: { channelId: { in: channelIds } },
        });

        await tx.webhook.deleteMany({
          where: { channelId: { in: channelIds } },
        });

        await tx.threadSubscriber.deleteMany({
          where: { parentMessage: { channelId: { in: channelIds } } },
        });
      }

      await tx.channelMembership.deleteMany({
        where: { channel: { communityId: id } },
      });

      await tx.message.deleteMany({
        where: { channel: { communityId: id } },
      });

      await tx.channel.deleteMany({
        where: { communityId: id },
      });

      // Delete community-level records
      await tx.communityBan.deleteMany({
        where: { communityId: id },
      });

      await tx.communityTimeout.deleteMany({
        where: { communityId: id },
      });

      await tx.moderationLog.deleteMany({
        where: { communityId: id },
      });

      await tx.aliasGroupMember.deleteMany({
        where: { aliasGroup: { communityId: id } },
      });

      await tx.aliasGroup.deleteMany({
        where: { communityId: id },
      });

      await tx.role.deleteMany({
        where: { communityId: id },
      });

      await tx.userRoles.deleteMany({
        where: { communityId: id },
      });

      await tx.membership.deleteMany({
        where: { communityId: id },
      });

      await tx.community.delete({
        where: { id },
      });
    });

    // Role definitions and assignments for this community were removed via
    // raw tx.role.deleteMany / tx.userRoles.deleteMany above (bypasses
    // CommunityRolesService, so they don't self-bump). Bump the community epoch for
    // completeness/defense-in-depth — in practice no future request can
    // resolve a permission check against this communityId again, since the
    // community and its channels/messages are gone.
    await this.permissionsCacheService.bumpCommunityEpoch(id);
  }
}
