import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { UserFactory, MembershipFactory } from '@/test-utils';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { ForbiddenException } from '@nestjs/common';

describe('MembershipController', () => {
  let controller: MembershipController;
  let service: Mocked<MembershipService>;

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: { id: mockUser.id },
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(MembershipController).compile();

    controller = unit;
    service = unitRef.get(MembershipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a membership', async () => {
      const createDto: CreateMembershipDto = {
        userId: 'user-123',
        communityId: 'community-123',
      };

      const mockMembership = MembershipFactory.build({
        userId: 'user-123',
        communityId: 'community-123',
      });

      service.create.mockResolvedValue(mockMembership);

      const result = await controller.create(createDto);

      expect(service.create).toHaveBeenCalledWith(createDto);
      expect(result).toEqual(mockMembership);
    });
  });

  describe('findAllForCommunity', () => {
    it('should return the paginated envelope of members for a community', async () => {
      const communityId = 'community-123';
      const mockResponse = {
        members: [
          MembershipFactory.build({ communityId }),
          MembershipFactory.build({ communityId }),
        ],
        continuationToken: undefined,
      };

      service.findAllForCommunity.mockResolvedValue(mockResponse);

      const result = await controller.findAllForCommunity(
        communityId,
        100,
        undefined,
      );

      expect(service.findAllForCommunity).toHaveBeenCalledWith(
        communityId,
        100,
        undefined,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should pass through the continuationToken and cap an oversized limit', async () => {
      const communityId = 'community-123';
      const mockResponse = { members: [], continuationToken: undefined };

      service.findAllForCommunity.mockResolvedValue(mockResponse);

      await controller.findAllForCommunity(communityId, 9999, 'some-token');

      expect(service.findAllForCommunity).toHaveBeenCalledWith(
        communityId,
        500,
        'some-token',
      );
    });
  });

  describe('searchCommunityMembers', () => {
    it('should search community members with default limit', async () => {
      const communityId = 'community-123';
      const query = 'john';
      const mockResults = [MembershipFactory.build()];

      service.searchMembers.mockResolvedValue(mockResults);

      const result = await controller.searchCommunityMembers(
        communityId,
        query,
        10,
      );

      expect(service.searchMembers).toHaveBeenCalledWith(
        communityId,
        query,
        10,
      );
      expect(result).toEqual(mockResults);
    });

    it('should search with custom limit', async () => {
      const communityId = 'community-456';
      const query = 'test';

      service.searchMembers.mockResolvedValue([]);

      await controller.searchCommunityMembers(communityId, query, 25);

      expect(service.searchMembers).toHaveBeenCalledWith(
        communityId,
        query,
        25,
      );
    });

    it('should use empty string when query is not provided', async () => {
      const communityId = 'community-789';

      service.searchMembers.mockResolvedValue([]);

      await controller.searchCommunityMembers(communityId, '', 10);

      expect(service.searchMembers).toHaveBeenCalledWith(communityId, '', 10);
    });
  });

  describe('findAllForUser', () => {
    it('should return user memberships when user requests their own', async () => {
      const userId = mockUser.id;
      const mockMemberships = [
        MembershipFactory.build({ userId }),
        MembershipFactory.build({ userId }),
      ];

      service.findAllForUser.mockResolvedValue(mockMemberships);

      const result = await controller.findAllForUser(userId, mockRequest);

      expect(service.findAllForUser).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockMemberships);
    });

    it('should throw ForbiddenException when requesting other user memberships', async () => {
      const otherUserId = 'other-user-123';

      try {
        await controller.findAllForUser(otherUserId, mockRequest);
        fail('Should have thrown ForbiddenException');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe('Cannot view other users memberships');
      }

      expect(service.findAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('findMyMemberships', () => {
    it('should return current user memberships', async () => {
      const mockMemberships = [
        MembershipFactory.build({ userId: mockUser.id }),
        MembershipFactory.build({ userId: mockUser.id }),
      ];

      service.findAllForUser.mockResolvedValue(mockMemberships);

      const result = await controller.findMyMemberships(mockRequest);

      expect(service.findAllForUser).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockMemberships);
    });

    it('should use authenticated user ID from request', async () => {
      service.findAllForUser.mockResolvedValue([]);

      await controller.findMyMemberships(mockRequest);

      expect(service.findAllForUser).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('findOne', () => {
    it('should return a specific membership', async () => {
      const userId = 'user-123';
      const communityId = 'community-123';
      const mockMembership = MembershipFactory.build({
        userId,
        communityId,
      });

      service.findOne.mockResolvedValue(mockMembership);

      const result = await controller.findOne(userId, communityId);

      expect(service.findOne).toHaveBeenCalledWith(userId, communityId);
      expect(result).toEqual(mockMembership);
    });
  });

  describe('remove', () => {
    it('should remove a membership', async () => {
      const userId = 'user-123';
      const communityId = 'community-123';

      service.remove.mockResolvedValue(undefined);

      await controller.remove(userId, communityId);

      expect(service.remove).toHaveBeenCalledWith(userId, communityId);
    });
  });

  describe('leaveCommunity', () => {
    it('should allow user to leave community', async () => {
      const communityId = 'community-123';

      service.remove.mockResolvedValue(undefined);

      await controller.leaveCommunity(communityId, mockRequest);

      expect(service.remove).toHaveBeenCalledWith(mockUser.id, communityId);
    });

    it('should use authenticated user ID', async () => {
      const communityId = 'community-456';

      service.remove.mockResolvedValue(undefined);

      await controller.leaveCommunity(communityId, mockRequest);

      const callArgs = (service.remove as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(mockUser.id);
      expect(callArgs[1]).toBe(communityId);
    });
  });
});
