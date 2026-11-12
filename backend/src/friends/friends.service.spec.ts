import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FriendsService } from './friends.service';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { DatabaseService } from '@/database/database.service';
import { createMockDatabase, UserFactory } from '@/test-utils';
import { FriendshipStatus } from '@prisma/client';

describe('FriendsService', () => {
  let service: FriendsService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let eventEmitter: Mocked<EventEmitter2>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(FriendsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    eventEmitter = unitRef.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendFriendRequest', () => {
    const senderId = 'sender-123';
    const receiverId = 'receiver-456';

    it('should create a new friend request', async () => {
      const receiver = UserFactory.build({ id: receiverId });
      const friendship = {
        id: 'fr-1',
        userAId: senderId,
        userBId: receiverId,
        status: FriendshipStatus.PENDING,
      };

      mockDatabase.user.findUnique.mockResolvedValue(receiver);
      mockDatabase.userBlock.findFirst.mockResolvedValue(null);
      mockDatabase.friendship.findFirst.mockResolvedValue(null);
      mockDatabase.friendship.create.mockResolvedValue(friendship);

      const result = await service.sendFriendRequest(senderId, receiverId);

      expect(result).toEqual(friendship);
      expect(mockDatabase.friendship.create).toHaveBeenCalledWith({
        data: {
          userAId: senderId,
          userBId: receiverId,
          status: FriendshipStatus.PENDING,
        },
      });
    });

    it('should look up the receiver with an id-only select (no sensitive fields fetched)', async () => {
      const receiver = UserFactory.build({ id: receiverId });
      mockDatabase.user.findUnique.mockResolvedValue(receiver);
      mockDatabase.userBlock.findFirst.mockResolvedValue(null);
      mockDatabase.friendship.findFirst.mockResolvedValue(null);
      mockDatabase.friendship.create.mockResolvedValue({
        id: 'fr-1',
        userAId: senderId,
        userBId: receiverId,
        status: FriendshipStatus.PENDING,
      });

      await service.sendFriendRequest(senderId, receiverId);

      expect(mockDatabase.user.findUnique).toHaveBeenCalledWith({
        where: { id: receiverId },
        select: { id: true },
      });
    });

    it('should throw ForbiddenException for self-request', async () => {
      await expect(
        service.sendFriendRequest(senderId, senderId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when receiver does not exist', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);

      await expect(
        service.sendFriendRequest(senderId, receiverId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when blocked', async () => {
      const receiver = UserFactory.build({ id: receiverId });
      mockDatabase.user.findUnique.mockResolvedValue(receiver);
      mockDatabase.userBlock.findFirst.mockResolvedValue({
        id: 'block-1',
        blockerId: senderId,
        blockedId: receiverId,
      });

      await expect(
        service.sendFriendRequest(senderId, receiverId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should auto-accept when reverse pending request exists', async () => {
      const receiver = UserFactory.build({ id: receiverId });
      const existingReverse = {
        id: 'fr-existing',
        userAId: receiverId, // receiver sent request to sender
        userBId: senderId,
        status: FriendshipStatus.PENDING,
      };
      const accepted = {
        ...existingReverse,
        status: FriendshipStatus.ACCEPTED,
      };

      mockDatabase.user.findUnique.mockResolvedValue(receiver);
      mockDatabase.userBlock.findFirst.mockResolvedValue(null);
      mockDatabase.friendship.findFirst.mockResolvedValue(existingReverse);
      mockDatabase.friendship.update.mockResolvedValue(accepted);

      const result = await service.sendFriendRequest(senderId, receiverId);

      expect(result.status).toBe(FriendshipStatus.ACCEPTED);
      expect(mockDatabase.friendship.update).toHaveBeenCalledWith({
        where: { id: existingReverse.id },
        data: { status: FriendshipStatus.ACCEPTED },
      });
    });

    it('should throw ConflictException when already friends', async () => {
      const receiver = UserFactory.build({ id: receiverId });
      mockDatabase.user.findUnique.mockResolvedValue(receiver);
      mockDatabase.userBlock.findFirst.mockResolvedValue(null);
      mockDatabase.friendship.findFirst.mockResolvedValue({
        id: 'fr-1',
        userAId: senderId,
        userBId: receiverId,
        status: FriendshipStatus.ACCEPTED,
      });

      await expect(
        service.sendFriendRequest(senderId, receiverId),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when pending request already sent', async () => {
      const receiver = UserFactory.build({ id: receiverId });
      mockDatabase.user.findUnique.mockResolvedValue(receiver);
      mockDatabase.userBlock.findFirst.mockResolvedValue(null);
      mockDatabase.friendship.findFirst.mockResolvedValue({
        id: 'fr-1',
        userAId: senderId, // sender is userA, so it's a duplicate sent request
        userBId: receiverId,
        status: FriendshipStatus.PENDING,
      });

      await expect(
        service.sendFriendRequest(senderId, receiverId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('acceptFriendRequest', () => {
    const userId = 'user-123';
    const friendshipId = 'fr-1';

    it('should accept a pending request', async () => {
      const friendship = {
        id: friendshipId,
        userAId: 'other-user',
        userBId: userId,
        status: FriendshipStatus.PENDING,
      };
      const accepted = { ...friendship, status: FriendshipStatus.ACCEPTED };

      mockDatabase.friendship.findUnique.mockResolvedValue(friendship);
      mockDatabase.friendship.update.mockResolvedValue(accepted);

      const result = await service.acceptFriendRequest(userId, friendshipId);

      expect(result.status).toBe(FriendshipStatus.ACCEPTED);
    });

    it('should throw NotFoundException when friendship not found', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptFriendRequest(userId, friendshipId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not the receiver', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: 'other-user',
        userBId: 'different-user',
        status: FriendshipStatus.PENDING,
      });

      await expect(
        service.acceptFriendRequest(userId, friendshipId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when not pending', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: 'other-user',
        userBId: userId,
        status: FriendshipStatus.ACCEPTED,
      });

      await expect(
        service.acceptFriendRequest(userId, friendshipId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('declineFriendRequest', () => {
    const userId = 'user-123';
    const friendshipId = 'fr-1';

    it('should decline and delete the request', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: 'other-user',
        userBId: userId,
        status: FriendshipStatus.PENDING,
      });
      mockDatabase.friendship.delete.mockResolvedValue({});

      await service.declineFriendRequest(userId, friendshipId);

      expect(mockDatabase.friendship.delete).toHaveBeenCalledWith({
        where: { id: friendshipId },
      });
    });

    it('should throw ForbiddenException when user is not the receiver', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: 'other-user',
        userBId: 'different-user',
        status: FriendshipStatus.PENDING,
      });

      await expect(
        service.declineFriendRequest(userId, friendshipId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelFriendRequest', () => {
    const userId = 'user-123';
    const friendshipId = 'fr-1';

    it('should cancel and delete the request', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: userId,
        userBId: 'other-user',
        status: FriendshipStatus.PENDING,
      });
      mockDatabase.friendship.delete.mockResolvedValue({});

      await service.cancelFriendRequest(userId, friendshipId);

      expect(mockDatabase.friendship.delete).toHaveBeenCalledWith({
        where: { id: friendshipId },
      });
    });

    it('should throw ForbiddenException when user is not the sender', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: 'other-user',
        userBId: userId,
        status: FriendshipStatus.PENDING,
      });

      await expect(
        service.cancelFriendRequest(userId, friendshipId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when not pending', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: userId,
        userBId: 'other-user',
        status: FriendshipStatus.ACCEPTED,
      });

      await expect(
        service.cancelFriendRequest(userId, friendshipId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeFriend', () => {
    const userId = 'user-123';
    const friendshipId = 'fr-1';

    it('should remove an accepted friendship (as userA)', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: userId,
        userBId: 'other-user',
        status: FriendshipStatus.ACCEPTED,
      });
      mockDatabase.friendship.delete.mockResolvedValue({});

      await service.removeFriend(userId, friendshipId);

      expect(mockDatabase.friendship.delete).toHaveBeenCalledWith({
        where: { id: friendshipId },
      });
    });

    it('should remove an accepted friendship (as userB)', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: 'other-user',
        userBId: userId,
        status: FriendshipStatus.ACCEPTED,
      });
      mockDatabase.friendship.delete.mockResolvedValue({});

      await service.removeFriend(userId, friendshipId);

      expect(mockDatabase.friendship.delete).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is neither party', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: 'other-user-a',
        userBId: 'other-user-b',
        status: FriendshipStatus.ACCEPTED,
      });

      await expect(service.removeFriend(userId, friendshipId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ConflictException when not accepted', async () => {
      mockDatabase.friendship.findUnique.mockResolvedValue({
        id: friendshipId,
        userAId: userId,
        userBId: 'other-user',
        status: FriendshipStatus.PENDING,
      });

      await expect(service.removeFriend(userId, friendshipId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getFriends', () => {
    it('should return friendship IDs and the other user', async () => {
      const userId = 'user-123';
      const friendA = UserFactory.build({ id: 'friend-a' });
      const friendB = UserFactory.build({ id: 'friend-b' });

      mockDatabase.friendship.findMany.mockResolvedValue([
        {
          id: 'fs-1',
          userAId: userId,
          userBId: 'friend-a',
          userA: {},
          userB: friendA,
        },
        {
          id: 'fs-2',
          userAId: 'friend-b',
          userBId: userId,
          userA: friendB,
          userB: {},
        },
      ]);

      const result = await service.getFriends(userId);

      expect(result).toEqual([
        { friendshipId: 'fs-1', user: friendA },
        { friendshipId: 'fs-2', user: friendB },
      ]);
    });
  });

  describe('getPendingRequests', () => {
    it('should separate sent and received requests', async () => {
      const userId = 'user-123';
      const sent = [
        { userAId: userId, userBId: 'other', status: FriendshipStatus.PENDING },
      ];
      const received = [
        { userAId: 'other', userBId: userId, status: FriendshipStatus.PENDING },
      ];

      mockDatabase.friendship.findMany
        .mockResolvedValueOnce(sent)
        .mockResolvedValueOnce(received);

      const result = await service.getPendingRequests(userId);

      expect(result.sent).toEqual(sent);
      expect(result.received).toEqual(received);
    });
  });

  describe('getFriendshipStatus', () => {
    it('should return null status when no friendship exists', async () => {
      mockDatabase.friendship.findFirst.mockResolvedValue(null);

      const result = await service.getFriendshipStatus('userA', 'userB');

      expect(result).toEqual({
        status: null,
        friendshipId: null,
        direction: null,
      });
    });

    it('should return sent direction for pending request from userA', async () => {
      mockDatabase.friendship.findFirst.mockResolvedValue({
        id: 'fr-1',
        userAId: 'userA',
        userBId: 'userB',
        status: FriendshipStatus.PENDING,
      });

      const result = await service.getFriendshipStatus('userA', 'userB');

      expect(result.direction).toBe('sent');
    });

    it('should return received direction for pending request to userA', async () => {
      mockDatabase.friendship.findFirst.mockResolvedValue({
        id: 'fr-1',
        userAId: 'userB',
        userBId: 'userA',
        status: FriendshipStatus.PENDING,
      });

      const result = await service.getFriendshipStatus('userA', 'userB');

      expect(result.direction).toBe('received');
    });

    it('should return null direction for accepted friendship', async () => {
      mockDatabase.friendship.findFirst.mockResolvedValue({
        id: 'fr-1',
        userAId: 'userA',
        userBId: 'userB',
        status: FriendshipStatus.ACCEPTED,
      });

      const result = await service.getFriendshipStatus('userA', 'userB');

      expect(result.direction).toBeNull();
    });
  });

  describe('areFriends', () => {
    it('should return true when accepted friendship exists', async () => {
      mockDatabase.friendship.findFirst.mockResolvedValue({
        id: 'fr-1',
        status: FriendshipStatus.ACCEPTED,
      });

      const result = await service.areFriends('userA', 'userB');

      expect(result).toBe(true);
    });

    it('should return false when no accepted friendship', async () => {
      mockDatabase.friendship.findFirst.mockResolvedValue(null);

      const result = await service.areFriends('userA', 'userB');

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // Socket announcements
  // =========================================================================

  describe('socket announcements', () => {
    const senderId = 'sender-123';
    const receiverId = 'receiver-456';
    const friendship = {
      id: 'fr-1',
      userAId: senderId,
      userBId: receiverId,
      status: FriendshipStatus.PENDING,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    };

    /** The one announcement made, with its payload. */
    function announcement() {
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      return eventEmitter.emit.mock.calls[0] as [RoomEvents, unknown];
    }

    describe('sendFriendRequest', () => {
      it('announces a new request, naming the sender as the actor', async () => {
        mockDatabase.user.findUnique.mockResolvedValue({ id: receiverId });
        mockDatabase.userBlock.findFirst.mockResolvedValue(null);
        mockDatabase.friendship.findFirst.mockResolvedValue(null);
        mockDatabase.friendship.create.mockResolvedValue(friendship);

        await service.sendFriendRequest(senderId, receiverId);

        expect(announcement()).toEqual([
          RoomEvents.FRIEND_REQUEST_SENT,
          {
            friendshipId: 'fr-1',
            userAId: senderId,
            userBId: receiverId,
            actorId: senderId,
          },
        ]);
      });

      it('announces nothing when the request is refused', async () => {
        mockDatabase.user.findUnique.mockResolvedValue({ id: receiverId });
        mockDatabase.userBlock.findFirst.mockResolvedValue({
          id: 'block-1',
          blockerId: receiverId,
          blockedId: senderId,
        });

        await expect(
          service.sendFriendRequest(senderId, receiverId),
        ).rejects.toThrow(ForbiddenException);

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });

      it('announces a mutual request as an acceptance', async () => {
        const reverse = {
          ...friendship,
          userAId: receiverId,
          userBId: senderId,
        };
        const accepted = { ...reverse, status: FriendshipStatus.ACCEPTED };

        mockDatabase.user.findUnique.mockResolvedValue({ id: receiverId });
        mockDatabase.userBlock.findFirst.mockResolvedValue(null);
        mockDatabase.friendship.findFirst.mockResolvedValue(reverse);
        mockDatabase.friendship.update.mockResolvedValue(accepted);

        await service.sendFriendRequest(senderId, receiverId);

        expect(announcement()).toEqual([
          RoomEvents.FRIEND_REQUEST_ACCEPTED,
          {
            friendshipId: 'fr-1',
            userAId: receiverId,
            userBId: senderId,
            actorId: senderId,
          },
        ]);
      });
    });

    describe('acceptFriendRequest', () => {
      it('announces the acceptance, naming the accepter as the actor', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue(friendship);
        mockDatabase.friendship.update.mockResolvedValue({
          ...friendship,
          status: FriendshipStatus.ACCEPTED,
        });

        await service.acceptFriendRequest(receiverId, 'fr-1');

        expect(announcement()).toEqual([
          RoomEvents.FRIEND_REQUEST_ACCEPTED,
          {
            friendshipId: 'fr-1',
            userAId: senderId,
            userBId: receiverId,
            actorId: receiverId,
          },
        ]);
      });

      it('announces nothing when the user may not accept it', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue(friendship);

        await expect(
          service.acceptFriendRequest(senderId, 'fr-1'),
        ).rejects.toThrow(ForbiddenException);

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    describe('declineFriendRequest', () => {
      it('announces the decline to the sender', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue(friendship);

        await service.declineFriendRequest(receiverId, 'fr-1');

        expect(announcement()).toEqual([
          RoomEvents.FRIEND_REQUEST_DECLINED,
          {
            friendshipId: 'fr-1',
            userAId: senderId,
            userBId: receiverId,
            actorId: receiverId,
          },
        ]);
      });

      it('announces nothing when the user may not decline it', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue(friendship);

        await expect(
          service.declineFriendRequest(senderId, 'fr-1'),
        ).rejects.toThrow(ForbiddenException);

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    describe('cancelFriendRequest', () => {
      it('announces the cancellation to the receiver', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue(friendship);

        await service.cancelFriendRequest(senderId, 'fr-1');

        expect(announcement()).toEqual([
          RoomEvents.FRIEND_REQUEST_CANCELLED,
          {
            friendshipId: 'fr-1',
            userAId: senderId,
            userBId: receiverId,
            actorId: senderId,
          },
        ]);
      });

      it('announces nothing when the request is no longer pending', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue({
          ...friendship,
          status: FriendshipStatus.ACCEPTED,
        });

        await expect(
          service.cancelFriendRequest(senderId, 'fr-1'),
        ).rejects.toThrow(ConflictException);

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });

    describe('removeFriend', () => {
      it('announces the removal, naming whoever removed as the actor', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue({
          ...friendship,
          status: FriendshipStatus.ACCEPTED,
        });

        await service.removeFriend(receiverId, 'fr-1');

        expect(announcement()).toEqual([
          RoomEvents.FRIEND_REMOVED,
          {
            friendshipId: 'fr-1',
            userAId: senderId,
            userBId: receiverId,
            actorId: receiverId,
          },
        ]);
      });

      it('announces nothing when the user is not in the friendship', async () => {
        mockDatabase.friendship.findUnique.mockResolvedValue({
          ...friendship,
          status: FriendshipStatus.ACCEPTED,
        });

        await expect(service.removeFriend('stranger', 'fr-1')).rejects.toThrow(
          ForbiddenException,
        );

        expect(eventEmitter.emit).not.toHaveBeenCalled();
      });
    });
  });
});
