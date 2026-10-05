import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateMembershipDto } from './dto/create-membership.dto';
import {
  MembershipResponseDto,
  PaginatedMembershipsResponseDto,
} from './dto/membership-response.dto';
import { RbacActions } from '@prisma/client';
import { DatabaseService } from '@/database/database.service';
import { CommunityService } from '@/community/community.service';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly communityService: CommunityService,
    private readonly communityRolesService: CommunityRolesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly permissionsCacheService: PermissionsCacheService,
  ) {}

  async create(
    createMembershipDto: CreateMembershipDto,
  ): Promise<MembershipResponseDto> {
    const { userId, communityId } = createMembershipDto;

    try {
      // Check if community exists
      await this.databaseService.community.findUniqueOrThrow({
        where: { id: communityId },
      });

      // Check if user exists (existence check only — avoid fetching sensitive fields)
      await this.databaseService.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true },
      });

      // Check if membership already exists
      const existingMembership =
        await this.databaseService.membership.findUnique({
          where: {
            userId_communityId: {
              userId,
              communityId,
            },
          },
        });

      if (existingMembership) {
        throw new ConflictException(
          'User is already a member of this community',
        );
      }

      // Check if user is banned from this community
      const ban = await this.databaseService.communityBan.findUnique({
        where: {
          communityId_userId: { communityId, userId },
        },
      });

      if (ban && ban.active) {
        // Check if ban has expired
        if (!ban.expiresAt || ban.expiresAt > new Date()) {
          throw new ForbiddenException('You are banned from this community');
        }
        // Auto-expire the ban if it has expired
        await this.databaseService.communityBan.update({
          where: { id: ban.id },
          data: { active: false },
        });
      }

      const membership = await this.databaseService.membership.create({
        data: {
          userId,
          communityId,
        },
      });

      // Add user to the general channel of the community
      try {
        await this.communityService.addMemberToGeneralChannel(
          communityId,
          userId,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to add user ${userId} to general channel in community ${communityId}`,
          error,
        );
        // Don't fail the membership creation for this
      }

      // Assign default member role to the user
      try {
        let memberRole =
          await this.communityRolesService.getCommunityMemberRole(communityId);

        // If Member role doesn't exist for this community, create it
        if (!memberRole) {
          this.logger.log(
            `Member role not found for community ${communityId}, creating it...`,
          );
          // Create just the Member role for this community
          await this.communityRolesService.createMemberRoleForCommunity(
            communityId,
          );
          memberRole =
            await this.communityRolesService.getCommunityMemberRole(
              communityId,
            );
        }

        if (memberRole) {
          await this.communityRolesService.assignUserToCommunityRole(
            userId,
            communityId,
            memberRole.id,
          );
        } else {
          this.logger.error(
            `Failed to create or find member role for community ${communityId}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to assign default member role to user ${userId} in community ${communityId}`,
          error,
        );
        // Don't fail the membership creation for this
      }

      // Emit domain event — the RoomSubscriptionHandler will join sockets
      // and notify the user's UI
      this.eventEmitter.emit(RoomEvents.MEMBERSHIP_CREATED, {
        userId,
        communityId,
      });

      return new MembershipResponseDto(membership);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Error creating membership', error);

      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'User is already a member of this community',
        );
      }
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('User or community not found');
      }

      throw error;
    }
  }

  async findAllForCommunity(
    communityId: string,
    limit = 100,
    continuationToken?: string,
  ): Promise<PaginatedMembershipsResponseDto> {
    const memberships = await this.databaseService.membership.findMany({
      where: { communityId },
      include: {
        user: { select: PUBLIC_USER_SELECT },
      },
      // Order by joinedAt with id as a tiebreaker — joinedAt alone isn't
      // unique (bulk-created memberships can share a timestamp), and the
      // cursor below relies on a stable, deterministic sort order.
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      ...(continuationToken
        ? { cursor: { id: continuationToken }, skip: 1 }
        : {}),
    });

    // Mirrors the messages cursor pattern: the token is the id of the last
    // row returned, only emitted when the page was full (a partial page
    // means we've reached the end).
    const nextToken =
      memberships.length === limit
        ? memberships[memberships.length - 1].id
        : undefined;

    // Batch fetch user roles scoped to returned members (not entire community)
    const memberUserIds = memberships.map((m) => m.userId);
    const userRoles =
      memberUserIds.length > 0
        ? await this.databaseService.userRoles.findMany({
            where: { communityId, userId: { in: memberUserIds } },
            include: { role: true },
          })
        : [];

    // Group roles by userId
    const rolesByUserId = new Map<
      string,
      Array<{
        id: string;
        name: string;
        actions: RbacActions[];
        createdAt: Date;
        isDefault: boolean;
        position: number;
      }>
    >();
    for (const ur of userRoles) {
      const existing = rolesByUserId.get(ur.userId) || [];
      existing.push({
        id: ur.role.id,
        name: ur.role.name,
        actions: ur.role.actions,
        createdAt: ur.role.createdAt,
        isDefault: ur.role.isDefault,
        position: ur.role.position,
      });
      rolesByUserId.set(ur.userId, existing);
    }

    return {
      members: memberships.map(
        (membership) =>
          new MembershipResponseDto(
            membership,
            rolesByUserId.get(membership.userId),
          ),
      ),
      continuationToken: nextToken,
    };
  }

  async findAllForUser(userId: string): Promise<MembershipResponseDto[]> {
    const memberships = await this.databaseService.membership.findMany({
      where: { userId },
      include: {
        community: {
          select: {
            id: true,
            name: true,
            description: true,
            avatar: true,
          },
        },
      },
    });

    return memberships.map(
      (membership) => new MembershipResponseDto(membership),
    );
  }

  async findOne(
    userId: string,
    communityId: string,
  ): Promise<MembershipResponseDto> {
    const membership = await this.databaseService.membership.findUnique({
      where: {
        userId_communityId: {
          userId,
          communityId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    return new MembershipResponseDto(membership);
  }

  async remove(userId: string, communityId: string): Promise<void> {
    try {
      // Check if membership exists
      await this.databaseService.membership.findUniqueOrThrow({
        where: {
          userId_communityId: {
            userId,
            communityId,
          },
        },
      });

      await this.databaseService.$transaction(async (tx) => {
        // Remove user from all channels in the community
        await tx.channelMembership.deleteMany({
          where: {
            userId,
            channel: {
              communityId,
            },
          },
        });

        // Thread subscriptions must not outlive access
        await tx.threadSubscriber.deleteMany({
          where: { userId, parentMessage: { channel: { communityId } } },
        });

        // Remove user roles in the community
        await tx.userRoles.deleteMany({
          where: {
            userId,
            communityId,
          },
        });

        // Remove the membership
        await tx.membership.delete({
          where: {
            userId_communityId: {
              userId,
              communityId,
            },
          },
        });
      });

      // Role assignments were removed via the raw tx.userRoles.deleteMany
      // above (bypasses CommunityRolesService, so it doesn't self-bump) — invalidate
      // this user's cached permissions now that the transaction committed.
      await this.permissionsCacheService.bumpUserEpoch(userId);

      // Emit domain event — the RoomSubscriptionHandler will remove sockets
      this.eventEmitter.emit(RoomEvents.MEMBERSHIP_REMOVED, {
        userId,
        communityId,
      });

      this.logger.log(`Removed user ${userId} from community ${communityId}`);
    } catch (error) {
      this.logger.error(
        `Error removing membership for user ${userId} from community ${communityId}`,
        error,
      );

      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Membership not found');
      }

      throw error;
    }
  }

  async isMember(userId: string, communityId: string): Promise<boolean> {
    const membership = await this.databaseService.membership.findUnique({
      where: {
        userId_communityId: {
          userId,
          communityId,
        },
      },
    });

    return !!membership;
  }

  async searchMembers(
    communityId: string,
    query: string,
    limit: number = 10,
  ): Promise<MembershipResponseDto[]> {
    const memberships = await this.databaseService.membership.findMany({
      where: {
        communityId,
        user: {
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { displayName: { contains: query, mode: 'insensitive' } },
          ],
        },
      },
      include: {
        user: { select: PUBLIC_USER_SELECT },
      },
      take: limit,
      orderBy: {
        user: {
          username: 'asc',
        },
      },
    });

    return memberships.map(
      (membership) => new MembershipResponseDto(membership),
    );
  }
}
