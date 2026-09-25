import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChannelType } from '@prisma/client';
import { WebsocketService } from '@/websocket/websocket.service';
import { DatabaseService } from '@/database/database.service';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { LivekitService } from '@/livekit/livekit.service';
import { ServerEvents } from '@semaphore-chat/shared';
import { RoomName } from '@/common/utils/room-name.util';
import {
  RoomEvents,
  MembershipCreatedEvent,
  MembershipRemovedEvent,
  ModerationUserBannedEvent,
  ModerationUserKickedEvent,
  ChannelCreatedEvent,
  ChannelDeletedEvent,
  ChannelMembershipCreatedEvent,
  ChannelMembershipRemovedEvent,
  DmGroupCreatedEvent,
  DmGroupMemberAddedEvent,
  DmGroupMemberLeftEvent,
  AliasGroupCreatedEvent,
  AliasGroupMemberAddedEvent,
  AliasGroupMemberRemovedEvent,
  AliasGroupDeletedEvent,
  AliasGroupMembersUpdatedEvent,
  CommunityUpdatedEvent,
  CommunityDeletedEvent,
  RoleCreatedEvent,
  RoleUpdatedEvent,
  RoleDeletedEvent,
  RoleAssignedEvent,
  RoleUnassignedEvent,
  UserProfileUpdatedEvent,
} from './room-subscription.events';

/**
 * Centralized handler for all WebSocket room subscription changes.
 *
 * Services emit domain events (e.g. 'membership.created'); this handler
 * translates them into Socket.IO room joins/leaves so clients receive
 * the correct real-time events without any client-side subscription logic.
 */
@Injectable()
export class RoomSubscriptionHandler {
  private readonly logger = new Logger(RoomSubscriptionHandler.name);

  constructor(
    private readonly websocketService: WebsocketService,
    private readonly databaseService: DatabaseService,
    private readonly voicePresenceService: VoicePresenceService,
    private readonly livekitService: LivekitService,
  ) {}

  // =========================================================================
  // Community Membership
  // =========================================================================

  @OnEvent(RoomEvents.MEMBERSHIP_CREATED)
  async onMembershipCreated({
    userId,
    communityId,
  }: MembershipCreatedEvent): Promise<void> {
    const publicChannels = await this.databaseService.channel.findMany({
      where: { communityId, isPrivate: false },
      select: { id: true },
    });

    const roomsToJoin = [
      RoomName.community(communityId),
      ...publicChannels.map((ch) => RoomName.channel(ch.id)),
    ];

    this.websocketService.joinSocketsToRoom(RoomName.user(userId), roomsToJoin);

    // Notify the user's UI to refresh the community list
    this.websocketService.sendToRoom(
      RoomName.user(userId),
      ServerEvents.MEMBER_ADDED_TO_COMMUNITY,
      { communityId, userId },
    );

    this.logger.debug(
      `User ${userId} joined rooms for community ${communityId} (${roomsToJoin.length} rooms)`,
    );
  }

  @OnEvent(RoomEvents.MEMBERSHIP_REMOVED)
  async onMembershipRemoved({
    userId,
    communityId,
  }: MembershipRemovedEvent): Promise<void> {
    const [channels, aliasGroups] = await Promise.all([
      this.databaseService.channel.findMany({
        where: { communityId },
        select: { id: true },
      }),
      this.databaseService.aliasGroup.findMany({
        where: { communityId },
        select: { id: true },
      }),
    ]);

    const roomsToLeave = [
      RoomName.community(communityId),
      ...channels.map((ch) => RoomName.channel(ch.id)),
      ...aliasGroups.map((ag) => RoomName.aliasGroup(ag.id)),
    ];

    this.websocketService.removeSocketsFromRoom(
      RoomName.user(userId),
      roomsToLeave,
    );

    this.logger.debug(
      `User ${userId} left rooms for community ${communityId} (${roomsToLeave.length} rooms)`,
    );
  }

  // =========================================================================
  // Moderation (Ban / Kick)
  // =========================================================================

