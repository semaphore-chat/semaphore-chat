import { RbacResourceType } from '@/auth/rbac-resource.decorator';
import { DatabaseService } from '@/database/database.service';
import { isPrismaError } from '@/common/utils/prisma.utils';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RoomEvents } from '@/rooms/room-subscription.events';
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { RbacActions, Prisma } from '@prisma/client';
import { UserRolesResponseDto, RoleDto } from './dto/user-roles-response.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CommunityRolesResponseDto } from './dto/community-roles-response.dto';
import {
  getDefaultCommunityRoles,
  DEFAULT_ADMIN_ROLE,
  DEFAULT_MEMBER_ROLE,
  DEFAULT_INSTANCE_ADMIN_ROLE,
  DEFAULT_COMMUNITY_CREATOR_ROLE,
  DEFAULT_USER_MANAGER_ROLE,
  DEFAULT_INVITE_MANAGER_ROLE,
  getInstanceAdminActions,
  getCommunityCreatorActions,
  getDefaultInstanceRoles,
  DefaultRoleConfig,
} from './default-roles.config';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Called when the module is initialized.
   * Ensures all default instance roles exist for existing instances.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaultInstanceRolesExist();
    } catch (error) {
      // Log but don't fail startup - database might not be ready yet
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not ensure default instance roles exist: ${message}`,
      );
    }
  }

  async verifyActionsForUserAndResource(
    userId: string,
    resourceId: string | undefined,
    resourceType: RbacResourceType | undefined,
    action: RbacActions[],
  ): Promise<boolean> {
    // Handle instance-level permissions
    if (
      resourceId === undefined ||
      resourceType === RbacResourceType.INSTANCE
    ) {
      const userRoles = await this.databaseService.userRoles.findMany({
        where: {
          userId,
          isInstanceRole: true,
        },
        include: {
          role: true,
        },
      });

      const roles = userRoles.map((ur) => ur.role);
      const allActions = roles.flatMap((role) => role.actions);
      return action.every((a) => allActions.includes(a));
    }

    // Resolve the community ID based on resource type
    let communityId: string;

    if (resourceType === RbacResourceType.COMMUNITY) {
      communityId = resourceId!;
    } else if (resourceType === RbacResourceType.CHANNEL) {
      // Get the channel to find its community and privacy status
      const channel = await this.databaseService.channel.findUnique({
        where: { id: resourceId },
        select: { communityId: true, isPrivate: true },
      });

      if (!channel) {
        this.logger.warn(`Channel not found for RBAC check: ${resourceId}`);
        return false; // Channel doesn't exist
      }

      // Private channels require explicit channel membership
      if (channel.isPrivate) {
        const channelMembership =
          await this.databaseService.channelMembership.findUnique({
            where: { userId_channelId: { userId, channelId: resourceId } },
          });

        if (!channelMembership) {
          return false;
        }
      }

      communityId = channel.communityId;
    } else if (resourceType === RbacResourceType.MESSAGE) {
      // Get the message to find its channel, then the channel's community
      const message = await this.databaseService.message.findUnique({
        where: { id: resourceId },
        select: {
          channelId: true,
          directMessageGroupId: true,
          channel: {
            select: { communityId: true, isPrivate: true },
          },
        },
      });

      if (!message) {
        this.logger.warn(`Message not found for RBAC check: ${resourceId}`);
        return false; // Message doesn't exist
      }

      if (message.directMessageGroupId) {
        // This is a DM message - check if user is member of the DM group
        const dmMembership =
          await this.databaseService.directMessageGroupMember.findFirst({
            where: {
              userId,
              groupId: message.directMessageGroupId,
            },
          });

        if (dmMembership) {
          this.logger.debug(
            `DM message access granted: ${resourceId} for user: ${userId}`,
          );
          return true;
        } else {
          this.logger.debug(
            `DM message access denied - user not in group: ${resourceId} for user: ${userId}`,
          );
          return false;
        }
      }

      if (!message.channel) {
        this.logger.warn(`Message has no associated channel: ${resourceId}`);
        return false; // Message has no associated channel
      }

      // Private channels require explicit channel membership
      if (message.channel.isPrivate && message.channelId) {
        const channelMembership =
          await this.databaseService.channelMembership.findUnique({
            where: {
              userId_channelId: { userId, channelId: message.channelId },
            },
          });

        if (!channelMembership) {
          return false;
        }
      }

      communityId = message.channel.communityId;
    } else if (resourceType === RbacResourceType.DM_GROUP) {
      // For DM groups, check if the user is a member of the DM group
      const dmMembership =
        await this.databaseService.directMessageGroupMember.findFirst({
          where: {
            userId,
            groupId: resourceId,
          },
        });

      // For DM groups, we allow access if the user is a member
      // All DM group members have full permissions within their group
      if (dmMembership) {
        this.logger.debug(
          `DM group access granted for member: ${userId} in group: ${resourceId}`,
        );
        return true;
      } else {
        this.logger.debug(
          `DM group access denied - user not a member: ${userId} in group: ${resourceId}`,
        );
        return false;
      }
    } else if (resourceType === RbacResourceType.ALIAS_GROUP) {
      // Get the alias group to find its community
      const aliasGroup = await this.databaseService.aliasGroup.findUnique({
        where: { id: resourceId },
        select: { communityId: true },
      });

      if (!aliasGroup) {
        this.logger.warn(`Alias group not found for RBAC check: ${resourceId}`);
        return false;
      }

      communityId = aliasGroup.communityId;
    } else {
      this.logger.error(
        `Unknown resource type: ${resourceType} for resource: ${resourceId}`,
      );
      return false; // Unknown resource type
    }

    // Check user roles in the resolved community
    const userRoles = await this.databaseService.userRoles.findMany({
      where: {
        userId,
        communityId,
        isInstanceRole: false,
      },
      include: {
        role: true,
      },
    });

    const roles = userRoles.map((ur) => ur.role);
    const allActions = roles.flatMap((role) => role.actions);

    // Check if the user has all the required actions
    return action.every((a) => allActions.includes(a));
  }

  async getUserRolesForCommunity(
    userId: string,
    communityId: string,
  ): Promise<UserRolesResponseDto> {
    const userRoles = await this.databaseService.userRoles.findMany({
      where: {
        userId,
        communityId,
        isInstanceRole: false,
      },
      include: {
        role: true,
      },
    });

    const roles: RoleDto[] = userRoles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      actions: ur.role.actions,
      createdAt: ur.role.createdAt,
      isDefault: ur.role.isDefault,
    }));

    return {
      userId,
      resourceId: communityId,
      resourceType: 'COMMUNITY',
      roles,
    };
  }

  async getUserRolesForChannel(
    userId: string,
    channelId: string,
  ): Promise<UserRolesResponseDto> {
    // First, get the channel to find its community
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: { communityId: true },
    });

    if (!channel) {
      // Return empty roles if channel doesn't exist or user has no access
      return {
        userId,
        resourceId: channelId,
        resourceType: 'CHANNEL',
        roles: [],
      };
    }

    // For channels, we inherit roles from the community
    // In the future, you might want to add channel-specific roles
    const userRoles = await this.databaseService.userRoles.findMany({
      where: {
        userId,
        communityId: channel.communityId,
        isInstanceRole: false,
      },
      include: {
        role: true,
      },
    });

    const roles: RoleDto[] = userRoles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      actions: ur.role.actions,
      createdAt: ur.role.createdAt,
      isDefault: ur.role.isDefault,
    }));

    return {
      userId,
      resourceId: channelId,
      resourceType: 'CHANNEL',
      roles,
    };
  }

  async getUserInstanceRoles(userId: string): Promise<UserRolesResponseDto> {
    const userRoles = await this.databaseService.userRoles.findMany({
      where: {
        userId,
        isInstanceRole: true,
      },
      include: {
        role: true,
      },
    });

    const roles: RoleDto[] = userRoles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      actions: ur.role.actions,
      createdAt: ur.role.createdAt,
      isDefault: ur.role.isDefault,
    }));

    return {
      userId,
      resourceId: null,
      resourceType: 'INSTANCE',
      roles,
    };
  }

  /**
   * Creates default roles for a new community
   * Returns the admin role ID for assigning to the creator
   */
  async createDefaultCommunityRoles(
    communityId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const database = tx || this.databaseService;
    const defaultRoles = getDefaultCommunityRoles();

    let adminRoleId: string;

    for (const defaultRole of defaultRoles) {
      const role = await database.role.create({
        data: {
          name: defaultRole.name,
          communityId,
          isDefault: true,
          actions: defaultRole.actions,
        },
      });

      // Store admin role ID to return it
      if (defaultRole.name === DEFAULT_ADMIN_ROLE.name) {
        adminRoleId = role.id;
      }
    }

    return adminRoleId!;
  }

  /**
   * Assigns a user to a role in a community
   */
  async assignUserToCommunityRole(
    userId: string,
    communityId: string,
    roleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const database = tx || this.databaseService;

    await database.userRoles.create({
      data: {
        userId,
        communityId,
        roleId,
        isInstanceRole: false,
      },
    });

    // Only emit when not called within a transaction (e.g., community creation)
    if (!tx) {
      // Fetch role name for the event payload
      const role = await this.databaseService.role.findUnique({
        where: { id: roleId },
        select: { name: true },
      });

      this.eventEmitter.emit(RoomEvents.ROLE_ASSIGNED, {
        communityId,
        userId,
        roleId,
        roleName: role?.name ?? '',
      });
    }
  }

  /**
   * Gets the admin role for a specific community
   */
  async getCommunityAdminRole(communityId: string): Promise<RoleDto | null> {
    const role = await this.databaseService.role.findFirst({
      where: {
        name: DEFAULT_ADMIN_ROLE.name,
        communityId,
      },
    });

    if (!role) return null;

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }

  /**
   * Gets the moderator role for a specific community
   */
  async getCommunityModeratorRole(
    communityId: string,
  ): Promise<RoleDto | null> {
    const role = await this.databaseService.role.findFirst({
      where: {
        name: 'Moderator',
        communityId,
      },
    });

    if (!role) return null;

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }

  /**
   * Gets the member role for a specific community
   */
  async getCommunityMemberRole(communityId: string): Promise<RoleDto | null> {
    const role = await this.databaseService.role.findFirst({
      where: {
        name: DEFAULT_MEMBER_ROLE.name,
        communityId,
      },
    });

    if (!role) return null;

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }

  /**
   * Creates just the Member role for a community (used for runtime creation)
   */
  async createMemberRoleForCommunity(
    communityId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const database = tx || this.databaseService;

    const role = await database.role.create({
      data: {
        name: DEFAULT_MEMBER_ROLE.name,
        communityId,
        isDefault: true,
        actions: DEFAULT_MEMBER_ROLE.actions,
      },
    });

    return role.id;
  }

  /**
   * Reset default community roles to their default permissions.
   * Creates missing default roles and resets permissions on existing ones.
   * Preserves user assignments and custom roles.
   */
  async resetDefaultCommunityRoles(
    communityId: string,
  ): Promise<CommunityRolesResponseDto> {
    const defaultRoles = getDefaultCommunityRoles();

    await this.databaseService.$transaction(async (tx) => {
      for (const defaultRole of defaultRoles) {
        const existing = await tx.role.findFirst({
          where: { name: defaultRole.name, communityId },
        });

        if (existing) {
          await tx.role.update({
            where: { id: existing.id },
            data: { actions: defaultRole.actions, isDefault: true },
          });
        } else {
          await tx.role.create({
            data: {
              name: defaultRole.name,
              communityId,
              isDefault: true,
              actions: defaultRole.actions,
            },
          });
        }
      }
    });

    this.logger.log(`Reset default roles for community ${communityId}`);
    return this.getCommunityRoles(communityId);
  }

  /**
   * Get all roles for a community
   */
  async getCommunityRoles(
    communityId: string,
  ): Promise<CommunityRolesResponseDto> {
    const roles = await this.databaseService.role.findMany({
      where: { communityId },
      orderBy: { createdAt: 'asc' },
    });

    const roleDtos: RoleDto[] = roles.map((role) => ({
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    }));

    return {
      communityId,
      roles: roleDtos,
    };
  }

  /**
   * Create a custom role for a community
   */
  async createCommunityRole(
    communityId: string,
    createRoleDto: CreateRoleDto,
    tx?: Prisma.TransactionClient,
  ): Promise<RoleDto> {
    const database = tx || this.databaseService;

    // Check if role with this name already exists for the community
    const existingRole = await database.role.findFirst({
      where: {
        name: createRoleDto.name,
        communityId,
      },
    });

    if (existingRole) {
      throw new ConflictException(
        `Role with name "${createRoleDto.name}" already exists in this community`,
      );
    }

    // Validate that all actions are valid
    const validActions = Object.values(RbacActions);
    const invalidActions = createRoleDto.actions.filter(
      (action) => !validActions.includes(action),
    );

    if (invalidActions.length > 0) {
      throw new BadRequestException(
        `Invalid actions: ${invalidActions.join(', ')}`,
      );
    }

    const role = await database.role.create({
      data: {
        name: createRoleDto.name,
        communityId,
        isDefault: false,
        actions: createRoleDto.actions,
      },
    });

    this.logger.log(
      `Created custom role "${createRoleDto.name}" for community ${communityId}`,
    );

    // Only emit when not called within a transaction (e.g., community creation)
    if (!tx) {
      this.eventEmitter.emit(RoomEvents.ROLE_CREATED, {
        communityId,
        roleId: role.id,
        roleName: role.name,
      });
    }

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }

  /**
   * Update a role's permissions
   */
  async updateRole(
    roleId: string,
    communityId: string,
    updateRoleDto: UpdateRoleDto,
    tx?: Prisma.TransactionClient,
  ): Promise<RoleDto> {
    const database = tx || this.databaseService;

    // Check if role exists
    const existingRole = await database.role.findUnique({
      where: { id: roleId },
    });

    if (!existingRole) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Verify the role belongs to this community
    if (existingRole.communityId !== communityId) {
      throw new NotFoundException(
        `Role with ID ${roleId} not found in this community`,
      );
    }

    // Check if this is a default role and prevent name changes (but allow permission changes)
    if (
      existingRole.isDefault &&
      updateRoleDto.name &&
      updateRoleDto.name.trim() !== existingRole.name.trim()
    ) {
      throw new BadRequestException(
        'Cannot change the name of default roles. Only permissions can be modified.',
      );
    }

    // Validate actions if provided
    if (updateRoleDto.actions) {
      const validActions = Object.values(RbacActions);
      const invalidActions = updateRoleDto.actions.filter(
        (action) => !validActions.includes(action),
      );

      if (invalidActions.length > 0) {
        throw new BadRequestException(
          `Invalid actions: ${invalidActions.join(', ')}`,
        );
      }
    }

    // If name is being updated, check for conflicts
    let newName = existingRole.name;
    if (updateRoleDto.name) {
      newName = updateRoleDto.name;

      const conflictingRole = await database.role.findFirst({
        where: {
          name: newName,
          communityId: existingRole.communityId,
          id: { not: roleId },
        },
      });

      if (conflictingRole) {
        throw new ConflictException(
          `Role with name "${updateRoleDto.name}" already exists in this community`,
        );
      }
    }

    const updatedRole = await database.role.update({
      where: { id: roleId },
      data: {
        name: newName,
        actions: updateRoleDto.actions,
      },
    });

    this.logger.log(`Updated role ${roleId}`);

    if (!tx) {
      this.eventEmitter.emit(RoomEvents.ROLE_UPDATED, {
        communityId,
        roleId,
        roleName: updatedRole.name,
      });
    }

    return {
      id: updatedRole.id,
      name: updatedRole.name,
      actions: updatedRole.actions,
      createdAt: updatedRole.createdAt,
      isDefault: updatedRole.isDefault,
    };
  }

  /**
   * Delete a custom role
   */
  async deleteRole(
    roleId: string,
    communityId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const database = tx || this.databaseService;

    // Check if role exists
    const existingRole = await database.role.findUnique({
      where: { id: roleId },
      include: {
        UserRoles: true,
      },
    });

    if (!existingRole) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Verify the role belongs to this community
    if (existingRole.communityId !== communityId) {
      throw new NotFoundException(
        `Role with ID ${roleId} not found in this community`,
      );
    }

    // Prevent deleting default roles
    if (existingRole.isDefault) {
      throw new BadRequestException('Cannot delete default roles.');
    }

    // Check if role is assigned to any users
    if (existingRole.UserRoles.length > 0) {
      throw new BadRequestException(
        `Cannot delete role "${existingRole.name}" because it is assigned to ${existingRole.UserRoles.length} user(s). Remove all role assignments first.`,
      );
    }

    await database.role.delete({
      where: { id: roleId },
    });

    this.logger.log(`Deleted role ${roleId}`);

    if (!tx) {
      this.eventEmitter.emit(RoomEvents.ROLE_DELETED, {
        communityId,
        roleId,
      });
    }
  }

  /**
   * Remove a user from a role in a community
   */
  async removeUserFromCommunityRole(
    userId: string,
    communityId: string,
    roleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const database = tx || this.databaseService;

    // Find and delete the user role assignment
    const userRole = await database.userRoles.findFirst({
      where: {
        userId,
        communityId,
        roleId,
        isInstanceRole: false,
      },
    });

    if (!userRole) {
      throw new NotFoundException('User role assignment not found');
    }

    await database.userRoles.delete({
      where: { id: userRole.id },
    });

    this.logger.log(
      `Removed user ${userId} from role ${roleId} in community ${communityId}`,
    );

    if (!tx) {
      this.eventEmitter.emit(RoomEvents.ROLE_UNASSIGNED, {
        communityId,
        userId,
        roleId,
      });
    }
  }

  /**
   * Get all users assigned to a specific role
   */
  async getUsersForRole(
    roleId: string,
    communityId?: string,
  ): Promise<
    Array<{ userId: string; username: string; displayName?: string }>
  > {
    const userRoles = await this.databaseService.userRoles.findMany({
      where: {
        roleId,
        communityId,
        isInstanceRole: communityId === undefined,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    return userRoles.map((ur) => ({
      userId: ur.user.id,
      username: ur.user.username,
      displayName: ur.user.displayName || undefined,
    }));
  }

  // ===== INSTANCE ROLE MANAGEMENT =====

  /**
   * Create the default instance admin role (idempotent - returns existing if found)
   */
  async createDefaultInstanceRole(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const database = tx || this.databaseService;

    const existingRole = await database.role.findFirst({
      where: { name: DEFAULT_INSTANCE_ADMIN_ROLE.name, communityId: null },
    });

    if (existingRole) {
      this.logger.log(
        `Default instance admin role already exists: ${existingRole.id}`,
      );
      return existingRole.id;
    }

    const role = await database.role.create({
      data: {
        name: DEFAULT_INSTANCE_ADMIN_ROLE.name,
        actions: DEFAULT_INSTANCE_ADMIN_ROLE.actions,
        communityId: null,
        isDefault: true,
      },
    });

    this.logger.log(`Created default instance admin role: ${role.id}`);
    return role.id;
  }

  /**
   * Get all instance-level roles
   */
  async getInstanceRoles(): Promise<RoleDto[]> {
    // Get names of all default instance roles
    const defaultInstanceRoleNames = getDefaultInstanceRoles().map(
      (r) => r.name,
    );

    // Find roles that are either:
    // 1. Named as one of the default instance roles
    // 2. Have been assigned as instance roles (isInstanceRole=true in UserRoles)
    const roles = await this.databaseService.role.findMany({
      where: {
        communityId: null,
        OR: [
          { name: { in: defaultInstanceRoleNames } },
          { UserRoles: { some: { isInstanceRole: true } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    }));
  }

  /**
   * Create a custom instance role
   */
  async createInstanceRole(
    name: string,
    actions: RbacActions[],
  ): Promise<RoleDto> {
    // Validate that all actions are valid instance-level actions
    const validActions = getInstanceAdminActions();
    const invalidActions = actions.filter((a) => !validActions.includes(a));

    if (invalidActions.length > 0) {
      throw new BadRequestException(
        `Actions not valid for instance roles: ${invalidActions.join(', ')}`,
      );
    }

    // Check if role with this name already exists
    const existingRole = await this.databaseService.role.findFirst({
      where: { name, communityId: null },
    });

    if (existingRole) {
      throw new ConflictException(`Role with name "${name}" already exists`);
    }

    const role = await this.databaseService.role.create({
      data: {
        name,
        actions,
        communityId: null,
        isDefault: false,
      },
    });

    this.logger.log(`Created custom instance role: ${name}`);

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }

  /**
   * Update an instance role's name or permissions
   */
  async updateInstanceRole(
    roleId: string,
    dto: UpdateRoleDto,
  ): Promise<RoleDto> {
    const role = await this.databaseService.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Don't allow renaming the default instance admin role
    if (
      role.name === DEFAULT_INSTANCE_ADMIN_ROLE.name &&
      dto.name &&
      dto.name !== DEFAULT_INSTANCE_ADMIN_ROLE.name
    ) {
      throw new BadRequestException(
        'Cannot rename the default Instance Admin role',
      );
    }

    // Validate actions if provided
    if (dto.actions) {
      const validActions = getInstanceAdminActions();
      const invalidActions = dto.actions.filter(
        (a) => !validActions.includes(a),
      );

      if (invalidActions.length > 0) {
        throw new BadRequestException(
          `Actions not valid for instance roles: ${invalidActions.join(', ')}`,
        );
      }
    }

    // Check for name conflicts if renaming
    if (dto.name && dto.name !== role.name) {
      const conflictingRole = await this.databaseService.role.findFirst({
        where: {
          name: dto.name,
          id: { not: roleId },
        },
      });

      if (conflictingRole) {
        throw new ConflictException(
          `Role with name "${dto.name}" already exists`,
        );
      }
    }

    const updated = await this.databaseService.role.update({
      where: { id: roleId },
      data: {
        name: dto.name || role.name,
        actions: dto.actions || role.actions,
      },
    });

    this.logger.log(`Updated instance role ${roleId}`);

    return {
      id: updated.id,
      name: updated.name,
      actions: updated.actions,
      createdAt: updated.createdAt,
      isDefault: updated.isDefault,
    };
  }

  /**
   * Delete a custom instance role (cannot delete the default)
   */
  async deleteInstanceRole(roleId: string): Promise<void> {
    const role = await this.databaseService.role.findUnique({
      where: { id: roleId },
      include: {
        UserRoles: {
          where: { isInstanceRole: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (role.name === DEFAULT_INSTANCE_ADMIN_ROLE.name) {
      throw new BadRequestException(
        'Cannot delete the default Instance Admin role',
      );
    }

    if (role.UserRoles.length > 0) {
      throw new BadRequestException(
        `Cannot delete role with ${role.UserRoles.length} assigned user(s). Remove all role assignments first.`,
      );
    }

    await this.databaseService.role.delete({
      where: { id: roleId },
    });

    this.logger.log(`Deleted instance role ${roleId}`);
  }

  /**
   * Assign a user to an instance role
   */
  async assignUserToInstanceRole(
    userId: string,
    roleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const database = tx || this.databaseService;

    // Check role exists
    const role = await database.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Check if already assigned
    const existing = await database.userRoles.findFirst({
      where: {
        userId,
        roleId,
        isInstanceRole: true,
      },
    });

    if (existing) {
      throw new ConflictException('User already has this instance role');
    }

    await database.userRoles.create({
      data: {
        userId,
        roleId,
        isInstanceRole: true,
        communityId: null,
      },
    });

    this.logger.log(
      `Assigned user ${userId} to instance role ${roleId} (${role.name})`,
    );
  }

  /**
   * Remove a user from an instance role
   */
  async removeUserFromInstanceRole(
    userId: string,
    roleId: string,
  ): Promise<void> {
    const userRole = await this.databaseService.userRoles.findFirst({
      where: {
        userId,
        roleId,
        isInstanceRole: true,
      },
    });

    if (!userRole) {
      throw new NotFoundException('User role assignment not found');
    }

    await this.databaseService.userRoles.delete({
      where: { id: userRole.id },
    });

    this.logger.log(`Removed user ${userId} from instance role ${roleId}`);
  }

  /**
   * Get users assigned to an instance role
   */
  async getInstanceRoleUsers(
    roleId: string,
  ): Promise<
    Array<{ userId: string; username: string; displayName?: string }>
  > {
    const userRoles = await this.databaseService.userRoles.findMany({
      where: {
        roleId,
        isInstanceRole: true,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    return userRoles.map((ur) => ({
      userId: ur.user.id,
      username: ur.user.username,
      displayName: ur.user.displayName || undefined,
    }));
  }

  // ===== COMMUNITY CREATOR ROLE MANAGEMENT =====

  /**
   * Create the default Community Creator role (idempotent - returns existing if found)
   * This role allows users to create and manage their own communities
   */
  async createDefaultCommunityCreatorRole(
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const database = tx || this.databaseService;

    const existingRole = await database.role.findFirst({
      where: { name: DEFAULT_COMMUNITY_CREATOR_ROLE.name, communityId: null },
    });

    if (existingRole) {
      this.logger.log(
        `Default Community Creator role already exists: ${existingRole.id}`,
      );
      return existingRole.id;
    }

    const role = await database.role.create({
      data: {
        name: DEFAULT_COMMUNITY_CREATOR_ROLE.name,
        actions: DEFAULT_COMMUNITY_CREATOR_ROLE.actions,
        communityId: null,
        isDefault: true,
      },
    });

    this.logger.log(`Created default Community Creator role: ${role.id}`);
    return role.id;
  }

  /**
   * Get the Community Creator role
   */
  async getCommunityCreatorRole(): Promise<RoleDto | null> {
    const role = await this.databaseService.role.findFirst({
      where: { name: DEFAULT_COMMUNITY_CREATOR_ROLE.name, communityId: null },
    });

    if (!role) return null;

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }

  /**
   * Get all valid community creator actions
   */
  getCommunityCreatorActions(): RbacActions[] {
    return getCommunityCreatorActions();
  }

  // ===== DEFAULT INSTANCE ROLES BOOTSTRAP =====

  /**
   * Ensures all default instance roles exist in the database.
   * This is idempotent - safe to call multiple times.
   * Should be called on application startup to ensure roles exist for existing instances.
   */
  async ensureDefaultInstanceRolesExist(): Promise<void> {
    const defaultRoles = getDefaultInstanceRoles();

    for (const roleConfig of defaultRoles) {
      await this.ensureInstanceRoleExists(roleConfig);
    }

    this.logger.log(
      `Ensured ${defaultRoles.length} default instance roles exist`,
    );
  }

  /**
   * Ensures a single instance role exists (idempotent)
   */
  private async ensureInstanceRoleExists(
    roleConfig: DefaultRoleConfig,
  ): Promise<string> {
    const existingRole = await this.databaseService.role.findFirst({
      where: { name: roleConfig.name, communityId: null },
    });

    if (existingRole) {
      this.logger.debug(`Instance role "${roleConfig.name}" already exists`);
      return existingRole.id;
    }

    try {
      const role = await this.databaseService.role.create({
        data: {
          name: roleConfig.name,
          actions: roleConfig.actions,
          communityId: null,
          isDefault: true,
        },
      });

      this.logger.log(`Created default instance role: ${roleConfig.name}`);
      return role.id;
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        // Race condition: another replica created the role between our findFirst and create
        const role = await this.databaseService.role.findFirst({
          where: { name: roleConfig.name, communityId: null },
        });
        return role!.id;
      }
      throw error;
    }
  }

  /**
   * Get the User Manager role
   */
  async getUserManagerRole(): Promise<RoleDto | null> {
    const role = await this.databaseService.role.findFirst({
      where: { name: DEFAULT_USER_MANAGER_ROLE.name, communityId: null },
    });

    if (!role) return null;

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }

  /**
   * Get the Invite Manager role
   */
  async getInviteManagerRole(): Promise<RoleDto | null> {
    const role = await this.databaseService.role.findFirst({
      where: { name: DEFAULT_INVITE_MANAGER_ROLE.name, communityId: null },
    });

    if (!role) return null;

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
    };
  }
}
