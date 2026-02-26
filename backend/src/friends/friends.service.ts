import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Friendship, FriendshipStatus, User } from '@prisma/client';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';

export interface FriendshipWithUsers extends Friendship {
  userA: Partial<User>;
  userB: Partial<User>;
}

export interface PendingRequests {
  sent: FriendshipWithUsers[];
  received: FriendshipWithUsers[];
}

export interface FriendListItem {
  friendshipId: string;
  user: Partial<User>;
}

@Injectable()
export class FriendsService {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Send a friend request to another user
   * userA = sender, userB = receiver
   */
  async sendFriendRequest(
    senderId: string,
    receiverId: string,
  ): Promise<Friendship> {
    // Cannot send request to yourself
    if (senderId === receiverId) {
      throw new ForbiddenException('Cannot send friend request to yourself');
    }

    // Check if receiver exists
    const receiver = await this.databaseService.user.findUnique({
      where: { id: receiverId },
    });
    if (!receiver) {
      throw new NotFoundException('User not found');
    }

    // Check if either user has blocked the other
    const blocked = await this.databaseService.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException('Cannot send friend request to this user');
    }

    // Check for existing friendship (in either direction)
    const existing = await this.databaseService.friendship.findFirst({
      where: {
        OR: [
          { userAId: senderId, userBId: receiverId },
          { userAId: receiverId, userBId: senderId },
        ],
      },
    });

    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        throw new ConflictException('Already friends with this user');
      }
      if (existing.status === FriendshipStatus.PENDING) {
        // If they sent us a request, auto-accept it
        if (existing.userAId === receiverId) {
          return this.databaseService.friendship.update({
            where: { id: existing.id },
            data: { status: FriendshipStatus.ACCEPTED },
          });
        }
        throw new ConflictException('Friend request already sent');
      }
    }

    // Create new friend request
    return this.databaseService.friendship.create({
      data: {
        userAId: senderId,
        userBId: receiverId,
        status: FriendshipStatus.PENDING,
      },
    });
  }

  /**
   * Accept a friend request
   * Only the receiver (userB) can accept
   */
  async acceptFriendRequest(
    userId: string,
    friendshipId: string,
  ): Promise<Friendship> {
    const friendship = await this.databaseService.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    // Only the receiver can accept
    if (friendship.userBId !== userId) {
      throw new ForbiddenException('Cannot accept this friend request');
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new ConflictException('Friend request is not pending');
    }

    return this.databaseService.friendship.update({
      where: { id: friendshipId },
      data: { status: FriendshipStatus.ACCEPTED },
    });
  }

  /**
   * Decline a friend request
   * Only the receiver (userB) can decline
   */
  async declineFriendRequest(
    userId: string,
    friendshipId: string,
  ): Promise<void> {
    const friendship = await this.databaseService.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    // Only the receiver can decline
    if (friendship.userBId !== userId) {
      throw new ForbiddenException('Cannot decline this friend request');
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new ConflictException('Friend request is not pending');
    }

    await this.databaseService.friendship.delete({
      where: { id: friendshipId },
    });
  }

  /**
   * Cancel a sent friend request
   * Only the sender (userA) can cancel
   */
  async cancelFriendRequest(
    userId: string,
    friendshipId: string,
  ): Promise<void> {
    const friendship = await this.databaseService.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }

    // Only the sender can cancel
    if (friendship.userAId !== userId) {
      throw new ForbiddenException('Cannot cancel this friend request');
    }

    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new ConflictException('Friend request is not pending');
    }

    await this.databaseService.friendship.delete({
      where: { id: friendshipId },
    });
  }

  /**
   * Remove a friend (unfriend)
   * Either user can remove the friendship
   */
  async removeFriend(userId: string, friendshipId: string): Promise<void> {
    const friendship = await this.databaseService.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    // Either user can remove
    if (friendship.userAId !== userId && friendship.userBId !== userId) {
      throw new ForbiddenException('Cannot remove this friendship');
    }

    if (friendship.status !== FriendshipStatus.ACCEPTED) {
      throw new ConflictException('Not friends with this user');
    }

    await this.databaseService.friendship.delete({
      where: { id: friendshipId },
    });
  }

  /**
   * Get all accepted friends for a user
   */
  async getFriends(userId: string): Promise<FriendListItem[]> {
    const friendships = await this.databaseService.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: {
        userA: { select: PUBLIC_USER_SELECT },
        userB: { select: PUBLIC_USER_SELECT },
      },
    });

    return friendships.map((f) => ({
      friendshipId: f.id,
      user: f.userAId === userId ? f.userB : f.userA,
    }));
  }

  /**
   * Get pending friend requests (both sent and received)
   */
  async getPendingRequests(userId: string): Promise<PendingRequests> {
    const [sent, received] = await Promise.all([
      // Requests I sent (I am userA)
      this.databaseService.friendship.findMany({
        where: {
          userAId: userId,
          status: FriendshipStatus.PENDING,
        },
        include: {
          userA: { select: PUBLIC_USER_SELECT },
          userB: { select: PUBLIC_USER_SELECT },
        },
      }),
      // Requests I received (I am userB)
      this.databaseService.friendship.findMany({
        where: {
          userBId: userId,
          status: FriendshipStatus.PENDING,
        },
        include: {
          userA: { select: PUBLIC_USER_SELECT },
          userB: { select: PUBLIC_USER_SELECT },
        },
      }),
    ]);

    return { sent, received };
  }

  /**
   * Get friendship status between two users
   */
  async getFriendshipStatus(
    userA: string,
    userB: string,
  ): Promise<{
    status: FriendshipStatus | null;
    friendshipId: string | null;
    direction: 'sent' | 'received' | null;
  }> {
    const friendship = await this.databaseService.friendship.findFirst({
      where: {
        OR: [
          { userAId: userA, userBId: userB },
          { userAId: userB, userBId: userA },
        ],
      },
    });

    if (!friendship) {
      return { status: null, friendshipId: null, direction: null };
    }

    // Determine direction relative to userA
    const direction = friendship.userAId === userA ? 'sent' : 'received';

    return {
      status: friendship.status,
      friendshipId: friendship.id,
      direction:
        friendship.status === FriendshipStatus.PENDING ? direction : null,
    };
  }

  /**
   * Check if two users are friends
   */
  async areFriends(userA: string, userB: string): Promise<boolean> {
    const friendship = await this.databaseService.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { userAId: userA, userBId: userB },
          { userAId: userB, userBId: userA },
        ],
      },
    });

    return !!friendship;
  }
}
