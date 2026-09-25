import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { CommunityService } from './community.service';
import { DatabaseService } from '@/database/database.service';
import { ChannelsService } from '@/channels/channels.service';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  createMockDatabase,
  UserFactory,
  CommunityFactory,
} from '@/test-utils';

describe('CommunityService', () => {
  let service: CommunityService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let channelsService: Mocked<ChannelsService>;
  let communityRolesService: Mocked<CommunityRolesService>;
  let permissionsCacheService: Mocked<PermissionsCacheService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(CommunityService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    channelsService = unitRef.get(ChannelsService);
    communityRolesService = unitRef.get(CommunityRolesService);
    permissionsCacheService = unitRef.get(PermissionsCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a community with all default setup', async () => {
      const user = UserFactory.build();

      const createDto = {
        name: 'Test Community',
        description: 'A test community',
        avatar: null,
        banner: null,
      } as any;
      const community = CommunityFactory.build();

      mockDatabase.community.create.mockResolvedValue(community);
      mockDatabase.membership.create.mockResolvedValue({
        userId: user.id,
        communityId: community.id,
      });
      channelsService.createDefaultGeneralChannel.mockResolvedValue({
        id: 'channel-123',
        name: 'general',
        communityId: community.id,
        type: 'TEXT',
        isPrivate: false,
        createdAt: new Date(),
      } as any);
      communityRolesService.createDefaultCommunityRoles.mockResolvedValue(
        'admin-role-id',
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined,
      );

      const result = await service.create(createDto, user.id);

      expect(result).toEqual(community);

      expect(mockDatabase.community.create).toHaveBeenCalledWith({
        data: createDto,
      });
      expect(mockDatabase.membership.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          communityId: community.id,
        },
      });
      expect(channelsService.createDefaultGeneralChannel).toHaveBeenCalledWith(
        community.id,
        user.id,
        mockDatabase,
      );
      expect(
        communityRolesService.createDefaultCommunityRoles,
      ).toHaveBeenCalledWith(community.id, mockDatabase, expect.any(Array));
      expect(
        communityRolesService.assignUserToCommunityRole,
      ).toHaveBeenCalledWith(
        user.id,
        community.id,
        'admin-role-id',
        mockDatabase,
        expect.any(Array),
      );
    });

    it('flushes deferred epoch bumps only after the transaction commits', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = {
        name: 'Test Community',
        description: null,
        avatar: null,
        banner: null,
      } as any;

      const order: string[] = [];

      mockDatabase.community.create.mockResolvedValue(community);
      mockDatabase.membership.create.mockResolvedValue({});
      channelsService.createDefaultGeneralChannel.mockResolvedValue({} as any);

      // The (mocked) tx-nested role mutations record their bumps on the
      // collector the service passes in, exactly like the real ones do.
      communityRolesService.createDefaultCommunityRoles.mockImplementation(((
        _id: string,
        _tx: unknown,
        bumps: any[],
      ) => {
        bumps.push({ kind: 'community', communityId: community.id });
        return Promise.resolve('admin-role-id');
      }) as any);
      communityRolesService.assignUserToCommunityRole.mockImplementation(((
        userId: string,
        _communityId: string,
        _roleId: string,
        _tx: unknown,
        bumps: any[],
      ) => {
        bumps.push({ kind: 'user', userId });
        return Promise.resolve();
      }) as any);

      mockDatabase.$transaction.mockImplementation(async (cb: any) => {
        const result = await cb(mockDatabase);
        order.push('commit');
        return result;
      });
      permissionsCacheService.executeBumps.mockImplementation(() => {
        order.push('flush-bumps');
        return Promise.resolve();
      });

      const result = await service.create(createDto, user.id);

      expect(result).toEqual(community);
      // Bumps must flush strictly AFTER the transaction resolves (commit).
      expect(order).toEqual(['commit', 'flush-bumps']);
      expect(permissionsCacheService.executeBumps).toHaveBeenCalledWith([
        { kind: 'community', communityId: community.id },
        { kind: 'user', userId: user.id },
      ]);
      // No direct bumps during the transaction.
      expect(permissionsCacheService.bumpCommunityEpoch).not.toHaveBeenCalled();
      expect(permissionsCacheService.bumpUserEpoch).not.toHaveBeenCalled();
    });

    it('does not flush epoch bumps when the transaction rolls back', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = {
        name: 'Test Community',
        description: null,
        avatar: null,
        banner: null,
      } as any;

      mockDatabase.community.create.mockResolvedValue(community);
      mockDatabase.membership.create.mockResolvedValue({});
      channelsService.createDefaultGeneralChannel.mockResolvedValue({} as any);
      communityRolesService.createDefaultCommunityRoles.mockResolvedValue(
        'admin-role-id',
      );
      // Fails after the role mutations would have collected bumps.
      communityRolesService.assignUserToCommunityRole.mockRejectedValue(
        new Error('assignment failed'),
      );

      await expect(service.create(createDto, user.id)).rejects.toThrow(
        'assignment failed',
      );

      expect(permissionsCacheService.executeBumps).not.toHaveBeenCalled();
    });

    it('should throw ConflictException for duplicate community name', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'Duplicate Community',
        description: null,
        avatar: null,
        banner: null,
      } as any;

      const duplicateError = { code: 'P2002' };
      mockDatabase.community.create.mockRejectedValue(duplicateError);

      await expect(service.create(createDto, user.id)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(createDto, user.id)).rejects.toThrow(
        'Duplicate community name',
      );
    });

    it('should rethrow non-P2002 errors', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'Test Community',
        description: null,
        avatar: null,
        banner: null,
      } as any;

      mockDatabase.community.create.mockRejectedValue(
        new Error('DB connection error'),
      );

      await expect(service.create(createDto, user.id)).rejects.toThrow(
        'DB connection error',
      );
    });

    it('should handle transaction rollback on failure', async () => {
      const user = UserFactory.build();
      const createDto = {
        name: 'Test Community',
        description: null,
        avatar: null,
        banner: null,
      } as any;
      const community = CommunityFactory.build();

      mockDatabase.community.create.mockResolvedValue(community);
      mockDatabase.membership.create.mockResolvedValue({
        userId: user.id,
        communityId: community.id,
      });
      channelsService.createDefaultGeneralChannel.mockRejectedValue(
        new Error('Channel creation failed'),
      );

      await expect(service.create(createDto, user.id)).rejects.toThrow(
        'Channel creation failed',
      );
    });
  });

  describe('findAll', () => {
    it('should return all communities for a specific user', async () => {
      const user = UserFactory.build();
      const community1 = CommunityFactory.build();
      const community2 = CommunityFactory.build();

      const memberships = [
        { userId: user.id, communityId: community1.id, community: community1 },
        { userId: user.id, communityId: community2.id, community: community2 },
      ];

      mockDatabase.membership.findMany.mockResolvedValue(memberships);

      const result = await service.findAll(user.id);

      expect(result).toEqual([community1, community2]);
      expect(mockDatabase.membership.findMany).toHaveBeenCalledWith({
        where: { userId: user.id },
        include: { community: true },
      });
    });

    it('should return empty array when user has no communities', async () => {
      const user = UserFactory.build();
      mockDatabase.membership.findMany.mockResolvedValue([]);

      const result = await service.findAll(user.id);

      expect(result).toEqual([]);
    });

    it('should return all communities when no userId is provided', async () => {
      const communities = [CommunityFactory.build(), CommunityFactory.build()];
      mockDatabase.community.findMany.mockResolvedValue(communities);

      const result = await service.findAll();

      expect(result).toEqual(communities);
      expect(mockDatabase.community.findMany).toHaveBeenCalledWith({
        take: 100,
      });
      expect(mockDatabase.membership.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a community by ID', async () => {
      const community = CommunityFactory.build();
      mockDatabase.community.findUnique.mockResolvedValue(community);

      const result = await service.findOne(community.id);

      expect(result).toEqual(community);
      expect(mockDatabase.community.findUnique).toHaveBeenCalledWith({
        where: { id: community.id },
      });
    });

    it('should throw NotFoundException when community not found', async () => {
      mockDatabase.community.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'Community not found',
      );
    });
  });

  describe('update', () => {
    it('should update community basic fields', async () => {
      const community = CommunityFactory.build();
      const updateDto = {
        name: 'Updated Name',
        description: 'Updated description',
      };
      const updatedCommunity = { ...community, ...updateDto };

      mockDatabase.community.findUnique.mockResolvedValue(community);
      mockDatabase.community.update.mockResolvedValue(updatedCommunity);

      const result = await service.update(community.id, updateDto);

      expect(result).toEqual(updatedCommunity);
      expect(mockDatabase.community.update).toHaveBeenCalledWith({
        where: { id: community.id },
        data: updateDto,
      });
    });

    it('should mark old avatar for deletion when replaced', async () => {
      const oldAvatarId = 'old-avatar-file-id';
      const newAvatarId = 'new-avatar-file-id';
      const community = CommunityFactory.build({ avatar: oldAvatarId });
      const updateDto = { avatar: newAvatarId };

      mockDatabase.community.findUnique.mockResolvedValue(community);
      mockDatabase.file.update.mockResolvedValue({ id: oldAvatarId });
      mockDatabase.community.update.mockResolvedValue({
        ...community,
        avatar: newAvatarId,
      });

      await service.update(community.id, updateDto);

      expect(mockDatabase.file.update).toHaveBeenCalledWith({
        where: { id: oldAvatarId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should mark old banner for deletion when replaced', async () => {
      const oldBannerId = 'old-banner-file-id';
      const newBannerId = 'new-banner-file-id';
      const community = CommunityFactory.build({ banner: oldBannerId });
      const updateDto = { banner: newBannerId };

      mockDatabase.community.findUnique.mockResolvedValue(community);
      mockDatabase.file.update.mockResolvedValue({ id: oldBannerId });
      mockDatabase.community.update.mockResolvedValue({
        ...community,
        banner: newBannerId,
      });

      await service.update(community.id, updateDto);

      expect(mockDatabase.file.update).toHaveBeenCalledWith({
        where: { id: oldBannerId },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should not mark files for deletion when updating to same value', async () => {
      const avatarId = 'same-avatar-id';
      const community = CommunityFactory.build({ avatar: avatarId });
      const updateDto = { avatar: avatarId, name: 'New Name' };

      mockDatabase.community.findUnique.mockResolvedValue(community);
      mockDatabase.community.update.mockResolvedValue({
        ...community,
        ...updateDto,
      });

      await service.update(community.id, updateDto);

      expect(mockDatabase.file.update).not.toHaveBeenCalled();
    });

    it('should not mark files for deletion when community has no old files', async () => {
      const community = CommunityFactory.build({ avatar: null, banner: null });
      const updateDto = { avatar: 'new-avatar-id', banner: 'new-banner-id' };

      mockDatabase.community.findUnique.mockResolvedValue(community);
      mockDatabase.community.update.mockResolvedValue({
        ...community,
        ...updateDto,
      });

      await service.update(community.id, updateDto);

      expect(mockDatabase.file.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when community not found', async () => {
      const updateDto = { name: 'Updated Name' };
      mockDatabase.community.findUnique.mockResolvedValue(null);

      await expect(service.update('nonexistent', updateDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.update('nonexistent', updateDto)).rejects.toThrow(
        'Community not found',
      );
    });

    it('should handle both avatar and banner replacement in one update', async () => {
      const oldAvatarId = 'old-avatar';
      const oldBannerId = 'old-banner';
      const newAvatarId = 'new-avatar';
      const newBannerId = 'new-banner';
      const community = CommunityFactory.build({
        avatar: oldAvatarId,
        banner: oldBannerId,
      });
      const updateDto = { avatar: newAvatarId, banner: newBannerId };

      mockDatabase.community.findUnique.mockResolvedValue(community);
      mockDatabase.file.update.mockResolvedValue({});
      mockDatabase.community.update.mockResolvedValue({
        ...community,
        ...updateDto,
      });

      await service.update(community.id, updateDto);

      expect(mockDatabase.file.update).toHaveBeenCalledTimes(2);
      expect(mockDatabase.file.update).toHaveBeenCalledWith({
        where: { id: oldAvatarId },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockDatabase.file.update).toHaveBeenCalledWith({
        where: { id: oldBannerId },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe('addMemberToGeneralChannel', () => {
    it('should add user to general channel', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';

      channelsService.addUserToGeneralChannel.mockResolvedValue(undefined);

      await service.addMemberToGeneralChannel(communityId, userId);

      expect(channelsService.addUserToGeneralChannel).toHaveBeenCalledWith(
        communityId,
        userId,
      );
    });

    it('should swallow errors to avoid breaking membership creation', async () => {
      const communityId = 'community-123';
      const userId = 'user-456';

      channelsService.addUserToGeneralChannel.mockRejectedValue(
        new Error('Channel not found'),
      );

      // Should not throw
      await expect(
        service.addMemberToGeneralChannel(communityId, userId),
      ).resolves.toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should cascade delete community and all related records', async () => {
      const community = CommunityFactory.build();

      mockDatabase.community.findUnique.mockResolvedValue(community);
      mockDatabase.channel.findMany.mockResolvedValue([
        { id: 'ch-1' },
        { id: 'ch-2' },
      ]);
      mockDatabase.notification.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.channelNotificationOverride.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockDatabase.readReceipt.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.webhook.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.threadSubscriber.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.channelMembership.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.message.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.channel.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.communityBan.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.communityTimeout.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.moderationLog.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.aliasGroupMember.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.aliasGroup.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.role.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.userRoles.deleteMany.mockResolvedValue({ count: 0 });
      mockDatabase.membership.deleteMany.mockResolvedValue({ count: 5 });
      mockDatabase.community.delete.mockResolvedValue(community);

      await service.remove(community.id);

      expect(mockDatabase.channel.findMany).toHaveBeenCalledWith({
        where: { communityId: community.id },
        select: { id: true },
      });
      expect(mockDatabase.notification.deleteMany).toHaveBeenCalled();
      expect(
        mockDatabase.channelNotificationOverride.deleteMany,
      ).toHaveBeenCalled();
      expect(mockDatabase.readReceipt.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.webhook.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.threadSubscriber.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.channelMembership.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.message.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.channel.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.communityBan.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.communityTimeout.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.moderationLog.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.aliasGroupMember.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.aliasGroup.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.role.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.userRoles.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.membership.deleteMany).toHaveBeenCalledWith({
        where: { communityId: community.id },
      });
      expect(mockDatabase.community.delete).toHaveBeenCalledWith({
        where: { id: community.id },
      });
      // Role definitions and assignments were removed via raw
      // tx.role.deleteMany / tx.userRoles.deleteMany above, bypassing
      // CommunityRolesService — remove() must bump the community epoch explicitly.
      expect(permissionsCacheService.bumpCommunityEpoch).toHaveBeenCalledWith(
        community.id,
      );
    });

    it('should throw NotFoundException when community not found', async () => {
      mockDatabase.community.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('nonexistent')).rejects.toThrow(
        'Community not found',
      );
      expect(permissionsCacheService.bumpCommunityEpoch).not.toHaveBeenCalled();
    });
  });
});
