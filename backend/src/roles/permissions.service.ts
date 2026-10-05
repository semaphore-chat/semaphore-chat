import { RbacResourceType } from '@/auth/rbac-resource.decorator';
import { DatabaseService } from '@/database/database.service';
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InstanceRole, OverwriteTarget, RbacActions } from '@prisma/client';
import {
  ChannelPermissionInput,
  channelActionsGranted,
  OverwriteInput,
  TIMEOUT_BLOCKED_ACTIONS,
} from './channel-permissions.util';

/** What a channel permission check reads from the Channel row. */
export const CHANNEL_PERMISSION_SELECT = {
  id: true,
  communityId: true,
  isPrivate: true,
  overwrites: {
    select: {
      targetType: true,
      roleId: true,
      userId: true,
      allow: true,
      deny: true,
    },
  },
} as const;

export interface ChannelPermissionRow {
  id: string;
  communityId: string;
  isPrivate: boolean;
  overwrites: OverwriteInput[];
}
import {
  PermissionScope,
  PermissionsCacheService,
} from './permissions-cache.service';

/**
 * RBAC permission verification (hot path — runs on every guarded request).
 *
 * Kept separate from role management (CRUD, default-role setup), which
 * lives in CommunityRolesService and InstanceRolesService.
 *
 * The two `userRoles.findMany` lookups (instance-level and community-level)
 * are cached via PermissionsCacheService — see that service's doc comment
 * for the epoch-based invalidation design. Every other lookup in this file
 * (channel/message/DM/alias-group resolution, private-channel and DM
 * membership checks) stays on the direct DB path: those are either cheap
 * primary-key lookups or correctness-sensitive membership checks that the
 * cache design intentionally excludes.
 */