  @OnEvent(RoomEvents.MODERATION_USER_BANNED)
  async onUserBanned({
    userId,
    communityId,
  }: ModerationUserBannedEvent): Promise<void> {
    await this.onMembershipRemoved({ userId, communityId });
    await this.removeUserFromCommunityVoice(userId, communityId);
  }

  @OnEvent(RoomEvents.MODERATION_USER_KICKED)
  async onUserKicked({
    userId,
    communityId,
  }: ModerationUserKickedEvent): Promise<void> {
    await this.onMembershipRemoved({ userId, communityId });
    await this.removeUserFromCommunityVoice(userId, communityId);
  }

  /**
   * Remove a user from all voice channels in a community.
   * Handles both LiveKit session ejection and Redis voice presence cleanup.
   * Errors are logged but never thrown — moderation actions must not fail
   * because of voice cleanup issues.
   */
  private async removeUserFromCommunityVoice(
    userId: string,
    communityId: string,
  ): Promise<void> {
    try {
      const userVoiceChannels =
        await this.voicePresenceService.getUserVoiceChannels(userId);

      if (userVoiceChannels.length === 0) {
        return;
      }

      const communityVoiceChannels =
        await this.databaseService.channel.findMany({
          where: {
            communityId,
            type: ChannelType.VOICE,
            id: { in: userVoiceChannels },
          },
          select: { id: true },
        });

      const channelsToRemoveFrom = communityVoiceChannels.map((ch) => ch.id);

      if (channelsToRemoveFrom.length === 0) {
        return;
      }

      await Promise.allSettled(
        channelsToRemoveFrom.map((channelId) =>
          Promise.allSettled([
            this.livekitService.removeParticipant(channelId, userId),
            this.voicePresenceService.leaveVoiceChannel(channelId, userId),
          ]),
        ),
      );

      this.logger.log(
        `Removed user ${userId} from ${channelsToRemoveFrom.length} voice channel(s) in community ${communityId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to remove user ${userId} from voice channels in community ${communityId}`,
        error,
      );
    }
  }

  // =========================================================================
  // Channel Lifecycle
  // =========================================================================

  @OnEvent(RoomEvents.CHANNEL_CREATED)
  onChannelCreated({
    channelId,
    communityId,
    isPrivate,
  }: ChannelCreatedEvent): void {
    if (!isPrivate) {
      // All community members should join the new public channel room
      this.websocketService.joinSocketsToRoom(
        RoomName.community(communityId),
        RoomName.channel(channelId),
      );
      this.logger.debug(
        `All members of community ${communityId} joined public channel ${channelId}`,
      );
    }
  }

  @OnEvent(RoomEvents.CHANNEL_DELETED)
  onChannelDeleted({ channelId }: ChannelDeletedEvent): void {
    // Remove all sockets from the deleted channel's room
    this.websocketService.removeSocketsFromRoom(
      RoomName.channel(channelId),
      RoomName.channel(channelId),
    );
    this.logger.debug(`All sockets removed from deleted channel ${channelId}`);
  }

  // =========================================================================
  // Private Channel Membership
  // =========================================================================

  @OnEvent(RoomEvents.CHANNEL_MEMBERSHIP_CREATED)
  onChannelMembershipCreated({
    userId,
    channelId,
  }: ChannelMembershipCreatedEvent): void {
    this.websocketService.joinSocketsToRoom(
      RoomName.user(userId),
      RoomName.channel(channelId),
    );
    this.logger.debug(
      `User ${userId} joined private channel room ${channelId}`,
    );
  }

  @OnEvent(RoomEvents.CHANNEL_MEMBERSHIP_REMOVED)
  onChannelMembershipRemoved({
    userId,
    channelId,
  }: ChannelMembershipRemovedEvent): void {
    this.websocketService.removeSocketsFromRoom(
      RoomName.user(userId),
      RoomName.channel(channelId),
    );
    this.logger.debug(`User ${userId} left private channel room ${channelId}`);
  }

  // =========================================================================
  // Direct Message Groups
  // =========================================================================

