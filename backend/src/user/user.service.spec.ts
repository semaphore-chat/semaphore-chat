import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { UserService } from './user.service';
import { DatabaseService } from '@/database/database.service';
import { InviteService } from '@/invite/invite.service';
import { ChannelsService } from '@/channels/channels.service';
import { RolesService } from '@/roles/roles.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InstanceRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  createMockDatabase,
  UserFactory,
  InstanceInviteFactory,
  RoleFactory,
} from '@/test-utils';

jest.mock('bcrypt');

describe('UserService', () => {
  let service: UserService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let inviteService: Mocked<InviteService>;
  let channelsService: Mocked<ChannelsService>;
  let rolesService: Mocked<RolesService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(UserService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    inviteService = unitRef.get(InviteService);
    channelsService = unitRef.get(ChannelsService);
    rolesService = unitRef.get(RolesService);

    // Mock bcrypt
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByUsername', () => {
    it('should find user by username', async () => {
      const user = UserFactory.build({ username: 'testuser' });
      mockDatabase.user.findUnique.mockResolvedValue(user);

      const result = await service.findByUsername('testuser');

      expect(result).toEqual(user);
      expect(mockDatabase.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'testuser' },
      });
    });

    it('should return null when user not found', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);

      const result = await service.findByUsername('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      const user = UserFactory.build();
      mockDatabase.user.findUnique.mockResolvedValue(user);

      const result = await service.findById(user.id);

      expect(result).toEqual(user);
      expect(mockDatabase.user.findUnique).toHaveBeenCalledWith({
        where: { id: user.id },
      });
    });

    it('should return null when user not found', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('checkForFieldConflicts', () => {
    it('should not throw when no conflicts exist', async () => {
      mockDatabase.user.findFirst.mockResolvedValue(null);

      await expect(
        service.checkForFieldConflicts('newuser', 'new@example.com'),
      ).resolves.not.toThrow();
    });

    it('should throw ConflictException when username exists', async () => {
      const existingUser = UserFactory.build({ username: 'existinguser' });
      mockDatabase.user.findFirst.mockResolvedValue(existingUser);

      await expect(
        service.checkForFieldConflicts('existinguser', 'new@example.com'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.checkForFieldConflicts('existinguser', 'new@example.com'),
      ).rejects.toThrow('A user with this username already exists.');
    });

    it('should throw ConflictException when email exists', async () => {
      const existingUser = UserFactory.build({
        username: 'different',
        email: 'existing@example.com',
      });
      mockDatabase.user.findFirst.mockResolvedValue(existingUser);

      await expect(
        service.checkForFieldConflicts('newuser', 'existing@example.com'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.checkForFieldConflicts('newuser', 'existing@example.com'),
      ).rejects.toThrow('A user with this email already exists.');
    });
  });

  describe('getInvite', () => {
    it('should validate and return invite code', async () => {
      const invite = InstanceInviteFactory.build();
      inviteService.validateInviteCode.mockResolvedValue(invite as any);

      const result = await service.getInvite(invite.code);

      expect(result).toEqual(invite);
      expect(inviteService.validateInviteCode).toHaveBeenCalledWith(
        invite.code,
      );
    });

    it('should return null for invalid invite', async () => {
      inviteService.validateInviteCode.mockResolvedValue(null as any);

      const result = await service.getInvite('invalid-code');

      expect(result).toBeNull();
    });
  });

  describe('createUser', () => {
    it('should create first user as OWNER', async () => {
      const invite = InstanceInviteFactory.build();
      const newUser = UserFactory.build({
        username: 'firstowner',
        role: InstanceRole.OWNER,
        verified: true,
      });

      mockDatabase.user.findFirst.mockResolvedValue(null); // No conflicts
      mockDatabase.user.count.mockResolvedValue(0); // First user
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue({
        ...invite,
        defaultCommunityId: [],
      } as any);
      mockDatabase.user.create.mockResolvedValue(newUser);

      const result = await service.createUser(
        'invite-code',
        'FirstOwner',
        'password123',
      );

      expect(result).toEqual(newUser);

      expect(mockDatabase.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'firstowner',
          displayName: 'firstowner',
          role: InstanceRole.OWNER,
          verified: true,
          hashedPassword: 'hashed-password',
        }),
      });
    });

    it('should create subsequent users as USER', async () => {
      const invite = InstanceInviteFactory.build();
      const newUser = UserFactory.build({
        username: 'regularuser',
        role: InstanceRole.USER,
        verified: false,
      });

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(5); // Existing users
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue({
        ...invite,
        defaultCommunityId: [],
      } as any);
      mockDatabase.user.create.mockResolvedValue(newUser);

      const result = await service.createUser(
        'invite-code',
        'RegularUser',
        'password123',
      );

      expect(result.role).toBe(InstanceRole.USER);
      expect(result.verified).toBe(false);
    });

    it('should hash password with bcrypt', async () => {
      const invite = InstanceInviteFactory.build();
      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(0);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue({
        ...invite,
        defaultCommunityId: [],
      } as any);
      mockDatabase.user.create.mockResolvedValue(UserFactory.build());

      await service.createUser('invite-code', 'user', 'mypassword');

      expect(bcrypt.hash).toHaveBeenCalledWith('mypassword', 10);
    });

    it('should throw NotFoundException when invite not found', async () => {
      mockDatabase.user.findFirst.mockResolvedValue(null);
      inviteService.validateInviteCode.mockResolvedValue(null as any);

      await expect(
        service.createUser('invalid-code', 'user', 'password'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.createUser('invalid-code', 'user', 'password'),
      ).rejects.toThrow('No invite found for the provided code.');
    });

    it('should add user to default communities', async () => {
      const communityId1 = 'community-1';
      const communityId2 = 'community-2';
      const invite = InstanceInviteFactory.build({
        defaultCommunityId: [communityId1, communityId2],
      });
      const newUser = UserFactory.build();
      const memberRole = RoleFactory.buildMember();

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockResolvedValue(
        undefined as any,
      );
      rolesService.getCommunityMemberRole.mockResolvedValue(memberRole as any);
      rolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined as any,
      );

      await service.createUser('invite-code', 'user', 'password');

      expect(mockDatabase.membership.createMany).toHaveBeenCalledWith({
        data: [
          { userId: newUser.id, communityId: communityId1 },
          { userId: newUser.id, communityId: communityId2 },
        ],
      });
    });

    it('should add user to general channel in default communities', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build({
        defaultCommunityId: [communityId],
      });
      const newUser = UserFactory.build();
      const memberRole = RoleFactory.buildMember();

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockResolvedValue(
        undefined as any,
      );
      rolesService.getCommunityMemberRole.mockResolvedValue(memberRole as any);
      rolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined as any,
      );

      await service.createUser('invite-code', 'user', 'password');

      expect(channelsService.addUserToGeneralChannel).toHaveBeenCalledWith(
        communityId,
        newUser.id,
      );
    });

    it('should assign Member role to user in default communities', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build({
        defaultCommunityId: [communityId],
      });
      const newUser = UserFactory.build();
      const memberRole = RoleFactory.buildMember();

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockResolvedValue(
        undefined as any,
      );
      rolesService.getCommunityMemberRole.mockResolvedValue(memberRole as any);
      rolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined as any,
      );

      await service.createUser('invite-code', 'user', 'password');

      expect(rolesService.assignUserToCommunityRole).toHaveBeenCalledWith(
        newUser.id,
        communityId,
        memberRole.id,
        expect.anything(),
      );
    });

    it('should create Member role if it does not exist', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build({
        defaultCommunityId: [communityId],
      });
      const newUser = UserFactory.build();
      const memberRole = RoleFactory.buildMember();

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockResolvedValue(
        undefined as any,
      );
      rolesService.getCommunityMemberRole
        .mockResolvedValueOnce(null as any) // First call returns null
        .mockResolvedValueOnce(memberRole as any); // Second call returns created role
      rolesService.createMemberRoleForCommunity.mockResolvedValue(
        'role-id-123' as any,
      );
      rolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined as any,
      );

      await service.createUser('invite-code', 'user', 'password');

      expect(rolesService.createMemberRoleForCommunity).toHaveBeenCalledWith(
        communityId,
        expect.anything(),
      );
    });

    it('should not fail user creation if general channel addition fails', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build({
        defaultCommunityId: [communityId],
      });
      const newUser = UserFactory.build();
      const memberRole = RoleFactory.buildMember();

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockRejectedValue(
        new Error('Channel error'),
      );
      rolesService.getCommunityMemberRole.mockResolvedValue(memberRole as any);
      rolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined as any,
      );

      const result = await service.createUser(
        'invite-code',
        'user',
        'password',
      );

      expect(result).toEqual(newUser);
    });

    it('should not fail user creation if role assignment fails', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build({
        defaultCommunityId: [communityId],
      });
      const newUser = UserFactory.build();

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockResolvedValue(
        undefined as any,
      );
      rolesService.getCommunityMemberRole.mockRejectedValue(
        new Error('Role error'),
      );

      const result = await service.createUser(
        'invite-code',
        'user',
        'password',
      );

      expect(result).toEqual(newUser);
    });
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const users = UserFactory.buildMany(3);
      mockDatabase.user.findMany.mockResolvedValue(users);

      const result = await service.findAll(50);

      expect(result.users).toHaveLength(3);
      expect(mockDatabase.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          select: expect.objectContaining({ id: true, username: true }),
          take: 50,
          orderBy: { username: 'asc' },
        }),
      );
    });

    it('should return continuation token when limit reached', async () => {
      const users = UserFactory.buildMany(50);
      mockDatabase.user.findMany.mockResolvedValue(users);

      const result = await service.findAll(50);

      expect(result.continuationToken).toBe(users[49].id);
    });

    it('should not return continuation token when fewer than limit', async () => {
      const users = UserFactory.buildMany(10);
      mockDatabase.user.findMany.mockResolvedValue(users);

      const result = await service.findAll(50);

      expect(result.continuationToken).toBeUndefined();
    });

    it('should use continuation token for pagination', async () => {
      const users = UserFactory.buildMany(10);
      const token = 'cursor-token-123';
      mockDatabase.user.findMany.mockResolvedValue(users);

      await service.findAll(50, token);

      expect(mockDatabase.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          select: expect.objectContaining({ id: true, username: true }),
          take: 50,
          orderBy: { username: 'asc' },
          cursor: { id: token },
          skip: 1,
        }),
      );
    });
  });

  describe('searchUsers', () => {
    it('should search users by username', async () => {
      const users = UserFactory.buildMany(3, { username: 'testuser' });
      mockDatabase.user.findMany.mockResolvedValue(users);

      const result = await service.searchUsers('test');

      expect(result).toHaveLength(3);
      expect(mockDatabase.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { username: { contains: 'test', mode: 'insensitive' } },
              { displayName: { contains: 'test', mode: 'insensitive' } },
            ],
          },
          select: expect.objectContaining({ id: true, username: true }),
          take: 50,
          orderBy: { username: 'asc' },
        }),
      );
    });

    it('should filter out existing community members', async () => {
      const users = UserFactory.buildMany(2);
      const communityId = 'community-123';
      mockDatabase.user.findMany.mockResolvedValue(users);

      await service.searchUsers('test', communityId);

      expect(mockDatabase.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { username: { contains: 'test', mode: 'insensitive' } },
              { displayName: { contains: 'test', mode: 'insensitive' } },
            ],
            NOT: {
              memberships: {
                some: {
                  communityId: communityId,
                },
              },
            },
          },
          select: expect.objectContaining({ id: true, username: true }),
          take: 50,
          orderBy: { username: 'asc' },
        }),
      );
    });

    it('should respect custom limit', async () => {
      const users = UserFactory.buildMany(10);
      mockDatabase.user.findMany.mockResolvedValue(users);

      await service.searchUsers('test', undefined, 10);

      expect(mockDatabase.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
        }),
      );
    });
  });

  describe('updateProfile', () => {
    it('should update user display name', async () => {
      const user = UserFactory.build();
      const updatedUser = { ...user, displayName: 'New Display Name' };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(user.id, {
        displayName: '  New Display Name  ',
      });

      expect(result.displayName).toBe('New Display Name');
      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { displayName: 'New Display Name' },
      });
    });

    it('should update user avatar', async () => {
      const user = UserFactory.build();
      const avatarFileId = 'avatar-file-123';
      const updatedUser = { ...user, avatarUrl: avatarFileId };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(user.id, {
        avatar: avatarFileId,
      });

      expect(result.avatarUrl).toBe(avatarFileId);
      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { avatarUrl: avatarFileId },
      });
    });

    it('should update user banner', async () => {
      const user = UserFactory.build();
      const bannerFileId = 'banner-file-456';
      const updatedUser = { ...user, bannerUrl: bannerFileId };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(user.id, {
        banner: bannerFileId,
      });

      expect(result.bannerUrl).toBe(bannerFileId);
      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { bannerUrl: bannerFileId },
      });
    });

    it('should update multiple profile fields at once', async () => {
      const user = UserFactory.build();
      const updatedUser = {
        ...user,
        displayName: 'New Name',
        avatarUrl: 'avatar-123',
        bannerUrl: 'banner-456',
      };

      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.user.update.mockResolvedValue(updatedUser);

      await service.updateProfile(user.id, {
        displayName: 'New Name',
        avatar: 'avatar-123',
        banner: 'banner-456',
      });

      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: {
          displayName: 'New Name',
          avatarUrl: 'avatar-123',
          bannerUrl: 'banner-456',
        },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile('nonexistent-id', { displayName: 'Test' }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateProfile('nonexistent-id', { displayName: 'Test' }),
      ).rejects.toThrow('User not found');
    });

    it('should trim whitespace from display name', async () => {
      const user = UserFactory.build();
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.user.update.mockResolvedValue({
        ...user,
        displayName: 'Trimmed',
      });

      await service.updateProfile(user.id, { displayName: '   Trimmed   ' });

      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { displayName: 'Trimmed' },
      });
    });
  });
});
