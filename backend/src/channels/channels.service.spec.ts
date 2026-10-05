import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannelsService } from './channels.service';
import { DatabaseService } from '@/database/database.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { createMockDatabase, UserFactory, ChannelFactory } from '@/test-utils';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@semaphore-chat/shared';

describe('ChannelsService', () => {
  let service: ChannelsService;
  let mockDatabase: any;
  let eventEmitter: Mocked<EventEmitter2>;
  let channelAccessService: Mocked<ChannelAccessService>;
  let websocketService: Mocked<WebsocketService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(ChannelsService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    eventEmitter = unitRef.get(EventEmitter2);
    channelAccessService = unitRef.get(ChannelAccessService);
    websocketService = unitRef.get(WebsocketService);
    channelAccessService.audienceRoomFor.mockImplementation((id) =>
      Promise.resolve(`community:of-${id}`),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a channel and add creator as member', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'announcements',
        communityId: 'community-123',
        type: ChannelType.TEXT,
        isPrivate: false,
      } as any;
      const channel = ChannelFactory.build({ position: 0 });

      mockDatabase.channel.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      mockDatabase.channel.create.mockResolvedValue(channel);
      mockDatabase.channelMembership.create.mockResolvedValue({
        userId: user.id,
        channelId: channel.id,
      });

      const result = await service.create(createDto, user);

      expect(result).toEqual(channel);
      expect(mockDatabase.channel.create).toHaveBeenCalledWith({
        data: { ...createDto, position: 0 },
      });
      expect(mockDatabase.channelMembership.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          channelId: channel.id,
        },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.CHANNEL_CREATED,
        {
          channelId: channel.id,
          communityId: channel.communityId,
        },
      );
    });

    it('announces a channel only the creator can see to the creator alone', async () => {
      const user = UserFactory.build();
      const channel = ChannelFactory.build({ isPrivate: true, position: 0 });
      mockDatabase.channel.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      mockDatabase.channel.create.mockResolvedValue(channel);
      mockDatabase.channelMembership.create.mockResolvedValue({});
      channelAccessService.audienceRoomFor.mockResolvedValue(channel.id);

      await service.create(
        {
          name: 'secret',
          communityId: channel.communityId,
          type: ChannelType.TEXT,
          isPrivate: true,
        },
        user,
      );

      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `user:${user.id}`,
        ServerEvents.CHANNEL_CREATED,
        expect.anything(),
      );
    });

    it('should throw ConflictException for duplicate channel name', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'general',
        communityId: 'community-123',
        type: ChannelType.TEXT,
        isPrivate: false,
      } as any;

      mockDatabase.channel.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      const duplicateError = { code: 'P2002' };
      mockDatabase.channel.create.mockRejectedValue(duplicateError);

      await expect(service.create(createDto, user)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(createDto, user)).rejects.toThrow(
        'Channel with this name already exists in the community',
      );
    });

    it('should rethrow non-P2002 errors', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'test-channel',
        communityId: 'community-123',
        type: ChannelType.TEXT,
        isPrivate: false,
      } as any;

      mockDatabase.channel.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      mockDatabase.channel.create.mockRejectedValue(
        new Error('DB connection error'),
      );

      await expect(service.create(createDto, user)).rejects.toThrow(
        'DB connection error',
      );
    });

    it('should create private channels', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'private-discussion',
        communityId: 'community-123',
        type: ChannelType.TEXT,
        isPrivate: true,
      } as any;
      const channel = ChannelFactory.build({ isPrivate: true, position: 0 });

      mockDatabase.channel.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      mockDatabase.channel.create.mockResolvedValue(channel);
      mockDatabase.channelMembership.create.mockResolvedValue({
        userId: user.id,
        channelId: channel.id,
      });

      const result = await service.create(createDto, user);

      expect(result.isPrivate).toBe(true);
    });

    it('should create voice channels', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'voice-chat',
        communityId: 'community-123',
        type: ChannelType.VOICE,
        isPrivate: false,
      } as any;
      const channel = ChannelFactory.build({
        type: ChannelType.VOICE,
        position: 0,
      });

      mockDatabase.channel.aggregate.mockResolvedValue({
        _max: { position: null },
      });
      mockDatabase.channel.create.mockResolvedValue(channel);
      mockDatabase.channelMembership.create.mockResolvedValue({
        userId: user.id,
        channelId: channel.id,
      });

      const result = await service.create(createDto, user);

      expect(result.type).toBe(ChannelType.VOICE);
    });
  });

  describe('findAll', () => {
    it('returns only the channels the user can see', async () => {
      const communityId = 'community-123';
      const visible = ChannelFactory.build({ communityId });
      const hidden = ChannelFactory.build({ communityId, isPrivate: true });

      mockDatabase.channel.findMany.mockResolvedValue([visible, hidden]);
      channelAccessService.visibleChannelIds.mockResolvedValue([visible.id]);

      const result = await service.findAll(communityId, 'user-1');

      expect(result).toEqual([visible]);
      expect(channelAccessService.visibleChannelIds).toHaveBeenCalledWith(
        'user-1',
        communityId,
      );
      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: { communityId },
        orderBy: [{ type: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      });
    });

    it('should return empty array when no channels exist', async () => {
      const communityId = 'community-123';
      mockDatabase.channel.findMany.mockResolvedValue([]);
      channelAccessService.visibleChannelIds.mockResolvedValue([]);

      const result = await service.findAll(communityId, 'user-1');

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return a channel by ID', async () => {
      const channel = ChannelFactory.build();
      mockDatabase.channel.findUnique.mockResolvedValue(channel);

      const result = await service.findOne(channel.id);

      expect(result).toEqual(channel);
      expect(mockDatabase.channel.findUnique).toHaveBeenCalledWith({
        where: { id: channel.id },
      });
    });

    it('should throw NotFoundException when channel not found', async () => {
      mockDatabase.channel.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'Channel not found',
      );
    });
  });

  describe('update', () => {
    it('should update channel successfully', async () => {
      const channelId = 'channel-123';
      const updateDto = { name: 'updated-channel', isPrivate: true };
      const updatedChannel = ChannelFactory.build({
        ...updateDto,
        id: channelId,
      });

      mockDatabase.channel.update.mockResolvedValue(updatedChannel);

      const result = await service.update(channelId, updateDto);

      expect(result).toEqual(updatedChannel);
      expect(mockDatabase.channel.update).toHaveBeenCalledWith({
        where: { id: channelId },
        data: updateDto,
      });
    });

    it('resyncs the channel room and tells the community when privacy is toggled', async () => {
      const channelId = 'channel-123';
      const updated = ChannelFactory.build({ id: channelId, isPrivate: true });
      mockDatabase.channel.findUnique.mockResolvedValue({ isPrivate: false });
      mockDatabase.channel.update.mockResolvedValue(updated);

      await service.update(channelId, { isPrivate: true });

      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        RoomEvents.CHANNEL_VISIBILITY_CHANGED,
        { channelId, communityId: updated.communityId },
      );
      expect(websocketService.sendToRoom).toHaveBeenCalledWith(
        `community:${updated.communityId}`,
        ServerEvents.CHANNEL_PERMISSIONS_UPDATED,
        { communityId: updated.communityId, channelId },
      );
    });

    it('should throw ConflictException for duplicate channel name', async () => {
      const channelId = 'channel-123';
      const updateDto = { name: 'general' };

      const duplicateError = { code: 'P2002' };
      mockDatabase.channel.update.mockRejectedValue(duplicateError);

      await expect(service.update(channelId, updateDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.update(channelId, updateDto)).rejects.toThrow(
        'Channel with this name already exists in the community',
      );
    });

    it('should rethrow non-P2002 errors', async () => {
      const channelId = 'channel-123';
      const updateDto = { name: 'updated-channel' };

      mockDatabase.channel.update.mockRejectedValue(new Error('DB error'));

      await expect(service.update(channelId, updateDto)).rejects.toThrow(
        'DB error',
      );
    });
  });

  describe('remove', () => {
    it('should cascade delete channel and related records', async () => {
      const channel = ChannelFactory.build();

      mockDatabase.channel.findUnique.mockResolvedValue(channel);
      mockDatabase.notification.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.channelNotificationOverride.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockDatabase.readReceipt.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.webhook.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.threadSubscriber.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.channelMembership.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.message.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.channel.delete.mockResolvedValue(channel);

      await service.remove(channel.id);

      expect(mockDatabase.notification.deleteMany).toHaveBeenCalledWith({
        where: { channelId: channel.id },
      });
      expect(
        mockDatabase.channelNotificationOverride.deleteMany,
      ).toHaveBeenCalledWith({
        where: { channelId: channel.id },
      });
      expect(mockDatabase.readReceipt.deleteMany).toHaveBeenCalledWith({
        where: { channelId: channel.id },
      });
      expect(mockDatabase.webhook.deleteMany).toHaveBeenCalledWith({
        where: { channelId: channel.id },
      });
      expect(mockDatabase.threadSubscriber.deleteMany).toHaveBeenCalledWith({
        where: { parentMessage: { channelId: channel.id } },
      });
      expect(mockDatabase.channelMembership.deleteMany).toHaveBeenCalledWith({
        where: { channelId: channel.id },
      });
      expect(mockDatabase.message.deleteMany).toHaveBeenCalledWith({
        where: { channelId: channel.id },
      });
      expect(mockDatabase.channel.delete).toHaveBeenCalledWith({
        where: { id: channel.id },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.CHANNEL_DELETED,
        { channelId: channel.id },
      );
    });

    it('should throw NotFoundException when channel not found', async () => {
      mockDatabase.channel.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createDefaultGeneralChannel', () => {
    it('should create general channel without transaction', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';
      const generalChannel = ChannelFactory.build({
        name: 'general',
        communityId,
        type: ChannelType.TEXT,
        isPrivate: false,
      });

      mockDatabase.channel.create.mockResolvedValue(generalChannel);
      mockDatabase.channelMembership.create.mockResolvedValue({
        userId,
        channelId: generalChannel.id,
      });

      const result = await service.createDefaultGeneralChannel(
        communityId,
        userId,
      );

      expect(result).toEqual(generalChannel);
      expect(mockDatabase.channel.create).toHaveBeenCalledWith({
        data: {
          name: 'general',
          communityId,
          type: ChannelType.TEXT,
          isPrivate: false,
        },
      });
      expect(mockDatabase.channelMembership.create).toHaveBeenCalledWith({
        data: {
          userId,
          channelId: generalChannel.id,
        },
      });
    });

    it('should create general channel with transaction', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';
      const generalChannel = ChannelFactory.build({
        name: 'general',
        communityId,
        type: ChannelType.TEXT,
        isPrivate: false,
      });

      const mockTx = {
        channel: {
          create: jest.fn().mockResolvedValue(generalChannel),
        },
        channelMembership: {
          create: jest
            .fn()
            .mockResolvedValue({ userId, channelId: generalChannel.id }),
        },
      };

      const result = await service.createDefaultGeneralChannel(
        communityId,
        userId,
        mockTx as any,
      );

      expect(result).toEqual(generalChannel);
      expect(mockTx.channel.create).toHaveBeenCalledWith({
        data: {
          name: 'general',
          communityId,
          type: ChannelType.TEXT,
          isPrivate: false,
        },
      });
      expect(mockDatabase.channel.create).not.toHaveBeenCalled();
    });

    it('should rethrow errors', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';

      mockDatabase.channel.create.mockRejectedValue(
        new Error('Channel creation failed'),
      );

      await expect(
        service.createDefaultGeneralChannel(communityId, userId),
      ).rejects.toThrow('Channel creation failed');
    });
  });

  describe('addUserToGeneralChannel', () => {
    it('should add user to general channel', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';
      const generalChannel = ChannelFactory.build({
        name: 'general',
        communityId,
      });

      mockDatabase.channel.findFirst.mockResolvedValue(generalChannel);
      mockDatabase.channelMembership.findFirst.mockResolvedValue(null);
      mockDatabase.channelMembership.create.mockResolvedValue({
        userId,
        channelId: generalChannel.id,
      });

      await service.addUserToGeneralChannel(communityId, userId);

      expect(mockDatabase.channel.findFirst).toHaveBeenCalledWith({
        where: {
          communityId,
          name: 'general',
        },
      });
      expect(mockDatabase.channelMembership.create).toHaveBeenCalledWith({
        data: {
          userId,
          channelId: generalChannel.id,
        },
      });
    });

    it('should do nothing if general channel does not exist', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';

      mockDatabase.channel.findFirst.mockResolvedValue(null);

      await service.addUserToGeneralChannel(communityId, userId);

      expect(mockDatabase.channelMembership.create).not.toHaveBeenCalled();
    });

    it('should do nothing if user is already a member', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';
      const generalChannel = ChannelFactory.build({
        name: 'general',
        communityId,
      });

      mockDatabase.channel.findFirst.mockResolvedValue(generalChannel);
      mockDatabase.channelMembership.findFirst.mockResolvedValue({
        userId,
        channelId: generalChannel.id,
      });

      await service.addUserToGeneralChannel(communityId, userId);

      expect(mockDatabase.channelMembership.create).not.toHaveBeenCalled();
    });

    it('should rethrow errors', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';

      mockDatabase.channel.findFirst.mockRejectedValue(new Error('DB error'));

      await expect(
        service.addUserToGeneralChannel(communityId, userId),
      ).rejects.toThrow('DB error');
    });
  });

  describe('findMentionableChannels', () => {
    it('returns the channels the user can see', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';
      const publicChannel = ChannelFactory.build({
        communityId,
        isPrivate: false,
        name: 'general',
      });
      const privateChannel = ChannelFactory.build({
        communityId,
        isPrivate: true,
        name: 'private',
      });

      const channels = [publicChannel, privateChannel];
      mockDatabase.channel.findMany.mockResolvedValue(channels);

      const result = await service.findMentionableChannels(communityId, userId);

      channelAccessService.visibleChannelIds.mockResolvedValue([
        publicChannel.id,
      ]);
      mockDatabase.channel.findMany.mockResolvedValue([publicChannel]);

      const visibleResult = await service.findMentionableChannels(
        communityId,
        userId,
      );

      expect(result).toEqual(channels);
      expect(visibleResult).toEqual([publicChannel]);
      expect(channelAccessService.visibleChannelIds).toHaveBeenCalledWith(
        userId,
        communityId,
      );
      expect(mockDatabase.channel.findMany).toHaveBeenLastCalledWith({
        where: { communityId, id: { in: [publicChannel.id] } },
        orderBy: {
          name: 'asc',
        },
      });
    });

    it('should return empty array when no mentionable channels exist', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';

      mockDatabase.channel.findMany.mockResolvedValue([]);

      const result = await service.findMentionableChannels(communityId, userId);

      expect(result).toEqual([]);
    });

    it('should sort channels by name', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';
      const channels = [
        ChannelFactory.build({ name: 'announcements' }),
        ChannelFactory.build({ name: 'general' }),
        ChannelFactory.build({ name: 'chat' }),
      ];

      mockDatabase.channel.findMany.mockResolvedValue(channels);

      await service.findMentionableChannels(communityId, userId);

      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            name: 'asc',
          },
        }),
      );
    });

    it('should rethrow errors', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';

      mockDatabase.channel.findMany.mockRejectedValue(new Error('DB error'));

      await expect(
        service.findMentionableChannels(communityId, userId),
      ).rejects.toThrow('DB error');
    });
  });
});
