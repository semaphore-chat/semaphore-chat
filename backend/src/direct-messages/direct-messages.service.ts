import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from '@/database/database.service';
import { CreateDmGroupDto } from './dto/create-dm-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { DmGroupResponseDto } from './dto/dm-group-response.dto';
import { RoomEvents } from '@/rooms/room-subscription.events';

@Injectable()
export class DirectMessagesService {
  private readonly logger = new Logger(DirectMessagesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findUserDmGroups(userId: string): Promise<DmGroupResponseDto[]> {
    // Step 1: Get user's DM group memberships (just group IDs)
    const memberships =
      await this.databaseService.directMessageGroupMember.findMany({
        where: { userId },
        select: { groupId: true },
      });

    if (memberships.length === 0) {
      return [];
    }

    const groupIds = memberships.map((m) => m.groupId);

    // Step 2: Batch queries in parallel for better performance
    const [groups, allMembers, lastMessages] = await Promise.all([
      // Fetch all groups
      this.databaseService.directMessageGroup.findMany({
        where: { id: { in: groupIds } },
        orderBy: { createdAt: 'desc' },
      }),
      // Fetch all members for all groups with user data
      this.databaseService.directMessageGroupMember.findMany({
        where: { groupId: { in: groupIds } },
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
      }),
      // Fetch last message for each group
      // Use Message model (DM messages have directMessageGroupId set)
      this.databaseService.message.findMany({
        where: { directMessageGroupId: { in: groupIds } },
        orderBy: { sentAt: 'desc' },
        select: {
          id: true,
          authorId: true,
          spans: true,
          sentAt: true,
          directMessageGroupId: true,
        },
      }),
    ]);

    // Step 3: Build lookup maps for efficient assembly
    const membersByGroupId = new Map<string, typeof allMembers>();
    for (const member of allMembers) {
      const existing = membersByGroupId.get(member.groupId) || [];
      existing.push(member);
      membersByGroupId.set(member.groupId, existing);
    }

    // Get first (most recent) message per group
    const lastMessageByGroupId = new Map<
      string,
      (typeof lastMessages)[0] | null
    >();
    for (const message of lastMessages) {
      if (
        message.directMessageGroupId &&
        !lastMessageByGroupId.has(message.directMessageGroupId)
      ) {
        lastMessageByGroupId.set(message.directMessageGroupId, message);
      }
    }

    // Step 4: Assemble response
    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      isGroup: group.isGroup,
      createdAt: group.createdAt,
      members: membersByGroupId.get(group.id) || [],
      lastMessage: lastMessageByGroupId.get(group.id) || null,
    }));
  }

  async createDmGroup(
    createDmGroupDto: CreateDmGroupDto,
    creatorId: string,
  ): Promise<DmGroupResponseDto> {
    // Include the creator in the user list if not already present
    const allUserIds = Array.from(
      new Set([creatorId, ...createDmGroupDto.userIds]),
    );

    // Determine if it's a group (more than 2 users) or 1:1 DM
    const isGroup = createDmGroupDto.isGroup ?? allUserIds.length > 2;

    // For 1:1 DMs, check if one already exists
    if (!isGroup && allUserIds.length === 2) {
      const existingDm = await this.findExisting1on1Dm(
        allUserIds[0],
        allUserIds[1],
      );
      if (existingDm) {
        return this.formatDmGroupResponse(existingDm);
      }
    }

    // Create the DM group
    const dmGroup = await this.databaseService.directMessageGroup.create({
      data: {
        name: createDmGroupDto.name,
        isGroup,
        members: {
          create: allUserIds.map((userId) => ({
            userId,
          })),
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
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
          select: {
            id: true,
            authorId: true,
            spans: true,
            sentAt: true,
          },
        },
      },
    });

    // Emit domain event — the RoomSubscriptionHandler will join all members
    this.eventEmitter.emit(RoomEvents.DM_GROUP_CREATED, {
      groupId: dmGroup.id,
      memberIds: allUserIds,
    });

    return this.formatDmGroupResponse(dmGroup);
  }

  async findDmGroup(
    groupId: string,
    userId: string,
  ): Promise<DmGroupResponseDto> {
    // Verify user is a member of this DM group
    const membership =
      await this.databaseService.directMessageGroupMember.findFirst({
        where: {
          groupId,
          userId,
        },
      });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this DM group');
    }

    const dmGroup = await this.databaseService.directMessageGroup.findUnique({
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
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
          select: {
            id: true,
            authorId: true,
            spans: true,
            sentAt: true,
          },
        },
      },
    });

    if (!dmGroup) {
      throw new NotFoundException('DM group not found');
    }

    return this.formatDmGroupResponse(dmGroup);
  }

  async addMembers(
    groupId: string,
    addMembersDto: AddMembersDto,
    userId: string,
  ): Promise<DmGroupResponseDto> {
    // Verify user is a member and the group is a group chat (not 1:1 DM)
    const dmGroup = await this.databaseService.directMessageGroup.findFirst({
      where: { id: groupId },
      include: {
        members: {
          where: { userId },
        },
      },
    });

    if (!dmGroup || dmGroup.members.length === 0) {
      throw new ForbiddenException('You are not a member of this DM group');
    }

    if (!dmGroup.isGroup) {
      throw new ForbiddenException('Cannot add members to a 1:1 DM');
    }

    // Add new members (check for duplicates manually to avoid errors)
    for (const newUserId of addMembersDto.userIds) {
      try {
        await this.databaseService.directMessageGroupMember.create({
          data: {
            groupId,
            userId: newUserId,
          },
        });
      } catch {
        // Ignore duplicate member errors
        this.logger.warn(
          `User ${newUserId} is already a member of group ${groupId}`,
        );
      }
    }

    // Emit domain event — the RoomSubscriptionHandler will join new members
    this.eventEmitter.emit(RoomEvents.DM_GROUP_MEMBER_ADDED, {
      groupId,
      userIds: addMembersDto.userIds,
    });

    return this.findDmGroup(groupId, userId);
  }

  async leaveDmGroup(groupId: string, userId: string): Promise<void> {
    await this.databaseService.directMessageGroupMember.delete({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    // Emit domain event — the RoomSubscriptionHandler will remove sockets
    this.eventEmitter.emit(RoomEvents.DM_GROUP_MEMBER_LEFT, {
      groupId,
      userId,
    });
  }

  private async findExisting1on1Dm(userId1: string, userId2: string) {
    return this.databaseService.directMessageGroup.findFirst({
      where: {
        isGroup: false,
        members: {
          every: {
            userId: { in: [userId1, userId2] },
          },
        },
        // Ensure we have exactly 2 members
        AND: {
          members: {
            none: {
              userId: { notIn: [userId1, userId2] },
            },
          },
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
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
          select: {
            id: true,
            authorId: true,
            spans: true,
            sentAt: true,
          },
        },
      },
    });
  }

  private formatDmGroupResponse(dmGroup: {
    id: string;
    name: string | null;
    isGroup: boolean;
    createdAt: Date;
    members: {
      id: string;
      userId: string;
      joinedAt: Date;
      user: {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
      };
    }[];
    messages: {
      id: string;
      authorId: string | null;
      spans: any[];
      sentAt: Date;
    }[];
  }): DmGroupResponseDto {
    return {
      id: dmGroup.id,
      name: dmGroup.name,
      isGroup: dmGroup.isGroup,
      createdAt: dmGroup.createdAt,
      members: dmGroup.members,
      lastMessage: dmGroup.messages[0] || null,
    };
  }
}
