import { DatabaseService } from '@/database/database.service';
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { CreateAliasGroupDto } from './dto/create-alias-group.dto';
import { UpdateAliasGroupDto } from './dto/update-alias-group.dto';

export interface AliasGroupMember {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AliasGroupWithMembers {
  id: string;
  name: string;
  communityId: string;
  createdAt: Date;
  memberCount: number;
  members: AliasGroupMember[];
}

export interface AliasGroupSummary {
  id: string;
  name: string;
  communityId: string;
  memberCount: number;
}

// Internal type for Prisma query result
interface AliasGroupMemberWithUser {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

interface AliasGroupQueryResult {
  id: string;
  name: string;
  communityId: string;
  createdAt: Date;
  members: AliasGroupMemberWithUser[];
}

@Injectable()
export class AliasGroupsService {
  private readonly logger = new Logger(AliasGroupsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Helper to transform Prisma result to our interface
   */
  private transformGroupWithMembers(
    group: AliasGroupQueryResult,
  ): AliasGroupWithMembers {
    return {
      id: group.id,
      name: group.name,
      communityId: group.communityId,
      createdAt: group.createdAt,
      memberCount: group.members.length,
      members: group.members.map((m) => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
      })),
    };
  }

  /**
   * Get all alias groups for a community with member counts
   */
  async getCommunityAliasGroups(
    communityId: string,
  ): Promise<AliasGroupSummary[]> {
    const groups = await this.databaseService.aliasGroup.findMany({
      where: { communityId },
      include: {
        _count: {
          select: { members: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      communityId: group.communityId,
      memberCount: group._count.members,
    }));
  }

  /**
   * Get a single alias group with full member details
   */
  async getAliasGroup(groupId: string): Promise<AliasGroupWithMembers> {
    const group = await this.databaseService.aliasGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Alias group not found');
    }

    return this.transformGroupWithMembers(group);
  }

  /**
   * Create a new alias group with optional initial members
   */
  async createAliasGroup(
    communityId: string,
    dto: CreateAliasGroupDto,
  ): Promise<AliasGroupWithMembers> {
    // Check if group name already exists in this community
    const existing = await this.databaseService.aliasGroup.findUnique({
      where: {
        communityId_name: {
          communityId,
          name: dto.name,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Alias group "${dto.name}" already exists in this community`,
      );
    }

    // Validate that all member IDs are valid community members
    if (dto.memberIds && dto.memberIds.length > 0) {
      const validMembers = await this.databaseService.membership.findMany({
        where: {
          communityId,
          userId: { in: dto.memberIds },
        },
        select: { userId: true },
      });

      const validUserIds = new Set(validMembers.map((m) => m.userId));
      const invalidIds = dto.memberIds.filter((id) => !validUserIds.has(id));

      if (invalidIds.length > 0) {
        throw new BadRequestException(
          `Users not members of this community: ${invalidIds.join(', ')}`,
        );
      }
    }

    // Create the group with members
    const group = await this.databaseService.aliasGroup.create({
      data: {
        name: dto.name,
        communityId,
        members:
          dto.memberIds && dto.memberIds.length > 0
            ? {
                create: dto.memberIds.map((userId) => ({ userId })),
              }
            : undefined,
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    const typedGroup = group as AliasGroupQueryResult;

    // Emit domain event — the RoomSubscriptionHandler will join members
    if (dto.memberIds && dto.memberIds.length > 0) {
      this.eventEmitter.emit(RoomEvents.ALIAS_GROUP_CREATED, {
        aliasGroupId: group.id,
        memberIds: dto.memberIds,
      });
    }

    this.logger.log(
      `Created alias group "${dto.name}" in community ${communityId} with ${typedGroup.members.length} members`,
    );

    return this.transformGroupWithMembers(typedGroup);
  }

  /**
   * Update an alias group's name
   */
  async updateAliasGroup(
    groupId: string,
    dto: UpdateAliasGroupDto,
  ): Promise<AliasGroupWithMembers> {
    const group = await this.databaseService.aliasGroup.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Alias group not found');
    }

    // Check if new name conflicts with existing group
    if (dto.name !== group.name) {
      const existing = await this.databaseService.aliasGroup.findUnique({
        where: {
          communityId_name: {
            communityId: group.communityId,
            name: dto.name,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Alias group "${dto.name}" already exists in this community`,
        );
      }
    }

    const updated = await this.databaseService.aliasGroup.update({
      where: { id: groupId },
      data: { name: dto.name },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    this.logger.log(
      `Updated alias group ${groupId}: renamed from "${group.name}" to "${dto.name}"`,
    );

    return this.transformGroupWithMembers(updated);
  }

  /**
   * Delete an alias group and all its memberships
   */
  async deleteAliasGroup(groupId: string): Promise<void> {
    const group = await this.databaseService.aliasGroup.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Alias group not found');
    }

    // Query member IDs before deletion for room cleanup
    const members = await this.databaseService.aliasGroupMember.findMany({
      where: { aliasGroupId: groupId },
      select: { userId: true },
    });
    const memberIds = members.map((m) => m.userId);

    // Delete all members first (cascade should handle this, but be explicit)
    await this.databaseService.aliasGroupMember.deleteMany({
      where: { aliasGroupId: groupId },
    });

    await this.databaseService.aliasGroup.delete({
      where: { id: groupId },
    });

    // Emit domain event — the RoomSubscriptionHandler will remove sockets
    if (memberIds.length > 0) {
      this.eventEmitter.emit(RoomEvents.ALIAS_GROUP_DELETED, {
        aliasGroupId: groupId,
        memberIds,
      });
    }

    this.logger.log(
      `Deleted alias group "${group.name}" (${groupId}) from community ${group.communityId}`,
    );
  }

  /**
   * Add a single member to an alias group
   */
  async addMember(groupId: string, userId: string): Promise<void> {
    const group = await this.databaseService.aliasGroup.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Alias group not found');
    }

    // Verify user is a member of the community
    const membership = await this.databaseService.membership.findUnique({
      where: {
        userId_communityId: {
          userId,
          communityId: group.communityId,
        },
      },
    });

    if (!membership) {
      throw new BadRequestException('User is not a member of this community');
    }

    // Check if already a member
    const existing = await this.databaseService.aliasGroupMember.findUnique({
      where: {
        aliasGroupId_userId: {
          aliasGroupId: groupId,
          userId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member of this group');
    }

    await this.databaseService.aliasGroupMember.create({
      data: {
        aliasGroupId: groupId,
        userId,
      },
    });

    // Emit domain event — the RoomSubscriptionHandler will join sockets
    this.eventEmitter.emit(RoomEvents.ALIAS_GROUP_MEMBER_ADDED, {
      aliasGroupId: groupId,
      userId,
    });

    this.logger.log(`Added user ${userId} to alias group ${groupId}`);
  }

  /**
   * Remove a single member from an alias group
   */
  async removeMember(groupId: string, userId: string): Promise<void> {
    const member = await this.databaseService.aliasGroupMember.findUnique({
      where: {
        aliasGroupId_userId: {
          aliasGroupId: groupId,
          userId,
        },
      },
    });

    if (!member) {
      throw new NotFoundException('User is not a member of this group');
    }

    await this.databaseService.aliasGroupMember.delete({
      where: { id: member.id },
    });

    // Emit domain event — the RoomSubscriptionHandler will remove sockets
    this.eventEmitter.emit(RoomEvents.ALIAS_GROUP_MEMBER_REMOVED, {
      aliasGroupId: groupId,
      userId,
    });

    this.logger.log(`Removed user ${userId} from alias group ${groupId}`);
  }

  /**
   * Replace all members of an alias group
   */
  async updateMembers(groupId: string, memberIds: string[]): Promise<void> {
    const group = await this.databaseService.aliasGroup.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Alias group not found');
    }

    // Validate all user IDs are community members
    if (memberIds.length > 0) {
      const validMembers = await this.databaseService.membership.findMany({
        where: {
          communityId: group.communityId,
          userId: { in: memberIds },
        },
        select: { userId: true },
      });

      const validUserIds = new Set(validMembers.map((m) => m.userId));
      const invalidIds = memberIds.filter((id) => !validUserIds.has(id));

      if (invalidIds.length > 0) {
        throw new BadRequestException(
          `Users not members of this community: ${invalidIds.join(', ')}`,
        );
      }
    }

    // Query current members to compute diff for room subscription changes
    const currentMembers = await this.databaseService.aliasGroupMember.findMany(
      {
        where: { aliasGroupId: groupId },
        select: { userId: true },
      },
    );
    const currentMemberIds = new Set(currentMembers.map((m) => m.userId));
    const newMemberIds = new Set(memberIds);

    const addedUserIds = memberIds.filter((id) => !currentMemberIds.has(id));
    const removedUserIds = [...currentMemberIds].filter(
      (id) => !newMemberIds.has(id),
    );

    // Delete all existing members and create new ones
    await this.databaseService.$transaction([
      this.databaseService.aliasGroupMember.deleteMany({
        where: { aliasGroupId: groupId },
      }),
      ...memberIds.map((userId) =>
        this.databaseService.aliasGroupMember.create({
          data: {
            aliasGroupId: groupId,
            userId,
          },
        }),
      ),
    ]);

    // Emit domain event — the RoomSubscriptionHandler will update rooms
    if (addedUserIds.length > 0 || removedUserIds.length > 0) {
      this.eventEmitter.emit(RoomEvents.ALIAS_GROUP_MEMBERS_UPDATED, {
        aliasGroupId: groupId,
        addedUserIds,
        removedUserIds,
      });
    }

    this.logger.log(
      `Updated alias group ${groupId} members: now has ${memberIds.length} members`,
    );
  }

  /**
   * Get alias group by name for mention resolution
   */
  async getAliasGroupByName(
    communityId: string,
    name: string,
  ): Promise<AliasGroupWithMembers | null> {
    const group = await this.databaseService.aliasGroup.findUnique({
      where: {
        communityId_name: {
          communityId,
          name,
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      return null;
    }

    return this.transformGroupWithMembers(group);
  }

  /**
   * Get member IDs for an alias group (for notification resolution)
   */
  async getAliasGroupMemberIds(groupId: string): Promise<string[]> {
    const members = await this.databaseService.aliasGroupMember.findMany({
      where: { aliasGroupId: groupId },
      select: { userId: true },
    });

    return members.map((m) => m.userId);
  }

  /**
   * Check if a user is a member of any of the given alias groups
   */
  async isUserInAliasGroups(
    userId: string,
    aliasGroupIds: string[],
  ): Promise<boolean> {
    if (aliasGroupIds.length === 0) return false;

    const membership = await this.databaseService.aliasGroupMember.findFirst({
      where: {
        userId,
        aliasGroupId: { in: aliasGroupIds },
      },
    });

    return membership !== null;
  }
}