  @OnEvent(RoomEvents.DM_GROUP_CREATED)
  onDmGroupCreated({ groupId, memberIds }: DmGroupCreatedEvent): void {
    for (const userId of memberIds) {
      this.websocketService.joinSocketsToRoom(
        RoomName.user(userId),
        RoomName.dmGroup(groupId),
      );
    }
    this.logger.debug(
      `${memberIds.length} members joined DM group room ${groupId}`,
    );
  }

  @OnEvent(RoomEvents.DM_GROUP_MEMBER_ADDED)
  onDmGroupMemberAdded({ groupId, userIds }: DmGroupMemberAddedEvent): void {
    for (const userId of userIds) {
      this.websocketService.joinSocketsToRoom(
        RoomName.user(userId),
        RoomName.dmGroup(groupId),
      );
    }
    this.logger.debug(
      `${userIds.length} members added to DM group room ${groupId}`,
    );
  }

  @OnEvent(RoomEvents.DM_GROUP_MEMBER_LEFT)
  onDmGroupMemberLeft({ groupId, userId }: DmGroupMemberLeftEvent): void {
    this.websocketService.removeSocketsFromRoom(
      RoomName.user(userId),
      RoomName.dmGroup(groupId),
    );
    this.logger.debug(`User ${userId} left DM group room ${groupId}`);
  }

  // =========================================================================
  // Alias Groups
  // =========================================================================

  @OnEvent(RoomEvents.ALIAS_GROUP_CREATED)
  onAliasGroupCreated({
    aliasGroupId,
    memberIds,
  }: AliasGroupCreatedEvent): void {
    for (const userId of memberIds) {
      this.websocketService.joinSocketsToRoom(
        RoomName.user(userId),
        RoomName.aliasGroup(aliasGroupId),
      );
    }
    this.logger.debug(
      `${memberIds.length} members joined alias group room ${aliasGroupId}`,
    );
  }

  @OnEvent(RoomEvents.ALIAS_GROUP_MEMBER_ADDED)
  onAliasGroupMemberAdded({
    aliasGroupId,
    userId,
  }: AliasGroupMemberAddedEvent): void {
    this.websocketService.joinSocketsToRoom(
      RoomName.user(userId),
      RoomName.aliasGroup(aliasGroupId),
    );
    this.logger.debug(`User ${userId} joined alias group room ${aliasGroupId}`);
  }

  @OnEvent(RoomEvents.ALIAS_GROUP_MEMBER_REMOVED)
  onAliasGroupMemberRemoved({
    aliasGroupId,
    userId,
  }: AliasGroupMemberRemovedEvent): void {
    this.websocketService.removeSocketsFromRoom(
      RoomName.user(userId),
      RoomName.aliasGroup(aliasGroupId),
    );
    this.logger.debug(`User ${userId} left alias group room ${aliasGroupId}`);
  }

  @OnEvent(RoomEvents.ALIAS_GROUP_DELETED)
  onAliasGroupDeleted({
    aliasGroupId,
    memberIds,
  }: AliasGroupDeletedEvent): void {
    for (const userId of memberIds) {
      this.websocketService.removeSocketsFromRoom(
        RoomName.user(userId),
        RoomName.aliasGroup(aliasGroupId),
      );
    }
    this.logger.debug(
      `${memberIds.length} members removed from deleted alias group room ${aliasGroupId}`,
    );
  }

  @OnEvent(RoomEvents.ALIAS_GROUP_MEMBERS_UPDATED)
  onAliasGroupMembersUpdated({
    aliasGroupId,
    addedUserIds,
    removedUserIds,
  }: AliasGroupMembersUpdatedEvent): void {
    for (const userId of addedUserIds) {
      this.websocketService.joinSocketsToRoom(
        RoomName.user(userId),
        RoomName.aliasGroup(aliasGroupId),
      );
    }
    for (const userId of removedUserIds) {
      this.websocketService.removeSocketsFromRoom(
        RoomName.user(userId),
        RoomName.aliasGroup(aliasGroupId),
      );
    }
    this.logger.debug(
      `Alias group ${aliasGroupId} updated: +${addedUserIds.length} -${removedUserIds.length} members`,
    );
  }

