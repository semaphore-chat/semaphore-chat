import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InstanceInvite, InstanceRole, User, Prisma } from '@prisma/client';
import { AdminUserEntity } from './dto/admin-user-response.dto';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { InviteService } from '../invite/invite.service';
import { ChannelsService } from '../channels/channels.service';
import { RolesService } from '../roles/roles.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { UserEntity } from './dto/user-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private instanceInviteService: InviteService,
    private channelsService: ChannelsService,
    private rolesService: RolesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findByUsername(username: string): Promise<User | null> {
    return this.databaseService.user.findUnique({
      where: { username },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.databaseService.user.findUnique({
      where: { id },
    });
  }

  async createUser(
    code: string,
    username: string,
    password: string,
    email?: string,
  ): Promise<User> {
    await this.checkForFieldConflicts(username, email);
    const invite = await this.getInvite(code);
    if (!invite) {
      throw new NotFoundException('No invite found for the provided code.');
    }

    const userCount = await this.databaseService.user.count();
    const role = userCount === 0 ? InstanceRole.OWNER : InstanceRole.USER;
    const verified = userCount === 0;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.databaseService.$transaction(async (tx) => {
      const lowerName = username.toLowerCase();
      const createdUser = await tx.user.create({
        data: {
          username: lowerName,
          displayName: lowerName,
          email,
          hashedPassword,
          verified,
          role,
        },
      });

      const updatedInvite = await this.instanceInviteService.redeemInviteWithTx(
        tx,
        invite.code,
        createdUser.id,
      );

      if (!updatedInvite) {
        throw new NotFoundException('Failed to redeem invite.');
      }

      // Add user to default communities specified in the invite
      const defaultCommunityIds = updatedInvite.defaultCommunities.map(
        (dc) => dc.communityId,
      );
      if (defaultCommunityIds.length > 0) {
        await tx.membership.createMany({
          data: defaultCommunityIds.map((communityId) => ({
            userId: createdUser.id,
            communityId,
          })),
        });

        // Add user to general channel and assign Member role in each community
        for (const communityId of defaultCommunityIds) {
          try {
            // Add to general channel
            await this.channelsService.addUserToGeneralChannel(
              communityId,
              createdUser.id,
            );
          } catch (error) {
            // Log error but don't fail user creation
            this.logger.warn(
              `Failed to add user ${createdUser.id} to general channel in community ${communityId}:`,
              error,
            );
          }

          try {
            // Assign Member role to the user
            let memberRole =
              await this.rolesService.getCommunityMemberRole(communityId);

            // If Member role doesn't exist for this community, create it
            if (!memberRole) {
              this.logger.log(
                `Member role not found for community ${communityId}, creating it...`,
              );
              await this.rolesService.createMemberRoleForCommunity(
                communityId,
                tx,
              );
              memberRole =
                await this.rolesService.getCommunityMemberRole(communityId);
            }

            if (memberRole) {
              await this.rolesService.assignUserToCommunityRole(
                createdUser.id,
                communityId,
                memberRole.id,
                tx,
              );
              this.logger.log(
                `Assigned Member role to user ${createdUser.id} in community ${communityId}`,
              );
            } else {
              this.logger.error(
                `Failed to create or find member role for community ${communityId}`,
              );
            }
          } catch (error) {
            this.logger.warn(
              `Failed to assign default member role to user ${createdUser.id} in community ${communityId}`,
              error,
            );
            // Don't fail user creation for this
          }
        }
      }

      return createdUser;
    });

    return user;
  }

  async getInvite(code: string): Promise<InstanceInvite | null> {
    return this.instanceInviteService.validateInviteCode(code);
  }

  async checkForFieldConflicts(
    username?: string,
    email?: string,
  ): Promise<void> {
    const conditions: { username?: string; email?: string }[] = [];
    if (username) conditions.push({ username });
    if (email) conditions.push({ email });

    if (conditions.length === 0) return;

    const existingUser = await this.databaseService.user.findFirst({
      where: {
        OR: conditions,
      },
    });

    if (existingUser) {
      const conflictField =
        existingUser.username === username ? 'username' : 'email';
      throw new ConflictException(
        `A user with this ${conflictField} already exists.`,
      );
    }
  }

  async findAll(limit: number = 50, continuationToken?: string) {
    const query = {
      where: {},
      take: limit,
      orderBy: { username: 'asc' as const },
      ...(continuationToken
        ? { cursor: { id: continuationToken }, skip: 1 }
        : {}),
    };

    const users = (
      await this.databaseService.user.findMany({
        ...query,
        select: PUBLIC_USER_SELECT,
      })
    ).map((u) => new UserEntity(u));
    const nextToken =
      users.length === limit ? users[users.length - 1].id : undefined;

    return { users, continuationToken: nextToken };
  }

  async searchUsers(
    query: string,
    communityId?: string,
    limit: number = 50,
  ): Promise<UserEntity[]> {
    const whereClause: Prisma.UserWhereInput = {
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ],
    };

    // If communityId is provided, filter to users who are NOT already members
    if (communityId) {
      whereClause.NOT = {
        memberships: {
          some: {
            communityId: communityId,
          },
        },
      };
    }

    const users = await this.databaseService.user.findMany({
      where: whereClause,
      select: PUBLIC_USER_SELECT,
      take: limit,
      orderBy: { username: 'asc' },
    });

    return users.map((u) => new UserEntity(u));
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<UserEntity> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: Prisma.UserUpdateInput = {};

    if (updateProfileDto.displayName !== undefined) {
      updateData.displayName = updateProfileDto.displayName.trim();
    }

    if (updateProfileDto.avatar !== undefined) {
      updateData.avatarFile = updateProfileDto.avatar
        ? { connect: { id: updateProfileDto.avatar } }
        : { disconnect: true };
    }

    if (updateProfileDto.banner !== undefined) {
      updateData.bannerFile = updateProfileDto.banner
        ? { connect: { id: updateProfileDto.banner } }
        : { disconnect: true };
    }

    if (updateProfileDto.bio !== undefined) {
      updateData.bio = updateProfileDto.bio.trim() || null;
    }

    if (updateProfileDto.status !== undefined) {
      updateData.status = updateProfileDto.status.trim() || null;
      updateData.statusUpdatedAt = new Date();
    }

    const updatedUser = await this.databaseService.user.update({
      where: { id: userId },
      data: updateData,
    });

    this.eventEmitter.emit(RoomEvents.USER_PROFILE_UPDATED, {
      userId,
      displayName: updatedUser.displayName,
      avatarUrl: updatedUser.avatarUrl,
      bannerUrl: updatedUser.bannerUrl,
      bio: updatedUser.bio,
    });

    return new UserEntity(updatedUser);
  }

  // ============================================
  // Admin User Management Methods
  // ============================================

  /**
   * Get all users with admin-level details (includes ban status)
   */
  async findAllAdmin(
    limit: number = 50,
    continuationToken?: string,
    filters?: {
      banned?: boolean;
      role?: InstanceRole;
      search?: string;
    },
  ): Promise<{ users: AdminUserEntity[]; continuationToken?: string }> {
    const whereClause: Prisma.UserWhereInput = {};

    if (filters?.banned !== undefined) {
      whereClause.banned = filters.banned;
    }

    if (filters?.role) {
      whereClause.role = filters.role;
    }

    if (filters?.search) {
      whereClause.OR = [
        { username: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { displayName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const query = {
      where: whereClause,
      take: limit + 1, // Fetch one extra to determine if there are more
      orderBy: { createdAt: 'desc' as const },
      ...(continuationToken
        ? { cursor: { id: continuationToken }, skip: 1 }
        : {}),
    };

    const users = await this.databaseService.user.findMany(query);
    const hasMore = users.length > limit;
    const resultUsers = hasMore ? users.slice(0, -1) : users;

    return {
      users: resultUsers.map((u) => new AdminUserEntity(u)),
      continuationToken: hasMore
        ? resultUsers[resultUsers.length - 1].id
        : undefined,
    };
  }

  /**
   * Update a user's instance role (OWNER/USER)
   */
  async updateUserRole(
    targetUserId: string,
    newRole: InstanceRole,
    actingUserId: string,
  ): Promise<AdminUserEntity> {
    const targetUser = await this.findById(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Prevent demoting yourself if you're the last owner
    if (
      targetUserId === actingUserId &&
      targetUser.role === InstanceRole.OWNER &&
      newRole !== InstanceRole.OWNER
    ) {
      const ownerCount = await this.databaseService.user.count({
        where: { role: InstanceRole.OWNER },
      });
      if (ownerCount <= 1) {
        throw new ForbiddenException(
          'Cannot demote the last owner. Promote another user first.',
        );
      }
    }

    const updatedUser = await this.databaseService.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
    });

    return new AdminUserEntity(updatedUser);
  }

  /**
   * Ban or unban a user
   */
  async setBanStatus(
    targetUserId: string,
    banned: boolean,
    actingUserId: string,
  ): Promise<AdminUserEntity> {
    const targetUser = await this.findById(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Cannot ban yourself
    if (targetUserId === actingUserId) {
      throw new ForbiddenException('Cannot ban yourself');
    }

    // Cannot ban an OWNER
    if (targetUser.role === InstanceRole.OWNER) {
      throw new ForbiddenException('Cannot ban an instance owner');
    }

    const updatedUser = await this.databaseService.user.update({
      where: { id: targetUserId },
      data: {
        banned,
        bannedAt: banned ? new Date() : null,
        bannedById: banned ? actingUserId : null,
      },
    });

    return new AdminUserEntity(updatedUser);
  }

  /**
   * Delete a user account (admin action)
   */
  async deleteUser(targetUserId: string, actingUserId: string): Promise<void> {
    const targetUser = await this.findById(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Cannot delete yourself
    if (targetUserId === actingUserId) {
      throw new ForbiddenException(
        'Cannot delete your own account through admin panel',
      );
    }

    // Cannot delete an OWNER
    if (targetUser.role === InstanceRole.OWNER) {
      throw new ForbiddenException('Cannot delete an instance owner');
    }

    // Delete user and cascade will handle related records
    await this.databaseService.user.delete({
      where: { id: targetUserId },
    });
  }

  /**
   * Get a single user with admin-level details
   */
  async findByIdAdmin(userId: string): Promise<AdminUserEntity | null> {
    const user = await this.findById(userId);
    if (!user) {
      return null;
    }
    return new AdminUserEntity(user);
  }

  // ============================================
  // User Blocking Methods
  // ============================================

  /**
   * Block a user
   */
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new ForbiddenException('Cannot block yourself');
    }

    const blockedUser = await this.findById(blockedId);
    if (!blockedUser) {
      throw new NotFoundException('User to block not found');
    }

    // Check if already blocked
    const existingBlock = await this.databaseService.userBlock.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });

    if (existingBlock) {
      return; // Already blocked, no-op
    }

    await this.databaseService.userBlock.create({
      data: { blockerId, blockedId },
    });
  }

  /**
   * Unblock a user
   */
  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.databaseService.userBlock.deleteMany({
      where: { blockerId, blockedId },
    });
  }

  /**
   * Get list of users blocked by a user
   */
  async getBlockedUsers(userId: string): Promise<UserEntity[]> {
    const blocks = await this.databaseService.userBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: PUBLIC_USER_SELECT } },
    });

    return blocks.map((block) => new UserEntity(block.blocked));
  }

  /**
   * Check if a user is blocked by another user
   */
  async isUserBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const block = await this.databaseService.userBlock.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });

    return !!block;
  }

  /**
   * Check if either user has blocked the other (bidirectional check)
   */
  async areUsersBlocked(userA: string, userB: string): Promise<boolean> {
    const block = await this.databaseService.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
    });

    return !!block;
  }
}
