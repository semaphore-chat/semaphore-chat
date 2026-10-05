import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { RoomName } from '@/common/utils/room-name.util';
import { ChannelAccessService } from '@/roles/channel-access.service';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly channelAccessService: ChannelAccessService,
  ) {}

  /**
   * Join ALL rooms for a user across every community they belong to.
   * Called on socket connect/reconnect via SUBSCRIBE_ALL, and again
   * when mid-session changes occur (e.g., added to a new community).
   *
   * Socket.IO join() is idempotent — joining a room you're already in is a no-op.
   */
  async joinAllUserRooms(client: AuthenticatedSocket) {
    const userId = client.handshake.user.id;
    await client.join(RoomName.user(userId));

    // Get all community IDs the user is a member of
    const memberships = await this.databaseService.membership.findMany({
      where: { userId },
      select: { communityId: true },
    });
    const communityIds = memberships.map((m) => m.communityId);

    // Join community rooms (for community-wide events like CHANNELS_REORDERED)
    for (const communityId of communityIds) {
      await client.join(RoomName.community(communityId));
    }

    // Join every channel the user can see (ChannelAccessService is the one
    // visibility rule: public channels, private ones they're a member of)
    const visibleChannelIds = await this.channelAccessService.visibleChannelIds(
      userId,
      communityIds,
    );
    for (const channelId of visibleChannelIds) {
      await client.join(RoomName.channel(channelId));
    }

    // Join all DM groups
    const directMessages =
      await this.databaseService.directMessageGroupMember.findMany({
        where: { userId },
        select: { groupId: true },
      });
    for (const dm of directMessages) {
      await client.join(RoomName.dmGroup(dm.groupId));
    }

    // Join all alias groups of communities the user is a member of
    const aliasGroups = await this.databaseService.aliasGroupMember.findMany({
      where: { userId, aliasGroup: { communityId: { in: communityIds } } },
      select: { aliasGroupId: true },
    });
    for (const ag of aliasGroups) {
      await client.join(RoomName.aliasGroup(ag.aliasGroupId));
    }

    this.logger.debug(
      `User ${userId} subscribed to all rooms (${client.rooms.size} rooms)`,
    );
  }
}