  // =========================================================================
  // Community Lifecycle
  // =========================================================================

  @OnEvent(RoomEvents.COMMUNITY_UPDATED)
  onCommunityUpdated(event: CommunityUpdatedEvent): void {
    this.websocketService.sendToRoom(
      RoomName.community(event.communityId),
      ServerEvents.COMMUNITY_UPDATED,
      event,
    );
    this.logger.debug(`Community ${event.communityId} updated`);
  }

  @OnEvent(RoomEvents.COMMUNITY_DELETED)
  onCommunityDeleted({ communityId }: CommunityDeletedEvent): void {
    this.websocketService.sendToRoom(
      RoomName.community(communityId),
      ServerEvents.COMMUNITY_DELETED,
      { communityId },
    );
    this.logger.debug(`Community ${communityId} deleted`);
  }

  // =========================================================================
  // Roles
  // =========================================================================

  @OnEvent(RoomEvents.ROLE_CREATED)
  onRoleCreated(event: RoleCreatedEvent): void {
    this.websocketService.sendToRoom(
      RoomName.community(event.communityId),
      ServerEvents.ROLE_CREATED,
      event,
    );
    this.logger.debug(
      `Role "${event.roleName}" created in community ${event.communityId}`,
    );
  }

  @OnEvent(RoomEvents.ROLE_UPDATED)
  onRoleUpdated(event: RoleUpdatedEvent): void {
    this.websocketService.sendToRoom(
      RoomName.community(event.communityId),
      ServerEvents.ROLE_UPDATED,
      event,
    );
    this.logger.debug(
      `Role ${event.roleId} updated in community ${event.communityId}`,
    );
  }

  @OnEvent(RoomEvents.ROLE_DELETED)
  onRoleDeleted(event: RoleDeletedEvent): void {
    this.websocketService.sendToRoom(
      RoomName.community(event.communityId),
      ServerEvents.ROLE_DELETED,
      event,
    );
    this.logger.debug(
      `Role ${event.roleId} deleted from community ${event.communityId}`,
    );
  }

  @OnEvent(RoomEvents.ROLE_ASSIGNED)
  onRoleAssigned(event: RoleAssignedEvent): void {
    this.websocketService.sendToRoom(
      RoomName.community(event.communityId),
      ServerEvents.ROLE_ASSIGNED,
      event,
    );
    this.logger.debug(
      `User ${event.userId} assigned role ${event.roleId} in community ${event.communityId}`,
    );
  }

  @OnEvent(RoomEvents.ROLE_UNASSIGNED)
  onRoleUnassigned(event: RoleUnassignedEvent): void {
    this.websocketService.sendToRoom(
      RoomName.community(event.communityId),
      ServerEvents.ROLE_UNASSIGNED,
      event,
    );
    this.logger.debug(
      `User ${event.userId} unassigned role ${event.roleId} in community ${event.communityId}`,
    );
  }

  // =========================================================================
  // User Profile
  // =========================================================================

  @OnEvent(RoomEvents.USER_PROFILE_UPDATED)
  async onUserProfileUpdated(event: UserProfileUpdatedEvent): Promise<void> {
    // Notify the user's own sessions
    this.websocketService.sendToRoom(
      RoomName.user(event.userId),
      ServerEvents.USER_PROFILE_UPDATED,
      event,
    );

    // Broadcast to all communities the user belongs to so other members
    // can invalidate cached user data (avatars, display names, etc.)
    const memberships = await this.databaseService.membership.findMany({
      where: { userId: event.userId },
      select: { communityId: true },
    });

    for (const { communityId } of memberships) {
      this.websocketService.sendToRoom(
        RoomName.community(communityId),
        ServerEvents.USER_PROFILE_UPDATED,
        event,
      );
    }

    this.logger.debug(`User ${event.userId} profile updated`);
  }
}
