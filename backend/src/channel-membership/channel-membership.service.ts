import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateChannelMembershipDto } from './dto/create-channel-membership.dto';
import { ChannelMembershipResponseDto } from './dto/channel-membership-response.dto';
import { DatabaseService } from '@/database/database.service';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import { RoomEvents } from '@/rooms/room-subscription.events';

@Injectable()
export class ChannelMembershipService {
  private readonly logger = new Logger(ChannelMembershipService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    createChannelMembershipDto: CreateChannelMembershipDto,
    addedById?: string,
  ): Promise<ChannelMembershipResponseDto> {
    const { userId, channelId } = createChannelMembershipDto;

    // Check if channel exists and get its details
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      include: { community: true },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // Only allow adding members to private channels
    if (!channel.isPrivate) {
      throw new ForbiddenException(
        'Cannot manage membership for public channels - users automatically join public channels when they join the community',
      );
    }

    // Check if user exists (existence check only — avoid fetching sensitive fields)
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is a member of the community
    const communityMembership =
      await this.databaseService.membership.findUnique({
        where: {
          userId_communityId: {
            userId,
            communityId: channel.communityId,
          },
        },
      });

    if (!communityMembership) {
      throw new ForbiddenException(
        'User must be a member of the community before being added to a private channel',
      );
    }

    // Check if membership already exists
    const existingMembership =
      await this.databaseService.channelMembership.findUnique({
        where: {
          userId_channelId: {
            userId,
            channelId,
          },
        },
      });

    if (existingMembership) {
      throw new ConflictException('User is already a member of this channel');
    }

    const channelMembership =
      await this.databaseService.channelMembership.create({
        data: {
          userId,
          channelId,
          addedBy: addedById,
        },
      });

    // Emit domain event — the RoomSubscriptionHandler will join sockets
    this.eventEmitter.emit(RoomEvents.CHANNEL_MEMBERSHIP_CREATED, {
      userId,
      channelId,
    });

    this.logger.log(
      `Added user ${userId} to private channel ${channelId}${addedById ? ` by ${addedById}` : ''}`,
    );

    return new ChannelMembershipResponseDto(channelMembership);
  }

  async findAllForChannel(
    channelId: string,
  ): Promise<ChannelMembershipResponseDto[]> {
    // Check if channel exists and is private
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (!channel.isPrivate) {
      throw new ForbiddenException(
        'This endpoint is only for private channels. Public channel members are managed automatically through community membership.',
      );
    }

    const memberships = await this.databaseService.channelMembership.findMany({
      where: { channelId },
      include: {
        user: { select: PUBLIC_USER_SELECT },
      },
    });

    return memberships.map(
      (membership) => new ChannelMembershipResponseDto(membership),
    );
  }

  async findAllForUser(
    userId: string,
  ): Promise<ChannelMembershipResponseDto[]> {
    const memberships = await this.databaseService.channelMembership.findMany({
      where: {
        userId,
        channel: {
          isPrivate: true,
        },
      },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            communityId: true,
            isPrivate: true,
          },
        },
      },
    });

    return memberships.map(
      (membership) => new ChannelMembershipResponseDto(membership),
    );
  }

  async findOne(
    userId: string,
    channelId: string,
  ): Promise<ChannelMembershipResponseDto> {
    const membership = await this.databaseService.channelMembership.findUnique({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
      include: {
        channel: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Channel membership not found');
    }

    // Only return memberships for private channels
    if (!membership.channel.isPrivate) {
      throw new ForbiddenException(
        'This endpoint is only for private channels',
      );
    }

    return new ChannelMembershipResponseDto(membership);
  }

  async remove(userId: string, channelId: string): Promise<void> {
    // Check if channel exists and is private
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (!channel.isPrivate) {
      throw new ForbiddenException(
        'Cannot remove users from public channels - users automatically leave public channels when they leave the community',
      );
    }

    // Check if membership exists
    const membership = await this.databaseService.channelMembership.findUnique({
      where: {
        userId_channelId: {
          userId,
          channelId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Channel membership not found');
    }

    // Remove the membership, and the thread subscriptions in the channel
    // (no reply notifications once access is gone)
    await this.databaseService.$transaction(async (tx) => {
      await tx.channelMembership.delete({
        where: {
          userId_channelId: {
            userId,
            channelId,
          },
        },
      });
      await tx.threadSubscriber.deleteMany({
        where: { userId, parentMessage: { channelId } },
      });
    });

    // Emit domain event — the RoomSubscriptionHandler will remove sockets
    this.eventEmitter.emit(RoomEvents.CHANNEL_MEMBERSHIP_REMOVED, {
      userId,
      channelId,
    });

    this.logger.log(`Removed user ${userId} from private channel ${channelId}`);
  }
}
