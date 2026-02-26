import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { FriendshipStatus } from '@prisma/client';

describe('FriendsController', () => {
  let controller: FriendsController;
  let friendsService: Mocked<FriendsService>;

  const userId = 'user-123';
  const mockReq = { user: { id: userId } } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      FriendsController,
    ).compile();

    controller = unit;
    friendsService = unitRef.get(FriendsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFriends', () => {
    it('should return friends with friendship IDs', async () => {
      const friends = [
        {
          friendshipId: 'fs-1',
          user: { id: 'f1', username: 'alice', displayName: 'Alice' },
        },
        {
          friendshipId: 'fs-2',
          user: { id: 'f2', username: 'bob', displayName: 'Bob' },
        },
      ];
      friendsService.getFriends.mockResolvedValue(friends as any);

      const result = await controller.getFriends(mockReq);

      expect(result).toHaveLength(2);
      expect(result[0]?.friendshipId).toBe('fs-1');
      expect(friendsService.getFriends).toHaveBeenCalledWith(userId);
    });
  });

  describe('getPendingRequests', () => {
    it('should return sent and received requests', async () => {
      const mockResult = {
        sent: [
          {
            id: 'fr-1',
            userAId: userId,
            userBId: 'other',
            userA: { id: userId, username: 'me' },
            userB: { id: 'other', username: 'other' },
          },
        ],
        received: [],
      };
      friendsService.getPendingRequests.mockResolvedValue(mockResult as any);

      const result = await controller.getPendingRequests(mockReq);

      expect(result.sent).toHaveLength(1);
      expect(result.received).toHaveLength(0);
      expect(friendsService.getPendingRequests).toHaveBeenCalledWith(userId);
    });
  });

  describe('getFriendshipStatus', () => {
    it('should return status for specific user', async () => {
      const targetUserId = 'target-456';
      const mockStatus = {
        status: FriendshipStatus.ACCEPTED,
        friendshipId: 'fr-1',
        direction: null as any,
      };

      friendsService.getFriendshipStatus.mockResolvedValue(mockStatus);

      const result = await controller.getFriendshipStatus(
        mockReq,
        targetUserId,
      );

      expect(result).toEqual(mockStatus);
      expect(friendsService.getFriendshipStatus).toHaveBeenCalledWith(
        userId,
        targetUserId,
      );
    });
  });

  describe('sendFriendRequest', () => {
    it('should send request and return friendship', async () => {
      const targetUserId = 'target-456';
      const mockFriendship = {
        id: 'fr-1',
        userAId: userId,
        userBId: targetUserId,
        status: FriendshipStatus.PENDING,
      };

      friendsService.sendFriendRequest.mockResolvedValue(mockFriendship as any);

      const result = await controller.sendFriendRequest(mockReq, targetUserId);

      expect(result).toEqual(mockFriendship);
      expect(friendsService.sendFriendRequest).toHaveBeenCalledWith(
        userId,
        targetUserId,
      );
    });
  });

  describe('acceptFriendRequest', () => {
    it('should accept and return updated friendship', async () => {
      const friendshipId = 'fr-1';
      const mockFriendship = {
        id: friendshipId,
        status: FriendshipStatus.ACCEPTED,
      };

      friendsService.acceptFriendRequest.mockResolvedValue(
        mockFriendship as any,
      );

      const result = await controller.acceptFriendRequest(
        mockReq,
        friendshipId,
      );

      expect(result).toEqual(mockFriendship);
      expect(friendsService.acceptFriendRequest).toHaveBeenCalledWith(
        userId,
        friendshipId,
      );
    });
  });

  describe('declineFriendRequest', () => {
    it('should decline and return success', async () => {
      const friendshipId = 'fr-1';
      friendsService.declineFriendRequest.mockResolvedValue(undefined);

      const result = await controller.declineFriendRequest(
        mockReq,
        friendshipId,
      );

      expect(result).toEqual({ success: true });
    });
  });

  describe('cancelFriendRequest', () => {
    it('should cancel and return success', async () => {
      const friendshipId = 'fr-1';
      friendsService.cancelFriendRequest.mockResolvedValue(undefined);

      const result = await controller.cancelFriendRequest(
        mockReq,
        friendshipId,
      );

      expect(result).toEqual({ success: true });
    });
  });

  describe('removeFriend', () => {
    it('should remove and return success', async () => {
      const friendshipId = 'fr-1';
      friendsService.removeFriend.mockResolvedValue(undefined);

      const result = await controller.removeFriend(mockReq, friendshipId);

      expect(result).toEqual({ success: true });
    });
  });
});