@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly permissionsCacheService: PermissionsCacheService,
  ) {}

  /**
   * Resolves the flattened `actions` for a user/scope, consulting the cache
   * first. On a cache hit, `dbQuery` is never called. On a miss, `dbQuery`
   * runs and — unless the cache was unavailable — the result is written
   * back under the epochs captured at miss time.
   */
  private async resolveActions(
    userId: string,
    scope: PermissionScope,
    dbQuery: () => Promise<RbacActions[]>,
  ): Promise<RbacActions[]> {
    const cacheResult = await this.permissionsCacheService.getCachedActions(
      userId,
      scope,
    );

    if (cacheResult.status === 'hit') {
      return cacheResult.actions;
    }

    const actions = await dbQuery();

    if (cacheResult.status === 'miss') {
      await this.permissionsCacheService.setCachedActions(
        userId,
        scope,
        cacheResult.epochs,
        actions,
      );
    }

    return actions;
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
      const allActions = await this.resolveActions(
        userId,
        { kind: 'instance' },
        async () => {
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
          return roles.flatMap((role) => role.actions);
        },
      );

      return action.every((a) => allActions.includes(a));
    }

    // Resolve the community ID based on resource type
    let communityId: string;
    // CHANNEL and MESSAGE resources return from their branch (channel
    // overwrites, see verifyChannelActions).

    if (resourceType === RbacResourceType.COMMUNITY) {
      communityId = resourceId!;
    } else if (resourceType === RbacResourceType.CHANNEL) {
      const channel = await this.databaseService.channel.findUnique({
        where: { id: resourceId },
        select: CHANNEL_PERMISSION_SELECT,
      });

      if (!channel) {
        this.logger.warn(`Channel not found for RBAC check: ${resourceId}`);
        return false; // Channel doesn't exist
      }

      return this.verifyChannelActions(userId, channel, action);
    } else if (resourceType === RbacResourceType.MESSAGE) {
      // Get the message to find its channel, then the channel's community
      const message = await this.databaseService.message.findUnique({
        where: { id: resourceId },
        select: {
          channelId: true,
          directMessageGroupId: true,
          channel: { select: CHANNEL_PERMISSION_SELECT },
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

      return this.verifyChannelActions(userId, message.channel, action);
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
    const allActions = await this.getCommunityActions(userId, communityId);

    // Check if the user has all the required actions
    return action.every((a) => allActions.includes(a));
  }

  /** Union of the user's community role actions (cached). */
  async getCommunityActions(
    userId: string,
    communityId: string,
  ): Promise<RbacActions[]> {
    return this.resolveActions(
      userId,
      { kind: 'community', communityId },
      async () => {
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
        return roles.flatMap((role) => role.actions);
      },
    );
  }

  /**
   * Channel-resource check: community roles, then the channel's overwrites,
   * the private-channel gate and the timeout mask (channel-permissions.util).
   */
  private async verifyChannelActions(
    userId: string,
    channel: ChannelPermissionRow,
    required: RbacActions[],
  ): Promise<boolean> {
    const needsTimeout = required.some((a) => TIMEOUT_BLOCKED_ACTIONS.has(a));
    const input = await this.buildChannelInput(userId, channel, needsTimeout);
    return channelActionsGranted(input, required);
  }

  /**
   * Gathers what computeChannelActions needs. Lookups beyond today's are
   * skipped when they can't change the answer: community membership and the
   * user's overwritten role ids only matter when the channel has overwrites
   * (without them a non-member has no roles, so no actions, as before), and
   * the timeout only when `withTimeout`.
   */
  async buildChannelInput(
    userId: string,
    channel: ChannelPermissionRow,
    withTimeout: boolean,
  ): Promise<ChannelPermissionInput> {
    const { communityId, overwrites } = channel;
    const roleOverwriteIds = overwrites
      .filter((o) => o.targetType === OverwriteTarget.ROLE && o.roleId)
      .map((o) => o.roleId as string);

    const [
      baseActions,
      channelMembership,
      membership,
      overwrittenRoles,
      timeout,
    ] = await Promise.all([
      this.getCommunityActions(userId, communityId),
      channel.isPrivate
        ? this.databaseService.channelMembership.findUnique({
            where: { userId_channelId: { userId, channelId: channel.id } },
            select: { id: true },
          })
        : null,
      overwrites.length > 0
        ? this.databaseService.membership.findUnique({
            where: { userId_communityId: { userId, communityId } },
            select: { id: true },
          })
        : null,
      roleOverwriteIds.length > 0
        ? this.databaseService.userRoles.findMany({
            where: {
              userId,
              communityId,
              isInstanceRole: false,
              roleId: { in: roleOverwriteIds },
            },
            select: { roleId: true },
          })
        : Promise.resolve([] as { roleId: string }[]),
      withTimeout ? this.getActiveTimeout(userId, communityId) : null,
    ]);

    return {
      userId,
      baseActions,
      roleIds: overwrittenRoles.map((r) => r.roleId),
      isCommunityMember: overwrites.length > 0 ? !!membership : true,
      isPrivate: channel.isPrivate,
      hasChannelMembership: !!channelMembership,
      overwrites,
      timedOut: !!timeout,
    };
  }

  /** The user's unexpired community timeout, if any. */
  async getActiveTimeout(
    userId: string,
    communityId: string,
  ): Promise<{ expiresAt: Date } | null> {
    const timeout = await this.databaseService.communityTimeout.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { expiresAt: true },
    });
    return timeout && timeout.expiresAt > new Date() ? timeout : null;
  }

  /**
   * Throws 403 unless the user may attach files in the channel
   * (ATTACH_FILES: overwrites, private channels, timeouts all apply).
   */
  async assertCanAttachFiles(userId: string, channelId: string): Promise<void> {
    const allowed = await this.userHasChannelActions(userId, channelId, [
      RbacActions.ATTACH_FILES,
    ]);
    if (!allowed) {
      throw new ForbiddenException(
        "You don't have permission to attach files in this channel",
      );
    }
  }

  /**
   * Channel check for code paths without a guard (e.g. attachments added to
   * an existing message). Applies the instance OWNER bypass like RbacGuard.
   */
  async userHasChannelActions(
    userId: string,
    channelId: string,
    required: RbacActions[],
  ): Promise<boolean> {
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return false;
    if (user.role === InstanceRole.OWNER) return true;
    return this.verifyActionsForUserAndResource(
      userId,
      channelId,
      RbacResourceType.CHANNEL,
      required,
    );
  }
}
