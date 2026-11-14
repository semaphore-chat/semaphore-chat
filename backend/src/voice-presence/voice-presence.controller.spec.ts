import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import {
  VoicePresenceController,
  DmVoicePresenceController,
  UserVoicePresenceController,
} from './voice-presence.controller';
import { VoicePresenceService } from './voice-presence.service';
import { UserFactory } from '@/test-utils';

describe('VoicePresenceController', () => {
  let controller: VoicePresenceController;
  let service: Mocked<VoicePresenceService>;

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: mockUser,
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      VoicePresenceController,
    ).compile();

    controller = unit;
    service = unitRef.get(VoicePresenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getChannelPresence', () => {
    it('should return channel presence with user count', async () => {
      const channelId = 'channel-123';
      const mockUsers = [
        {
          id: 'user-1',
          username: 'user1',
          joinedAt: new Date().toISOString(),
          isDeafened: false,
          isServerMuted: false,
          canModerate: false,
        },
        {
          id: 'user-2',
          username: 'user2',
          joinedAt: new Date().toISOString(),
          isDeafened: false,
          isServerMuted: false,
          canModerate: true,
        },
      ];

      service.getChannelPresenceForViewer.mockResolvedValue(mockUsers);

      const result = await controller.getChannelPresence(
        channelId,
        mockRequest,
      );

      expect(service.getChannelPresenceForViewer).toHaveBeenCalledWith(
        channelId,
        mockUser,
      );
      expect(result).toEqual({
        channelId,
        users: mockUsers,
        count: 2,
      });
    });

    it('should return empty array when no users in channel', async () => {
      const channelId = 'channel-456';

      service.getChannelPresenceForViewer.mockResolvedValue([]);

      const result = await controller.getChannelPresence(
        channelId,
        mockRequest,
      );

      expect(result.users).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe('refreshPresence', () => {
    it('should refresh presence and return success', async () => {
      const channelId = 'channel-123';

      service.refreshPresence.mockResolvedValue();

      const result = await controller.refreshPresence(channelId, mockRequest);

      expect(service.refreshPresence).toHaveBeenCalledWith(
        channelId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        message: 'Presence refreshed successfully',
        channelId,
      });
    });
  });

  describe('joinPresence', () => {
    it('should register voice presence and return success', async () => {
      const channelId = 'channel-123';

      service.joinVoiceChannelDirect.mockResolvedValue();

      const result = await controller.joinPresence(channelId, mockRequest);

      expect(service.joinVoiceChannelDirect).toHaveBeenCalledWith(
        channelId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        message: 'Voice presence registered',
        channelId,
      });
    });
  });

  describe('leavePresence', () => {
    it('should remove voice presence and return success', async () => {
      const channelId = 'channel-123';

      service.leaveVoiceChannel.mockResolvedValue();

      const result = await controller.leavePresence(channelId, mockRequest);

      expect(service.leaveVoiceChannel).toHaveBeenCalledWith(
        channelId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        message: 'Voice presence removed',
        channelId,
      });
    });
  });
  describe('updateDeafenState', () => {
    it('should update deafen state and return success', async () => {
      const channelId = 'channel-123';
      const body = { isDeafened: true };

      service.updateDeafenState.mockResolvedValue();

      const result = await controller.updateDeafenState(
        channelId,
        body,
        mockRequest,
      );

      expect(service.updateDeafenState).toHaveBeenCalledWith(
        channelId,
        mockUser.id,
        true,
      );
      expect(result).toEqual({
        success: true,
        message: 'Deafen state updated to true',
        channelId,
      });
    });

    it('should handle undeafen', async () => {
      const channelId = 'channel-123';
      const body = { isDeafened: false };

      service.updateDeafenState.mockResolvedValue();

      const result = await controller.updateDeafenState(
        channelId,
        body,
        mockRequest,
      );

      expect(service.updateDeafenState).toHaveBeenCalledWith(
        channelId,
        mockUser.id,
        false,
      );
      expect(result.message).toBe('Deafen state updated to false');
    });
  });
});

describe('DmVoicePresenceController', () => {
  let controller: DmVoicePresenceController;
  let service: Mocked<VoicePresenceService>;

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: mockUser,
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      DmVoicePresenceController,
    ).compile();

    controller = unit;
    service = unitRef.get(VoicePresenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('updateDmDeafenState', () => {
    it("sets the caller's deafen state in the DM call", async () => {
      service.updateDmDeafenState.mockResolvedValue();

      const result = await controller.updateDmDeafenState(
        'dm-group-123',
        { isDeafened: true },
        { user: { id: 'user-1' } } as never,
      );

      expect(service.updateDmDeafenState).toHaveBeenCalledWith(
        'dm-group-123',
        'user-1',
        true,
      );
      expect(result).toEqual({
        success: true,
        message: 'Deafen state updated to true',
        dmGroupId: 'dm-group-123',
      });
    });
  });

  describe('getDmPresence', () => {
    it('should return DM presence with user count', async () => {
      const dmGroupId = 'dm-group-123';
      const mockUsers = [
        {
          id: 'user-1',
          username: 'user1',
          joinedAt: new Date(),
          isDeafened: false,
        },
      ];

      service.getDmPresence.mockResolvedValue(mockUsers as any);

      const result = await controller.getDmPresence(dmGroupId, {
        user: { id: 'user-1' },
      } as never);

      expect(service.assertDmMember).toHaveBeenCalledWith(dmGroupId, 'user-1');
      expect(service.getDmPresence).toHaveBeenCalledWith(dmGroupId);
      expect(result).toEqual({
        dmGroupId,
        users: mockUsers,
        count: 1,
      });
    });
  });

  describe('refreshDmPresence', () => {
    it('should refresh DM presence and return success', async () => {
      const dmGroupId = 'dm-group-123';

      service.refreshDmPresence.mockResolvedValue();

      const result = await controller.refreshDmPresence(dmGroupId, mockRequest);

      expect(service.refreshDmPresence).toHaveBeenCalledWith(
        dmGroupId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        message: 'DM presence refreshed successfully',
        dmGroupId,
      });
    });
  });

  describe('declineDmVoiceCall', () => {
    it('should decline the call for the requesting user', async () => {
      const dmGroupId = 'dm-group-123';

      service.declineDmVoiceCall.mockResolvedValue();

      const result = await controller.declineDmVoiceCall(
        dmGroupId,
        mockRequest,
      );

      expect(service.declineDmVoiceCall).toHaveBeenCalledWith(
        dmGroupId,
        mockUser.id,
      );
      expect(result).toEqual({
        success: true,
        message: 'Call declined',
        dmGroupId,
      });
    });
  });
});

describe('UserVoicePresenceController', () => {
  let controller: UserVoicePresenceController;
  let service: Mocked<VoicePresenceService>;

  const mockUser = UserFactory.build();
  const mockRequest = {
    user: mockUser,
  } as any;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      UserVoicePresenceController,
    ).compile();

    controller = unit;
    service = unitRef.get(VoicePresenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMyVoiceChannels', () => {
    it('should return user voice channels', async () => {
      const mockChannels = ['channel-1', 'channel-2'];

      service.getUserVoiceChannels.mockResolvedValue(mockChannels);

      const result = await controller.getMyVoiceChannels(mockRequest);

      expect(service.getUserVoiceChannels).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual({
        userId: mockUser.id,
        voiceChannels: mockChannels,
      });
    });

    it('should return empty array when user is not in any voice channels', async () => {
      service.getUserVoiceChannels.mockResolvedValue([]);

      const result = await controller.getMyVoiceChannels(mockRequest);

      expect(result.voiceChannels).toEqual([]);
    });
  });
});
