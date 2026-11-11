import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ChannelMembershipController } from './channel-membership.controller';
import { ChannelMembershipService } from './channel-membership.service';
import { UserFactory, ChannelMembershipFactory } from '@/test-utils';
import { CreateChannelMembershipDto } from './dto/create-channel-membership.dto';
import { ForbiddenException } from '@nestjs/common';

describe('ChannelMembershipController', () => {
  let controller: ChannelMembershipController;
  let service: Mocked<ChannelMembershipService>;

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: { id: mockUser.id },
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      ChannelMembershipController,
    ).compile();

    controller = unit;
    service = unitRef.get(ChannelMembershipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a channel membership', async () => {
      const createDto: CreateChannelMembershipDto = {
        userId: 'user-123',
        channelId: 'channel-123',
      };

      const mockMembership = ChannelMembershipFactory.build({
        userId: 'user-123',
        channelId: 'channel-123',
      });

      service.create.mockResolvedValue(mockMembership as any);

      const result = await controller.create(createDto, mockRequest);

      expect(service.create).toHaveBeenCalledWith(createDto, mockUser.id);
      expect(result).toEqual(mockMembership);
    });

    it('should pass creator user ID from request', async () => {
      const createDto: CreateChannelMembershipDto = {
        userId: 'other-user',
        channelId: 'channel-456',
      };

      service.create.mockResolvedValue(ChannelMembershipFactory.build() as any);

      await controller.create(createDto, mockRequest);

      const callArgs = (service.create as jest.Mock).mock.calls[0];
      expect(callArgs[1]).toBe(mockUser.id);
    });
  });

  describe('findAllForChannel', () => {
    it('should return all members of a channel', async () => {
      const channelId = 'channel-123';
      const mockMemberships = [
        ChannelMembershipFactory.build({ channelId }),
        ChannelMembershipFactory.build({ channelId }),
      ];

      service.findAllForChannel.mockResolvedValue(mockMemberships as any);

      const result = await controller.findAllForChannel(channelId);

      expect(service.findAllForChannel).toHaveBeenCalledWith(channelId);
      expect(result).toEqual(mockMemberships);
    });
  });

  describe('findAllForUser', () => {
    it('should return user channel memberships when user requests their own', async () => {
      const userId = mockUser.id;
      const mockMemberships = [
        ChannelMembershipFactory.build({ userId }),
        ChannelMembershipFactory.build({ userId }),
      ];

      service.findAllForUser.mockResolvedValue(mockMemberships as any);

      const result = await controller.findAllForUser(userId, mockRequest);

      expect(service.findAllForUser).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockMemberships);
    });

    it('should throw ForbiddenException when requesting other user channel memberships', async () => {
      const otherUserId = 'other-user-123';

      try {
        await controller.findAllForUser(otherUserId, mockRequest);
        fail('Should have thrown ForbiddenException');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe(
          'Cannot view other users channel memberships',
        );
      }

      expect(service.findAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('findMyChannelMemberships', () => {
    it('should return current user channel memberships', async () => {
      const mockMemberships = [
        ChannelMembershipFactory.build({ userId: mockUser.id }),
        ChannelMembershipFactory.build({ userId: mockUser.id }),
      ];

      service.findAllForUser.mockResolvedValue(mockMemberships as any);

      const result = await controller.findMyChannelMemberships(mockRequest);

      expect(service.findAllForUser).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockMemberships);
    });
  });

  describe('findOne', () => {
    it('should return a specific channel membership', async () => {
      const userId = 'user-123';
      const channelId = 'channel-123';
      const mockMembership = ChannelMembershipFactory.build({
        userId,
        channelId,
      });

      service.findOne.mockResolvedValue(mockMembership as any);

      const result = await controller.findOne(userId, channelId);

      expect(service.findOne).toHaveBeenCalledWith(userId, channelId);
      expect(result).toEqual(mockMembership);
    });
  });

  describe('remove', () => {
    it('should remove a channel membership', async () => {
      const userId = 'user-123';
      const channelId = 'channel-123';

      const req = { user: { id: 'actor', role: 'USER' } } as any;
      service.removeByActor.mockResolvedValue(undefined);

      await controller.remove(userId, channelId, req);

      expect(service.removeByActor).toHaveBeenCalledWith(
        req.user,
        userId,
        channelId,
      );
    });
  });

  describe('leaveChannel', () => {
    it('should allow user to leave channel', async () => {
      const channelId = 'channel-123';

      service.remove.mockResolvedValue(undefined);

      await controller.leaveChannel(channelId, mockRequest);

      expect(service.remove).toHaveBeenCalledWith(mockUser.id, channelId);
    });

    it('should use authenticated user ID', async () => {
      const channelId = 'channel-456';

      service.remove.mockResolvedValue(undefined);

      await controller.leaveChannel(channelId, mockRequest);

      const callArgs = (service.remove as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(mockUser.id);
      expect(callArgs[1]).toBe(channelId);
    });
  });
});
