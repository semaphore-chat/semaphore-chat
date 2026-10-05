import { Injectable } from '@nestjs/common';
import { InstanceRole, RbacActions } from '@prisma/client';
import { DatabaseService } from '@/database/database.service';
import { RoomName } from '@/common/utils/room-name.util';
import {
  ALL_CAPABILITIES,
  canViewChannel,
  ChannelCapabilities,
  ChannelPermissionInput,
  isVisibleToWholeCommunity,
  toCapabilities,
} from './channel-permissions.util';
import {
  CHANNEL_PERMISSION_SELECT,
  ChannelPermissionRow,
  PermissionsService,
} from './permissions.service';

export interface ChannelCapabilitiesResult extends ChannelCapabilities {
  channelId: string;
  /** End of the user's community timeout, if one is active. */
  timedOutUntil: Date | null;
}

/** What one user's bulk evaluation across communities needs, loaded once. */
interface UserContext {
  userId: string;
  isOwner: boolean;
  memberOf: Set<string>;
  actionsByCommunity: Map<string, RbacActions[]>;
  roleIdsByCommunity: Map<string, string[]>;
  channelMemberships: Set<string>;
  timeoutsByCommunity: Map<string, Date>;
}

/**
 * Channel VISIBILITY: the one place that answers "which channels can this
 * user see" and "who can see this channel". Every listing, search, mention
 * resolution, unread count, notification, file access check and socket room
 * join uses it, so a hidden channel's name, id and content never reach a
 * user who can't view it. Per-request permission checks go through
 * PermissionsService; both evaluate the same pure functions
 * (channel-permissions.util), so they can't disagree.
 *
 * The instance OWNER sees every channel (same bypass as RbacGuard).
 *
 * A test (channel-visibility.boundary.spec.ts) fails if `isPrivate` or
 * ChannelMembership-based visibility is checked outside the roles module.
 */
