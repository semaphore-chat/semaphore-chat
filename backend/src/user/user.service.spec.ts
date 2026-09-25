import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { UserService } from './user.service';
import { DatabaseService } from '@/database/database.service';
import { InviteService } from '@/invite/invite.service';
import { ChannelsService } from '@/channels/channels.service';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';
import { SessionRevocationService } from '@/auth/session-revocation.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InstanceRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { instanceToPlain } from 'class-transformer';
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
  let communityRolesService: Mocked<CommunityRolesService>;
  let permissionsCacheService: Mocked<PermissionsCacheService>;
  let sessionRevocationService: Mocked<SessionRevocationService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(UserService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    inviteService = unitRef.get(InviteService);
    channelsService = unitRef.get(ChannelsService);
    communityRolesService = unitRef.get(CommunityRolesService);
    permissionsCacheService = unitRef.get(PermissionsCacheService);
    sessionRevocationService = unitRef.get(SessionRevocationService);

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

    it('should use case-insensitive matching for username', async () => {
      mockDatabase.user.findFirst.mockResolvedValue(null);

      await service.checkForFieldConflicts('Alice', undefined);

      expect(mockDatabase.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ username: { equals: 'Alice', mode: 'insensitive' } }],
        },
      });
    });

    it('should detect username conflict case-insensitively', async () => {
      const existingUser = UserFactory.build({ username: 'alice' });
      mockDatabase.user.findFirst.mockResolvedValue(existingUser);

      await expect(
        service.checkForFieldConflicts('ALICE', undefined),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.checkForFieldConflicts('ALICE', undefined),
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
        defaultCommunities: [],
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
        defaultCommunities: [],
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
        defaultCommunities: [],
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
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId: communityId1 },
        { id: 'dc-2', inviteId: invite.id, communityId: communityId2 },
      ];
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
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole as any,
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
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
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId },
      ];
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
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole as any,
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
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
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId },
      ];
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
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole as any,
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined as any,
      );

      await service.createUser('invite-code', 'user', 'password');

      expect(
        communityRolesService.assignUserToCommunityRole,
      ).toHaveBeenCalledWith(
        newUser.id,
        communityId,
        memberRole.id,
        expect.anything(),
        expect.any(Array),
      );
    });

    it('should create Member role if it does not exist', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId },
      ];
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
      communityRolesService.getCommunityMemberRole
        .mockResolvedValueOnce(null as any) // First call returns null
        .mockResolvedValueOnce(memberRole as any); // Second call returns created role
      communityRolesService.createMemberRoleForCommunity.mockResolvedValue(
        'role-id-123' as any,
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined as any,
      );

      await service.createUser('invite-code', 'user', 'password');

      expect(
        communityRolesService.createMemberRoleForCommunity,
      ).toHaveBeenCalledWith(communityId, expect.anything(), expect.any(Array));
    });

    it('should not fail user creation if general channel addition fails', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId },
      ];
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
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole as any,
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
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
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId },
      ];
      const newUser = UserFactory.build();

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockResolvedValue(
        undefined as any,
      );
      communityRolesService.getCommunityMemberRole.mockRejectedValue(
        new Error('Role error'),
      );

      const result = await service.createUser(
        'invite-code',
        'user',
        'password',
      );

      expect(result).toEqual(newUser);
    });

    it('flushes deferred epoch bumps only after the transaction commits', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId },
      ];
      const newUser = UserFactory.build();
      const memberRole = RoleFactory.buildMember();
      const order: string[] = [];

      mockDatabase.user.findFirst.mockResolvedValue(null);
      mockDatabase.user.count.mockResolvedValue(1);
      inviteService.validateInviteCode.mockResolvedValue(invite as any);
      inviteService.redeemInviteWithTx.mockResolvedValue(invite as any);
      mockDatabase.user.create.mockResolvedValue(newUser);
      channelsService.addUserToGeneralChannel.mockResolvedValue(
        undefined as any,
      );
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole as any,
      );
      // The (mocked) tx-nested role mutation records its bump on the
      // collector the service passes in, like the real implementation does.
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

      const result = await service.createUser(
        'invite-code',
        'user',
        'password',
      );

      expect(result).toEqual(newUser);
      // Bumps must flush strictly AFTER the transaction resolves (commit).
      expect(order).toEqual(['commit', 'flush-bumps']);
      expect(permissionsCacheService.executeBumps).toHaveBeenCalledWith([
        { kind: 'user', userId: newUser.id },
      ]);
      expect(permissionsCacheService.bumpUserEpoch).not.toHaveBeenCalled();
    });

    it('does not flush epoch bumps when the transaction rolls back', async () => {
      const communityId = 'community-123';
      const invite = InstanceInviteFactory.build();
      (invite as any).defaultCommunities = [
        { id: 'dc-1', inviteId: invite.id, communityId },
      ];
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
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole as any,
      );
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

      // Simulate a commit failure AFTER the callback (and its bump
      // collection) succeeded — the deferred bumps must never execute.
      mockDatabase.$transaction.mockImplementation(async (cb: any) => {
        await cb(mockDatabase);
        throw new Error('commit failed');
      });

      await expect(
        service.createUser('invite-code', 'user', 'password'),
      ).rejects.toThrow('commit failed');

      expect(permissionsCacheService.executeBumps).not.toHaveBeenCalled();
      expect(permissionsCacheService.bumpUserEpoch).not.toHaveBeenCalled();
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
        data: { avatarFile: { connect: { id: avatarFileId } } },
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
        data: { bannerFile: { connect: { id: bannerFileId } } },
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
          avatarFile: { connect: { id: 'avatar-123' } },
          bannerFile: { connect: { id: 'banner-456' } },
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

  describe('setUserPassword', () => {
    it('should hash the new password and update the user', async () => {
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.update.mockResolvedValue({
        ...target,
        hashedPassword: 'hashed-password',
      });
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.setUserPassword(
        target.id,
        'new-password-123',
        'acting-admin-id',
      );

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password-123', 10);
      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: target.id },
        data: { hashedPassword: 'hashed-password' },
      });
      expect(result.id).toBe(target.id);
    });

    it('should revoke all refresh tokens for the user', async () => {
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.update.mockResolvedValue(target);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      await service.setUserPassword(target.id, 'new-password-123', 'admin-id');

      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: target.id },
      });
    });

    it('should lock the user against refreshes before deleting the refresh tokens', async () => {
      // A refresh racing the reset either finds its token gone, or commits
      // first and the delete (a later statement) sees its new token
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.update.mockResolvedValue(target);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.setUserPassword(target.id, 'new-password-123', 'admin-id');

      const [strings, userId] = mockDatabase.$queryRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toMatch(/FOR NO KEY UPDATE/);
      expect(userId).toBe(target.id);
      expect(mockDatabase.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockDatabase.refreshToken.deleteMany.mock.invocationCallOrder[0],
      );
    });

    it('should revoke the access tokens and disconnect the sockets after the update', async () => {
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.update.mockResolvedValue(target);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.setUserPassword(target.id, 'new-password-123', 'admin-id');

      expect(
        sessionRevocationService.revokeAllUserSessions,
      ).toHaveBeenCalledWith(target.id, 'PASSWORD_CHANGED');
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);

      await expect(
        service.setUserPassword('missing-id', 'new-password-123', 'admin-id'),
      ).rejects.toThrow(NotFoundException);
      expect(mockDatabase.user.update).not.toHaveBeenCalled();
    });

    it('should forbid a non-owner from resetting an owner password', async () => {
      const ownerTarget = UserFactory.buildOwner();
      const actingAdmin = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique
        .mockResolvedValueOnce(ownerTarget)
        .mockResolvedValueOnce(actingAdmin);

      await expect(
        service.setUserPassword(
          ownerTarget.id,
          'new-password-123',
          actingAdmin.id,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockDatabase.user.update).not.toHaveBeenCalled();
      expect(mockDatabase.refreshToken.deleteMany).not.toHaveBeenCalled();
      expect(
        sessionRevocationService.revokeAllUserSessions,
      ).not.toHaveBeenCalled();
    });

    it('should allow an owner to reset another owner password', async () => {
      const ownerTarget = UserFactory.buildOwner({ id: 'owner-target' });
      const actingOwner = UserFactory.buildOwner({ id: 'owner-acting' });
      mockDatabase.user.findUnique
        .mockResolvedValueOnce(ownerTarget)
        .mockResolvedValueOnce(actingOwner);
      mockDatabase.user.update.mockResolvedValue(ownerTarget);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.setUserPassword(
        ownerTarget.id,
        'new-password-123',
        actingOwner.id,
      );

      expect(mockDatabase.user.update).toHaveBeenCalled();
    });

    it('should allow an owner to reset their own password', async () => {
      const owner = UserFactory.buildOwner();
      mockDatabase.user.findUnique.mockResolvedValue(owner);
      mockDatabase.user.update.mockResolvedValue(owner);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.setUserPassword(owner.id, 'new-password-123', owner.id);

      // Self-reset skips the acting-user role lookup
      expect(mockDatabase.user.findUnique).toHaveBeenCalledTimes(1);
      expect(mockDatabase.user.update).toHaveBeenCalled();
    });

    it('should not leak the password hash in the response', async () => {
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.update.mockResolvedValue({
        ...target,
        hashedPassword: 'hashed-password',
      });
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.setUserPassword(
        target.id,
        'new-password-123',
        'admin-id',
      );

      // hashedPassword is @Exclude()d by AdminUserEntity on serialization
      // (AdminUserEntity intentionally exposes email to admins, so the
      // stricter expectNoSensitiveUserFields helper doesn't apply here)
      expect(instanceToPlain(result)).not.toHaveProperty('hashedPassword');
    });
  });

  describe('setBanStatus', () => {
    it("should end the user's live sockets when banning", async () => {
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.update.mockResolvedValue({ ...target, banned: true });

      await service.setBanStatus(target.id, true, 'admin-id');

      expect(mockDatabase.user.update).toHaveBeenCalledWith({
        where: { id: target.id },
        data: expect.objectContaining({ banned: true }),
      });
      expect(sessionRevocationService.endAllUserSockets).toHaveBeenCalledWith(
        target.id,
        'ACCOUNT_BANNED',
      );
    });

    it('should not touch sockets when unbanning', async () => {
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.update.mockResolvedValue(target);

      await service.setBanStatus(target.id, false, 'admin-id');

      expect(sessionRevocationService.endAllUserSockets).not.toHaveBeenCalled();
    });

    it('should not end sockets when the ban is refused', async () => {
      const owner = UserFactory.buildOwner();
      mockDatabase.user.findUnique.mockResolvedValue(owner);

      await expect(
        service.setBanStatus(owner.id, true, 'admin-id'),
      ).rejects.toThrow(ForbiddenException);
      expect(sessionRevocationService.endAllUserSockets).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it("should end the deleted user's live sockets", async () => {
      const target = UserFactory.build({ role: InstanceRole.USER });
      mockDatabase.user.findUnique.mockResolvedValue(target);
      mockDatabase.user.delete.mockResolvedValue(target);

      await service.deleteUser(target.id, 'admin-id');

      expect(mockDatabase.user.delete).toHaveBeenCalledWith({
        where: { id: target.id },
      });
      expect(sessionRevocationService.endAllUserSockets).toHaveBeenCalledWith(
        target.id,
        'ACCOUNT_DELETED',
      );
    });
  });
});
