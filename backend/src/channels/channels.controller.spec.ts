import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

describe('ChannelsController', () => {
  let controller: ChannelsController;
  let channelsService: Mocked<ChannelsService>;

  beforeEach(async () => {
    const { unit, unitRef } =
      await TestBed.solitary(ChannelsController).compile();

    controller = unit;
    channelsService = unitRef.get(ChannelsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have a service', () => {
    expect(channelsService).toBeDefined();
  });

  describe('create', () => {
    it('should create a channel', async () => {
      const createDto = {
        name: 'general',
        communityId: 'community-123',
        type: 'TEXT',
      };
      const mockUser = { id: 'user-123', username: 'testuser' };
      const mockReq = { user: mockUser } as any;
      const createdChannel = { id: 'channel-123', ...createDto };

      channelsService.create.mockResolvedValue(createdChannel as any);

      const result = await controller.create(createDto as any, mockReq);

      expect(result).toEqual(createdChannel);
      expect(channelsService.create).toHaveBeenCalledWith(createDto, mockUser);
    });
  });

  describe('findAllForCommunity', () => {
    it('should return all channels for a community', async () => {
      const communityId = 'community-456';
      const channels = [
        { id: 'channel-1', name: 'general' },
        { id: 'channel-2', name: 'random' },
      ];

      channelsService.findAll.mockResolvedValue(channels as any);

      const result = await controller.findAllForCommunity(communityId);

      expect(result).toEqual(channels);
      expect(channelsService.findAll).toHaveBeenCalledWith(communityId);
    });
  });

  describe('getMentionableChannels', () => {
    it('should return mentionable channels for user', async () => {
      const communityId = 'community-789';
      const mockUser = { id: 'user-456' };
      const mockReq = { user: mockUser } as any;
      const channels = [{ id: 'channel-1', name: 'general' }];

      channelsService.findMentionableChannels.mockResolvedValue(
        channels as any,
      );

      const result = await controller.getMentionableChannels(
        communityId,
        mockReq,
      );

      expect(result).toEqual(channels);
      expect(channelsService.findMentionableChannels).toHaveBeenCalledWith(
        communityId,
        'user-456',
      );
    });
  });

  describe('findOne', () => {
    it('should return a single channel', async () => {
      const channelId = 'channel-999';
      const channel = { id: channelId, name: 'announcements' };

      channelsService.findOne.mockResolvedValue(channel as any);

      const result = await controller.findOne(channelId);

      expect(result).toEqual(channel);
      expect(channelsService.findOne).toHaveBeenCalledWith(channelId);
    });
  });

  describe('update', () => {
    it('should update a channel', async () => {
      const channelId = 'channel-111';
      const updateDto = { name: 'updated-channel' };
      const updatedChannel = { id: channelId, ...updateDto };

      channelsService.update.mockResolvedValue(updatedChannel as any);

      const result = await controller.update(channelId, updateDto);

      expect(result).toEqual(updatedChannel);
      expect(channelsService.update).toHaveBeenCalledWith(channelId, updateDto);
    });
  });

  describe('remove', () => {
    it('should remove a channel', async () => {
      const channelId = 'channel-222';

      channelsService.remove.mockResolvedValue(undefined);

      const result = await controller.remove(channelId);

      expect(result).toBeUndefined();
      expect(channelsService.remove).toHaveBeenCalledWith(channelId);
    });
  });
});