@Injectable()
export class ChannelAccessService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /** Ids of the channels the user can see in the given communities. */
  async visibleChannelIds(
    userId: string,
    communityIds: string | string[],
  ): Promise<string[]> {
    const ids = Array.isArray(communityIds) ? communityIds : [communityIds];
    if (ids.length === 0) return [];
    const [channels, ctx] = await Promise.all([
      this.loadChannels(ids),
      this.loadUserContext(userId, ids),
    ]);
    return channels
      .filter((c) => ctx.isOwner || canViewChannel(this.inputFor(ctx, c)))
      .map((c) => c.id);
  }

  /** Whether the user can see this channel (false if it doesn't exist). */
  async canViewChannel(userId: string, channelId: string): Promise<boolean> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_PERMISSION_SELECT,
    });
    if (!channel) return false;
    const ctx = await this.loadUserContext(userId, [channel.communityId]);
    return ctx.isOwner || canViewChannel(this.inputFor(ctx, channel));
  }

  /**
   * Users who can see the channel: community members passing the view gate,
   * plus instance owners among them. For notifications and room sync.
   */
  async viewerUserIds(channelId: string): Promise<string[]> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_PERMISSION_SELECT,
    });
    if (!channel) return [];

    // Fast path for a plain private channel: its ChannelMembership rows (still
    // community members) plus the instance owners, without loading everyone.
    if (channel.isPrivate && channel.overwrites.length === 0) {
      const viewers = await this.databaseService.membership.findMany({
        where: {
          communityId: channel.communityId,
          OR: [
            { user: { ChannelMembership: { some: { channelId } } } },
            { user: { role: InstanceRole.OWNER } },
          ],
        },
        select: { userId: true },
      });
      return viewers.map((m) => m.userId);
    }

    const [members, channelMembers, userRoles] = await Promise.all([
      this.databaseService.membership.findMany({
        where: { communityId: channel.communityId },
        select: { userId: true, user: { select: { role: true } } },
      }),
      channel.isPrivate
        ? this.databaseService.channelMembership.findMany({
            where: { channelId },
            select: { userId: true },
          })
        : Promise.resolve([] as { userId: string }[]),
      channel.overwrites.length > 0
        ? this.databaseService.userRoles.findMany({
            where: { communityId: channel.communityId, isInstanceRole: false },
            select: {
              userId: true,
              roleId: true,
              role: { select: { actions: true } },
            },
          })
        : [],
    ]);

    const inChannel = new Set(channelMembers.map((m) => m.userId));
    const rolesByUser = new Map<
      string,
      { ids: string[]; actions: RbacActions[] }
    >();
    for (const ur of userRoles) {
      const entry = rolesByUser.get(ur.userId) ?? { ids: [], actions: [] };
      entry.ids.push(ur.roleId);
      entry.actions.push(...ur.role.actions);
      rolesByUser.set(ur.userId, entry);
    }

    return members
      .filter((m) => {
        if (m.user.role === InstanceRole.OWNER) return true;
        const roles = rolesByUser.get(m.userId);
        return canViewChannel({
          userId: m.userId,
          // Without overwrites only the membership gate matters.
          baseActions: roles?.actions ?? [],
          roleIds: roles?.ids ?? [],
          isCommunityMember: true,
          isPrivate: channel.isPrivate,
          hasChannelMembership: inChannel.has(m.userId),
          overwrites: channel.overwrites,
          timedOut: false,
        });
      })
      .map((m) => m.userId);
  }

  /**
   * Who belongs in the channel's socket room: `everyone` when the whole
   * community sees it, otherwise its viewers and the members to remove.
   */
  async roomPlan(channelId: string): Promise<
    | { everyone: true; communityId: string }
    | {
        everyone: false;
        communityId: string;
        viewers: string[];
        nonViewers: string[];
      }
    | null
  > {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_PERMISSION_SELECT,
    });
    if (!channel) return null;
    if (isVisibleToWholeCommunity(channel)) {
      return { everyone: true, communityId: channel.communityId };
    }
    const [members, viewers] = await Promise.all([
      this.databaseService.membership.findMany({
        where: { communityId: channel.communityId },
        select: { userId: true },
      }),
      this.viewerUserIds(channelId),
    ]);
    const viewerSet = new Set(viewers);
    return {
      everyone: false,
      communityId: channel.communityId,
      viewers,
      nonViewers: members.map((m) => m.userId).filter((u) => !viewerSet.has(u)),
    };
  }

  /**
   * Socket room for events about this channel (created, updated, deleted,
   * reordered): the community room when everyone can see it, otherwise the
   * channel room, whose sockets are exactly its viewers.
   */
  audienceRoom(channel: ChannelPermissionRow): string {
    return isVisibleToWholeCommunity(channel)
      ? RoomName.community(channel.communityId)
      : RoomName.channel(channel.id);
  }

  /** audienceRoom for a channel id (the community room if it doesn't exist). */
  async audienceRoomFor(channelId: string): Promise<string> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_PERMISSION_SELECT,
    });
    if (!channel) return RoomName.channel(channelId);
    return this.audienceRoom(channel);
  }

  /**
   * The subset of `candidateIds` who can see the channel. For a channel the
   * whole community sees this is a membership lookup of just the candidates
   * (cheap at any community size); otherwise it intersects with the viewers.
   */
  async filterViewers(
    channelId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    if (candidateIds.length === 0) return [];
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_PERMISSION_SELECT,
    });
    if (!channel) return [];
    if (isVisibleToWholeCommunity(channel)) {
      const members = await this.databaseService.membership.findMany({
        where: {
          communityId: channel.communityId,
          userId: { in: candidateIds },
        },
        select: { userId: true },
      });
      const memberSet = new Set(members.map((m) => m.userId));
      return candidateIds.filter((id) => memberSet.has(id));
    }
    const viewers = new Set(await this.viewerUserIds(channelId));
    return candidateIds.filter((id) => viewers.has(id));
  }

  /** Whether every community member sees the channel (false if missing). */
  async isVisibleToWholeCommunity(channelId: string): Promise<boolean> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_PERMISSION_SELECT,
    });
    return !!channel && isVisibleToWholeCommunity(channel);
  }

  /** Channels whose events may go to the whole community room. */
  async publicChannelIds(communityId: string): Promise<Set<string>> {
    const channels = await this.loadChannels([communityId]);
    return new Set(
      channels.filter((c) => isVisibleToWholeCommunity(c)).map((c) => c.id),
    );
  }

  /** Compact capabilities for every channel the user can see in a community. */
  async communityCapabilities(
    userId: string,
    communityId: string,
  ): Promise<ChannelCapabilitiesResult[]> {
    const [channels, ctx] = await Promise.all([
      this.loadChannels([communityId]),
      this.loadUserContext(userId, [communityId]),
    ]);
    return channels
      .map((c) => this.capabilitiesFor(ctx, c))
      .filter((c) => c.view);
  }

  /** Compact capabilities for one channel (the guard has checked view). */
  async channelCapabilities(
    userId: string,
    channelId: string,
  ): Promise<ChannelCapabilitiesResult | null> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: CHANNEL_PERMISSION_SELECT,
    });
    if (!channel) return null;
    const ctx = await this.loadUserContext(userId, [channel.communityId]);
    return this.capabilitiesFor(ctx, channel);
  }

  // ---------------------------------------------------------------------

  private capabilitiesFor(
    ctx: UserContext,
    channel: ChannelPermissionRow,
  ): ChannelCapabilitiesResult {
    if (ctx.isOwner) {
      return {
        channelId: channel.id,
        ...ALL_CAPABILITIES,
        timedOutUntil: null,
      };
    }
    return {
      channelId: channel.id,
      ...toCapabilities(this.inputFor(ctx, channel)),
      timedOutUntil: ctx.timeoutsByCommunity.get(channel.communityId) ?? null,
    };
  }

  private inputFor(
    ctx: UserContext,
    channel: ChannelPermissionRow,
  ): ChannelPermissionInput {
    return {
      userId: ctx.userId,
      baseActions: ctx.actionsByCommunity.get(channel.communityId) ?? [],
      roleIds: ctx.roleIdsByCommunity.get(channel.communityId) ?? [],
      isCommunityMember: ctx.memberOf.has(channel.communityId),
      isPrivate: channel.isPrivate,
      hasChannelMembership: ctx.channelMemberships.has(channel.id),
      overwrites: channel.overwrites,
      timedOut: ctx.timeoutsByCommunity.has(channel.communityId),
    };
  }

  private loadChannels(
    communityIds: string[],
  ): Promise<ChannelPermissionRow[]> {
    return this.databaseService.channel.findMany({
      where: { communityId: { in: communityIds } },
      select: CHANNEL_PERMISSION_SELECT,
    });
  }

  private async loadUserContext(
    userId: string,
    communityIds: string[],
  ): Promise<UserContext> {
    const [user, memberships, userRoles, channelMemberships, timeouts] =
      await Promise.all([
        this.databaseService.user.findUnique({
          where: { id: userId },
          select: { role: true },
        }),
        this.databaseService.membership.findMany({
          where: { userId, communityId: { in: communityIds } },
          select: { communityId: true },
        }),
        this.databaseService.userRoles.findMany({
          where: {
            userId,
            communityId: { in: communityIds },
            isInstanceRole: false,
          },
          select: {
            communityId: true,
            roleId: true,
            role: { select: { actions: true } },
          },
        }),
        this.databaseService.channelMembership.findMany({
          where: { userId, channel: { communityId: { in: communityIds } } },
          select: { channelId: true },
        }),
        this.databaseService.communityTimeout.findMany({
          where: {
            userId,
            communityId: { in: communityIds },
            expiresAt: { gt: new Date() },
          },
          select: { communityId: true, expiresAt: true },
        }),
      ]);

    const actionsByCommunity = new Map<string, RbacActions[]>();
    const roleIdsByCommunity = new Map<string, string[]>();
    for (const ur of userRoles) {
      if (!ur.communityId) continue;
      actionsByCommunity.set(ur.communityId, [
        ...(actionsByCommunity.get(ur.communityId) ?? []),
        ...ur.role.actions,
      ]);
      roleIdsByCommunity.set(ur.communityId, [
        ...(roleIdsByCommunity.get(ur.communityId) ?? []),
        ur.roleId,
      ]);
    }

    return {
      userId,
      isOwner: user?.role === InstanceRole.OWNER,
      memberOf: new Set(memberships.map((m) => m.communityId)),
      actionsByCommunity,
      roleIdsByCommunity,
      channelMemberships: new Set(channelMemberships.map((m) => m.channelId)),
      timeoutsByCommunity: new Map(
        timeouts.map((t) => [t.communityId, t.expiresAt]),
      ),
    };
  }
}
