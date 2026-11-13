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
import { InstanceRole, ModerationAction, RbacActions } from '@prisma/client';
import { ServerEvents } from '@semaphore-chat/shared';
import { DatabaseService } from '@/database/database.service';
import { CommunityService } from '@/community/community.service';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';
import { PermissionsService } from '@/roles/permissions.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { InviteService } from '@/invite/invite.service';
import {
  AcceptInviteResponseDto,
  InviteCommunityDto,
  SkippedInviteCommunityDto,
} from '@/invite/dto/accept-invite-response.dto';
import { RoomName } from '@/common/utils/room-name.util';
import { clampLimit } from '@/common/utils/clamp-limit.util';

@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  static readonly MAX_SEARCH_LIMIT = 50;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly communityService: CommunityService,
    private readonly communityRolesService: CommunityRolesService,
    private readonly eventEmitter: EventEmitter2,
    private readonly permissionsCacheService: PermissionsCacheService,
    private readonly permissionsService: PermissionsService,
    private readonly websocketService: WebsocketService,
    private readonly inviteService: InviteService,
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

  /**
   * Adds an already-registered user to an invite's communities.
   *
   * The code is validated like registration (one service function, so the same
   * refusals); each community goes through `create()` above, so default roles,
   * general-channel membership, events and bans behave as for any other
   * membership. A banned user is skipped for that community only. The use is
   * counted only when at least one community was actually joined, so someone
   * who is already in every community doesn't spend it.
   */
  async acceptInvite(
    code: string,
    userId: string,
  ): Promise<AcceptInviteResponseDto> {
    const invite = await this.inviteService.validateInviteCode(code);
    if (!invite) {
      throw new NotFoundException('No invite found for the provided code.');
    }

    const communityIds = invite.defaultCommunities.map(
      (entry) => entry.communityId,
    );
    const communities = await this.databaseService.community.findMany({
      where: { id: { in: communityIds } },
      select: { id: true, name: true },
    });
    const memberships = await this.databaseService.membership.findMany({
      where: { userId, communityId: { in: communityIds } },
      select: { communityId: true },
    });
    const alreadyIn = new Set(memberships.map((row) => row.communityId));

    const joined: InviteCommunityDto[] = [];
    const skipped: SkippedInviteCommunityDto[] = [];
    const pending: InviteCommunityDto[] = [];
    for (const community of communities) {
      if (alreadyIn.has(community.id)) {
        skipped.push({ ...community, reason: 'already_member' });
      } else {
        pending.push(community);
      }
    }
    if (pending.length === 0) {
      // Nothing to join: no use is consumed.
      return { joined, skipped };
    }

    // Redeem first, atomically (the invite row is locked in the transaction),
    // so the use limit and expiry hold however many users accept at once. A
    // user who already spent a use on a still-usable invite gets
    // 'already_used': no second use. A past use is no pass once the invite is
    // disabled, expired or used up (otherwise a kicked member could rejoin). If
    // every join below then fails (e.g. banned everywhere) the use stays
    // consumed: the invite was valid and the user took part in it.
    const redemption = await this.databaseService.$transaction((tx) =>
      this.inviteService.redeemForExistingUser(tx, invite.code, userId),
    );
    if (redemption === 'unusable') {
      // Same answer as registration gives for an invite that can't be used.
      throw new NotFoundException('No invite found for the provided code.');
    }

    for (const community of pending) {
      try {
        await this.create({ userId, communityId: community.id });
        joined.push(community);
      } catch (error) {
        if (error instanceof ForbiddenException) {
          // Banned, or banned again by a concurrent request: the community is
          // skipped; the rest of the invite still applies.
          skipped.push({ ...community, reason: 'banned' });
          continue;
        }
        if (error instanceof ConflictException) {
          skipped.push({ ...community, reason: 'already_member' });
          continue;
        }
        throw error;
      }
    }

    return { joined, skipped };
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

  /**
   * Leaving (or being removed). The last holder of the community's top role
   * can't go, unless `allowLastTopHolder` (the instance owner removing them).
   */
  async remove(
    userId: string,
    communityId: string,
    allowLastTopHolder = false,
  ): Promise<void> {
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
        if (!allowLastTopHolder) {
          await this.communityRolesService.assertKeepsTopHolder(
            tx,
            userId,
            communityId,
          );
        }

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

        // Alias groups list the community's members
        await tx.aliasGroupMember.deleteMany({
          where: { userId, aliasGroup: { communityId } },
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

      // Domain event, as for a kick: the RoomSubscriptionHandler removes the
      // user's sockets and disconnects them from the community's voice channels
      this.eventEmitter.emit(RoomEvents.MODERATION_USER_KICKED, {
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

  /**
   * Removal of someone else (DELETE_MEMBER): kick's rank rule, kick's log entry
   * and kick's events. Removing yourself is leaving. The instance owner
   * bypasses rank, as for every RBAC check.
   */
  async removeByActor(
    actor: { id: string; role: string },
    userId: string,
    communityId: string,
  ): Promise<void> {
    if (actor.id === userId) {
      return this.remove(userId, communityId);
    }
    if (
      actor.role !== InstanceRole.OWNER &&
      !(await this.permissionsService.outranks(actor.id, userId, communityId))
    ) {
      throw new ForbiddenException(
        'Cannot remove a user with equal or higher role',
      );
    }

    await this.remove(userId, communityId, actor.role === InstanceRole.OWNER);

    await this.databaseService.moderationLog.create({
      data: {
        communityId,
        moderatorId: actor.id,
        action: ModerationAction.KICK_USER,
        targetUserId: userId,
      },
    });

    const payload = { communityId, userId, moderatorId: actor.id };
    this.websocketService.sendToRoom(
      RoomName.user(userId),
      ServerEvents.USER_KICKED,
      payload,
    );
    this.websocketService.sendToRoom(
      RoomName.community(communityId),
      ServerEvents.USER_KICKED,
      payload,
    );
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
    limit = clampLimit(limit, MembershipService.MAX_SEARCH_LIMIT);
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
