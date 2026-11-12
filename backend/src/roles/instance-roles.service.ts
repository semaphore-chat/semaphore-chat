import { DatabaseService } from '@/database/database.service';
import { isPrismaError } from '@/common/utils/prisma.utils';
import {
  EpochBump,
  PermissionsCacheService,
} from './permissions-cache.service';
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { InstanceRole, RbacActions, Prisma } from '@prisma/client';
import { UserRolesResponseDto, RoleDto } from './dto/user-roles-response.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
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
export class InstanceRolesService implements OnModuleInit {
  private readonly logger = new Logger(InstanceRolesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly permissionsCacheService: PermissionsCacheService,
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
      position: ur.role.position,
    }));

    return {
      userId,
      resourceId: null,
      resourceType: 'INSTANCE',
      roles,
    };
  }

  // ===== WHO MAY CHANGE INSTANCE ROLES =====

  /**
   * Instance-wide authority: the instance owner, or someone holding every
   * instance admin action. Default roles carry actions outside that set
   * (Community Creator's, User Manager's UNBAN_USER), so an Instance Admin
   * couldn't otherwise hand out roles that are theirs to manage.
   */
  async hasFullInstanceAuthority(actor: {
    id: string;
    role: string;
  }): Promise<boolean> {
    if (actor.role === InstanceRole.OWNER) return true;
    const held = await this.heldInstanceActions(actor.id);
    return getInstanceAdminActions().every((a) => held.has(a));
  }

  private async heldInstanceActions(userId: string): Promise<Set<RbacActions>> {
    const { roles } = await this.getUserInstanceRoles(userId);
    return new Set(roles.flatMap((r) => r.actions));
  }

  /** Below full authority, you can only work with actions you hold yourself. */
  private async assertMayHandle(
    actor: { id: string; role: string },
    actions: RbacActions[],
  ): Promise<void> {
    if (await this.hasFullInstanceAuthority(actor)) return;
    const held = await this.heldInstanceActions(actor.id);
    const missing = actions.filter((a) => !held.has(a));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Cannot grant permissions you do not have: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Acting on someone's account (password, ban, delete) can amount to being
   * them, so below full authority it stops at anyone who holds an instance
   * action you lack: otherwise resetting an admin's password gets you what
   * assertMayHandle stops you granting yourself. Instance owners are the
   * callers' business: full authority doesn't reach them either.
   */
  async assertMayManageUser(
    actor: { id: string; role: string },
    targetUserId: string,
  ): Promise<void> {
    if (await this.hasFullInstanceAuthority(actor)) return;
    const [mine, theirs] = await Promise.all([
      this.heldInstanceActions(actor.id),
      this.heldInstanceActions(targetUserId),
    ]);
    if ([...theirs].some((action) => !mine.has(action))) {
      throw new ForbiddenException(
        'Cannot manage a user who holds permissions you do not have',
      );
    }
  }

  /** Assignment on behalf of a user. */
  async assignRoleAsActor(
    actor: { id: string; role: string },
    userId: string,
    roleId: string,
  ): Promise<void> {
    const role = await this.databaseService.role.findUnique({
      where: { id: roleId },
      select: { communityId: true, actions: true },
    });
    if (role && !role.communityId) {
      await this.assertMayHandle(actor, role.actions);
    }
    await this.assignUserToInstanceRole(userId, roleId);
  }

  /** Removal on behalf of a user: it takes the standing to have granted it. */
  async removeRoleAsActor(
    actor: { id: string; role: string },
    userId: string,
    roleId: string,
  ): Promise<void> {
    const role = await this.databaseService.role.findUnique({
      where: { id: roleId },
      select: { actions: true },
    });
    if (role) await this.assertMayHandle(actor, role.actions);
    await this.removeUserFromInstanceRole(userId, roleId);
  }

  // ===== INSTANCE ROLE MANAGEMENT =====

  /**
   * Create the default instance admin role (idempotent - returns existing if found)
   */
  async createDefaultInstanceRole(
    tx?: Prisma.TransactionClient,
    pendingBumps?: EpochBump[],
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
        position: DEFAULT_INSTANCE_ADMIN_ROLE.position,
        communityId: null,
        isDefault: true,
      },
    });

    await this.permissionsCacheService.bumpNowOrDefer(
      { kind: 'instance' },
      tx,
      pendingBumps,
    );

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
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
      position: role.position,
    }));
  }

  /**
   * Create a custom instance role
   */
  async createInstanceRole(
    name: string,
    actions: RbacActions[],
    actor?: { id: string; role: string },
  ): Promise<RoleDto> {
    // Validate that all actions are valid instance-level actions
    const validActions = getInstanceAdminActions();
    const invalidActions = actions.filter((a) => !validActions.includes(a));

    if (invalidActions.length > 0) {
      throw new BadRequestException(
        `Actions not valid for instance roles: ${invalidActions.join(', ')}`,
      );
    }

    if (actor) await this.assertMayHandle(actor, actions);

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

    await this.permissionsCacheService.bumpInstanceEpoch();

    this.logger.log(`Created custom instance role: ${name}`);

    return {
      id: role.id,
      name: role.name,
      actions: role.actions,
      createdAt: role.createdAt,
      isDefault: role.isDefault,
      position: role.position,
    };
  }

  /**
   * Update an instance role's name or permissions
   */
  async updateInstanceRole(
    roleId: string,
    dto: UpdateRoleDto,
    actor?: { id: string; role: string },
  ): Promise<RoleDto> {
    const role = await this.databaseService.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (role.communityId !== null) {
      throw new NotFoundException('Instance role not found');
    }

    // Don't allow renaming any default instance role
    if (role.isDefault && dto.name && dto.name !== role.name) {
      throw new BadRequestException('Cannot rename a default role');
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

    // Editing a role takes the standing to hold what it has and what it gets
    if (actor) {
      await this.assertMayHandle(actor, [
        ...role.actions,
        ...(dto.actions ?? []),
      ]);
    }

    // Check for name conflicts if renaming (scoped to instance roles only)
    if (dto.name && dto.name !== role.name) {
      const conflictingRole = await this.databaseService.role.findFirst({
        where: {
          name: dto.name,
          communityId: null,
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

    await this.permissionsCacheService.bumpInstanceEpoch();

    this.logger.log(`Updated instance role ${roleId}`);

    return {
      id: updated.id,
      name: updated.name,
      actions: updated.actions,
      createdAt: updated.createdAt,
      isDefault: updated.isDefault,
      position: updated.position,
    };
  }

  /**
   * Delete a custom instance role (cannot delete the default)
   */
  async deleteInstanceRole(
    roleId: string,
    actor?: { id: string; role: string },
  ): Promise<void> {
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

    if (role.communityId !== null) {
      throw new NotFoundException('Instance role not found');
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

    // Deleting a role takes the standing to hold what it has, like update
    if (actor) await this.assertMayHandle(actor, role.actions);

    await this.databaseService.role.delete({
      where: { id: roleId },
    });

    await this.permissionsCacheService.bumpInstanceEpoch();

    this.logger.log(`Deleted instance role ${roleId}`);
  }

  /**
   * Assign a user to an instance role
   */
  async assignUserToInstanceRole(
    userId: string,
    roleId: string,
    tx?: Prisma.TransactionClient,
    pendingBumps?: EpochBump[],
  ): Promise<void> {
    const database = tx || this.databaseService;

    // Check role exists
    const role = await database.role.findUnique({
      where: { id: roleId },
    });

    // A community role's actions must never apply instance-wide
    if (!role || role.communityId) {
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

    await this.permissionsCacheService.bumpNowOrDefer(
      { kind: 'user', userId },
      tx,
      pendingBumps,
    );

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

    await this.permissionsCacheService.bumpUserEpoch(userId);

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
    pendingBumps?: EpochBump[],
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
        position: DEFAULT_COMMUNITY_CREATOR_ROLE.position,
        communityId: null,
        isDefault: true,
      },
    });

    await this.permissionsCacheService.bumpNowOrDefer(
      { kind: 'instance' },
      tx,
      pendingBumps,
    );

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
      position: role.position,
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
          position: roleConfig.position,
          communityId: null,
          isDefault: true,
        },
      });

      await this.permissionsCacheService.bumpInstanceEpoch();

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
      position: role.position,
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
      position: role.position,
    };
  }
}
