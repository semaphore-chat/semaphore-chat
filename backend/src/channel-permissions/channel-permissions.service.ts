import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InstanceRole, OverwriteTarget, RbacActions } from '@prisma/client';
import { ServerEvents } from '@semaphore-chat/shared';
import { DatabaseService } from '@/database/database.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { RoomName } from '@/common/utils/room-name.util';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { PermissionsService } from '@/roles/permissions.service';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { OVERWRITABLE_ACTIONS } from '@/roles/channel-permissions.util';
import { UserEntity } from '@/user/dto/user-response.dto';
import {
  ChannelOverwritesDto,
  ManagedChannelDto,
  ReplaceChannelOverwritesDto,
} from './dto/channel-overwrite.dto';
import {
  ChannelCapabilitiesDto,
  CommunityChannelCapabilitiesDto,
} from './dto/channel-capabilities.dto';

const OVERWRITE_SELECT = {
  targetType: true,
  roleId: true,
  allow: true,
  deny: true,
} as const;

/** Targets the API manages; MEMBER rows (data model only) are left alone. */
const API_TARGETS = [OverwriteTarget.EVERYONE, OverwriteTarget.ROLE];

@Injectable()
export class ChannelPermissionsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly channelAccessService: ChannelAccessService,
    private readonly websocketService: WebsocketService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getOverwrites(channelId: string): Promise<ChannelOverwritesDto> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        preset: true,
        overwrites: {
          where: { targetType: { in: API_TARGETS } },
          select: OVERWRITE_SELECT,
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    return {
      channelId: channel.id,
      preset: channel.preset,
      overwrites: channel.overwrites,
    };
  }

  /**
   * Management listing: every channel in the community with its overwrites,
   * including channels the caller can't view (lockout safeguard).
   */
  async listForManagement(communityId: string): Promise<ManagedChannelDto[]> {
    const channels = await this.databaseService.channel.findMany({
      where: { communityId },
      select: {
        id: true,
        name: true,
        type: true,
        // channel-visibility: shown to managers, not used for visibility
        isPrivate: true,
        position: true,
        preset: true,
        overwrites: {
          where: { targetType: { in: API_TARGETS } },
          select: OVERWRITE_SELECT,
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ type: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
    return channels.map((c) => ({
      channelId: c.id,
      name: c.name,
      type: c.type,
      // channel-visibility: shown to managers, not used for visibility
      isPrivate: c.isPrivate,
      position: c.position,
      preset: c.preset,
      overwrites: c.overwrites,
    }));
  }

  /** Replaces the channel's EVERYONE/ROLE overwrites atomically. */
  async replaceOverwrites(
    channelId: string,
    dto: ReplaceChannelOverwritesDto,
    actor: UserEntity,
  ): Promise<ChannelOverwritesDto> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: { id: true, communityId: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const rows = dto.overwrites
      .map((o) => ({
        targetType: o.targetType,
        roleId: o.roleId ?? null,
        allow: o.allow,
        deny: o.deny,
      }))
      // An overwrite that changes nothing is not stored.
      .filter((o) => o.allow.length > 0 || o.deny.length > 0);

    await this.validate(channel.communityId, rows, actor);

    await this.databaseService.$transaction(async (tx) => {
      await tx.channelPermissionOverwrite.deleteMany({
        where: { channelId, targetType: { in: API_TARGETS } },
      });
      if (rows.length > 0) {
        await tx.channelPermissionOverwrite.createMany({
          data: rows.map((r) => ({ ...r, channelId })),
        });
      }
      await tx.channel.update({
        where: { id: channelId },
        data: { preset: dto.preset },
      });
    });

    // Visibility may have changed (phase 3, when READ_CHANNEL is accepted):
    // resync the channel's socket room before telling clients.
    this.eventEmitter.emit(RoomEvents.CHANNEL_VISIBILITY_CHANGED, {
      channelId,
      communityId: channel.communityId,
    });
    this.websocketService.sendToRoom(
      RoomName.community(channel.communityId),
      ServerEvents.CHANNEL_PERMISSIONS_UPDATED,
      { communityId: channel.communityId, channelId },
    );

    return this.getOverwrites(channelId);
  }

  async myCommunityCapabilities(
    userId: string,
    communityId: string,
  ): Promise<CommunityChannelCapabilitiesDto> {
    return {
      communityId,
      channels: await this.channelAccessService.communityCapabilities(
        userId,
        communityId,
      ),
    };
  }

  async myChannelCapabilities(
    userId: string,
    channelId: string,
  ): Promise<ChannelCapabilitiesDto> {
    const caps = await this.channelAccessService.channelCapabilities(
      userId,
      channelId,
    );
    if (!caps) throw new NotFoundException('Channel not found');
    return caps;
  }

  private async validate(
    communityId: string,
    rows: {
      targetType: OverwriteTarget;
      roleId: string | null;
      allow: RbacActions[];
      deny: RbacActions[];
    }[],
    actor: UserEntity,
  ): Promise<void> {
    let everyoneCount = 0;
    const roleIds = new Set<string>();

    for (const row of rows) {
      if (row.targetType === OverwriteTarget.MEMBER) {
        throw new BadRequestException(
          'Member overwrites are not supported yet',
        );
      }
      if (row.targetType === OverwriteTarget.EVERYONE) {
        if (row.roleId) {
          throw new BadRequestException('An EVERYONE overwrite has no roleId');
        }
        if (++everyoneCount > 1) {
          throw new BadRequestException('Only one EVERYONE overwrite allowed');
        }
      } else {
        if (!row.roleId) {
          throw new BadRequestException('A ROLE overwrite needs a roleId');
        }
        if (roleIds.has(row.roleId)) {
          throw new BadRequestException(
            `Duplicate overwrite for role ${row.roleId}`,
          );
        }
        roleIds.add(row.roleId);
      }
      for (const action of [...row.allow, ...row.deny]) {
        if (!OVERWRITABLE_ACTIONS.has(action)) {
          throw new BadRequestException(
            `${action} can't be overwritten per channel`,
          );
        }
      }
      const denied = new Set(row.deny);
      const both = row.allow.filter((a) => denied.has(a));
      if (both.length > 0) {
        throw new BadRequestException(
          `Actions both allowed and denied: ${both.join(', ')}`,
        );
      }
    }

    if (roleIds.size > 0) {
      const count = await this.databaseService.role.count({
        where: { id: { in: [...roleIds] }, communityId },
      });
      if (count !== roleIds.size) {
        throw new BadRequestException(
          'Every role must belong to the channel’s community',
        );
      }
    }

    // Anti-escalation: an actor can only allow or deny what they hold
    // themselves in the community. The instance OWNER holds everything.
    if (actor.role !== InstanceRole.OWNER) {
      const held = new Set(
        await this.permissionsService.getCommunityActions(
          actor.id,
          communityId,
        ),
      );
      const missing = [
        ...new Set(rows.flatMap((r) => [...r.allow, ...r.deny])),
      ].filter((a) => !held.has(a));
      if (missing.length > 0) {
        throw new ForbiddenException(
          `You can't change permissions you don't have: ${missing.join(', ')}`,
        );
      }
    }
  }
}
