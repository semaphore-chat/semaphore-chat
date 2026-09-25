import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MembershipService } from './membership.service';
import { DatabaseService } from '@/database/database.service';
import { CommunityService } from '@/community/community.service';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';

import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  createMockDatabase,
  UserFactory,
  CommunityFactory,
  MembershipFactory,
  RoleFactory,
  expectNoSensitiveUserFields,
} from '@/test-utils';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import { RoomEvents } from '@/rooms/room-subscription.events';

describe('MembershipService', () => {
  let service: MembershipService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let communityService: Mocked<CommunityService>;
  let communityRolesService: Mocked<CommunityRolesService>;
  let eventEmitter: Mocked<EventEmitter2>;
  let permissionsCacheService: Mocked<PermissionsCacheService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(MembershipService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    communityService = unitRef.get(CommunityService);
    communityRolesService = unitRef.get(CommunityRolesService);
    eventEmitter = unitRef.get(EventEmitter2);
    permissionsCacheService = unitRef.get(PermissionsCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create membership and add user to general channel and assign role', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const memberRole = RoleFactory.build({ name: 'Member' });

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);
      mockDatabase.membership.create.mockResolvedValue(membership);
      mockDatabase.channel.findMany.mockResolvedValue([]);
      communityService.addMemberToGeneralChannel.mockResolvedValue(undefined);
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole,
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined,
      );

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      // Existence check must not fetch sensitive user fields at query level
      expect(mockDatabase.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: user.id },
        select: { id: true },
      });
      expect(mockDatabase.membership.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          communityId: community.id,
        },
      });
      expect(communityService.addMemberToGeneralChannel).toHaveBeenCalledWith(
        community.id,
        user.id,
      );
      expect(communityRolesService.getCommunityMemberRole).toHaveBeenCalledWith(
        community.id,
      );
      expect(
        communityRolesService.assignUserToCommunityRole,
      ).toHaveBeenCalledWith(user.id, community.id, memberRole.id);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.MEMBERSHIP_CREATED,
        { userId: user.id, communityId: community.id },
      );
    });

    it('should throw ConflictException when membership already exists', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };
      const existingMembership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(existingMembership);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'User is already a member of this community',
      );
    });

    it('should throw NotFoundException when community not found', async () => {
      const user = UserFactory.build();
      const createDto = {
        userId: user.id,
        communityId: 'non-existent-community',
      };

      mockDatabase.community.findUniqueOrThrow.mockRejectedValue(
        new Error('Not found'),
      );

      await expect(service.create(createDto)).rejects.toThrow();
    });

    it('should throw NotFoundException when user not found', async () => {
      const community = CommunityFactory.build();
      const createDto = {
        userId: 'non-existent-user',
        communityId: community.id,
      };

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockRejectedValue(
        new Error('Not found'),
      );

      await expect(service.create(createDto)).rejects.toThrow();
    });

    it('should create membership even if adding to general channel fails', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const memberRole = RoleFactory.build({ name: 'Member' });

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);
      mockDatabase.membership.create.mockResolvedValue(membership);
      mockDatabase.channel.findMany.mockResolvedValue([]);
      communityService.addMemberToGeneralChannel.mockRejectedValue(
        new Error('Channel not found'),
      );
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole,
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined,
      );

      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation();

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to add user'),
        expect.any(Error),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should create Member role if it does not exist', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const memberRole = RoleFactory.build({ name: 'Member' });

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);
      mockDatabase.membership.create.mockResolvedValue(membership);
      mockDatabase.channel.findMany.mockResolvedValue([]);
      communityService.addMemberToGeneralChannel.mockResolvedValue(undefined);
      communityRolesService.getCommunityMemberRole
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(memberRole);
      communityRolesService.createMemberRoleForCommunity.mockResolvedValue(
        'member-role-id',
      );
      communityRolesService.assignUserToCommunityRole.mockResolvedValue(
        undefined,
      );

      const loggerLogSpy = jest
        .spyOn(service['logger'], 'log')
        .mockImplementation();

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(
        communityRolesService.createMemberRoleForCommunity,
      ).toHaveBeenCalledWith(community.id);
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Member role not found'),
      );

      loggerLogSpy.mockRestore();
    });

    it('should handle error when Member role creation fails', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);
      mockDatabase.membership.create.mockResolvedValue(membership);
      mockDatabase.channel.findMany.mockResolvedValue([]);
      communityService.addMemberToGeneralChannel.mockResolvedValue(undefined);
      communityRolesService.getCommunityMemberRole.mockResolvedValue(null);
      communityRolesService.createMemberRoleForCommunity.mockResolvedValue(
        'member-role-id',
      );

      const loggerErrorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create or find member role'),
      );

      loggerErrorSpy.mockRestore();
    });

    it('should create membership even if role assignment fails', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });
      const memberRole = RoleFactory.build({ name: 'Member' });

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);
      mockDatabase.membership.create.mockResolvedValue(membership);
      mockDatabase.channel.findMany.mockResolvedValue([]);
      communityService.addMemberToGeneralChannel.mockResolvedValue(undefined);
      communityRolesService.getCommunityMemberRole.mockResolvedValue(
        memberRole,
      );
      communityRolesService.assignUserToCommunityRole.mockRejectedValue(
        new Error('Role assignment failed'),
      );

      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation();

      const result = await service.create(createDto);

      expect(result).toBeDefined();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to assign default member role'),
        expect.any(Error),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should handle P2002 (duplicate) error', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);
      mockDatabase.membership.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'User is already a member of this community',
      );
    });

    it('should handle P2025 (not found) error', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const createDto = { userId: user.id, communityId: community.id };

      mockDatabase.community.findUniqueOrThrow.mockResolvedValue(community);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);
      mockDatabase.membership.findUnique.mockResolvedValue(null);
      mockDatabase.membership.create.mockRejectedValue({ code: 'P2025' });

      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'User or community not found',
      );
    });
  });

  describe('findAllForCommunity', () => {
    it('should return all memberships for a community with user info and roles', async () => {
      const community = CommunityFactory.build();
      const user1 = UserFactory.build();
      const user2 = UserFactory.build();
      const memberships = [
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: user1.id,
          }),
          user: user1,
        },
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: user2.id,
          }),
          user: user2,
        },
      ];

      const adminRole = RoleFactory.buildAdmin({
        communityId: community.id,
        position: 10,
      });
      const memberRole = RoleFactory.buildMember({
        communityId: community.id,
        position: 100,
      });

      mockDatabase.membership.findMany.mockResolvedValue(memberships);
      mockDatabase.userRoles.findMany.mockResolvedValue([
        {
          userId: user1.id,
          communityId: community.id,
          roleId: adminRole.id,
          isInstanceRole: false,
          role: adminRole,
        },
        {
          userId: user2.id,
          communityId: community.id,
          roleId: memberRole.id,
          isInstanceRole: false,
          role: memberRole,
        },
      ]);

      const result = await service.findAllForCommunity(community.id);

      expect(result).toBeDefined();
      expect(result.members).toHaveLength(2);
      expect(result.continuationToken).toBeUndefined();

      // User1 should have admin role
      const user1Membership = result.members.find((m) => m.userId === user1.id);
      expect(user1Membership?.roles).toHaveLength(1);
      expect(user1Membership?.roles?.[0].name).toBe('Admin');
      expect(user1Membership?.roles?.[0].position).toBe(10);

      // User2 should have member role
      const user2Membership = result.members.find((m) => m.userId === user2.id);
      expect(user2Membership?.roles).toHaveLength(1);
      expect(user2Membership?.roles?.[0].name).toBe('Member');
      expect(user2Membership?.roles?.[0].position).toBe(100);

      expect(mockDatabase.membership.findMany).toHaveBeenCalledWith({
        where: { communityId: community.id },
        include: {
          user: { select: PUBLIC_USER_SELECT },
        },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });

      expect(mockDatabase.userRoles.findMany).toHaveBeenCalledWith({
        where: {
          communityId: community.id,
          userId: { in: [user1.id, user2.id] },
        },
        include: { role: true },
      });
    });

    it('should return empty members array when no memberships exist', async () => {
      const community = CommunityFactory.build();
      mockDatabase.membership.findMany.mockResolvedValue([]);
      mockDatabase.userRoles.findMany.mockResolvedValue([]);

      const result = await service.findAllForCommunity(community.id);

      expect(result).toEqual({ members: [], continuationToken: undefined });
    });

    it('should return memberships without roles when no user roles exist', async () => {
      const community = CommunityFactory.build();
      const user1 = UserFactory.build();
      const memberships = [
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: user1.id,
          }),
          user: user1,
        },
      ];

      mockDatabase.membership.findMany.mockResolvedValue(memberships);
      mockDatabase.userRoles.findMany.mockResolvedValue([]);

      const result = await service.findAllForCommunity(community.id);

      expect(result.members).toHaveLength(1);
      expect(result.members[0].roles).toBeUndefined();
    });

    it('should rethrow errors', async () => {
      const community = CommunityFactory.build();
      mockDatabase.membership.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(service.findAllForCommunity(community.id)).rejects.toThrow(
        'Database error',
      );
    });

    it('should not leak sensitive user fields even when the query returns a full user row', async () => {
      const community = CommunityFactory.build();
      const fullUser = UserFactory.buildComplete({ username: 'alice' });
      const memberships = [
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: fullUser.id,
          }),
          user: fullUser,
        },
      ];

      mockDatabase.membership.findMany.mockResolvedValue(memberships);
      mockDatabase.userRoles.findMany.mockResolvedValue([]);

      const result = await service.findAllForCommunity(community.id);

      expect(result.members[0].user).toBeDefined();
      expectNoSensitiveUserFields(result.members[0].user!);
    });

    it('should cap the requested limit passed through to Prisma', async () => {
      const community = CommunityFactory.build();
      mockDatabase.membership.findMany.mockResolvedValue([]);
      mockDatabase.userRoles.findMany.mockResolvedValue([]);

      await service.findAllForCommunity(community.id, 50);

      expect(mockDatabase.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should paginate with a continuationToken (cursor round-trip, no overlap between pages)', async () => {
      const community = CommunityFactory.build();
      // 3 members with page size 2: page1 full (token emitted), page2
      // partial (no token) — exercises both the "more pages" and
      // "reached the end" branches of the nextToken computation.
      const users = Array.from({ length: 3 }, () => UserFactory.build());
      const memberships = users.map((user, index) => ({
        ...MembershipFactory.build({
          communityId: community.id,
          userId: user.id,
          id: `membership-${index}`,
        }),
        user,
      }));

      // Page 1: first 2 memberships, full page -> continuationToken set
      mockDatabase.membership.findMany.mockResolvedValueOnce(
        memberships.slice(0, 2),
      );
      mockDatabase.userRoles.findMany.mockResolvedValue([]);

      const page1 = await service.findAllForCommunity(community.id, 2);

      expect(page1.members).toHaveLength(2);
      expect(page1.continuationToken).toBe('membership-1');
      expect(mockDatabase.membership.findMany).toHaveBeenLastCalledWith({
        where: { communityId: community.id },
        include: { user: { select: PUBLIC_USER_SELECT } },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        take: 2,
      });

      // Page 2: final membership only, partial page -> no continuationToken
      mockDatabase.membership.findMany.mockResolvedValueOnce(
        memberships.slice(2, 3),
      );

      const page2 = await service.findAllForCommunity(
        community.id,
        2,
        page1.continuationToken,
      );

      expect(page2.members).toHaveLength(1);
      expect(page2.continuationToken).toBeUndefined();
      expect(mockDatabase.membership.findMany).toHaveBeenLastCalledWith({
        where: { communityId: community.id },
        include: { user: { select: PUBLIC_USER_SELECT } },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        take: 2,
        cursor: { id: 'membership-1' },
        skip: 1,
      });

      // No overlap and no gaps across the two pages
      const page1Ids = page1.members.map((m) => m.userId);
      const page2Ids = page2.members.map((m) => m.userId);
      expect(page1Ids).toEqual(users.slice(0, 2).map((u) => u.id));
      expect(page2Ids).toEqual(users.slice(2, 3).map((u) => u.id));
      expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
    });
  });

  describe('findAllForUser', () => {
    it('should return all memberships for a user with community info', async () => {
      const user = UserFactory.build();
      const community1 = CommunityFactory.build();
      const community2 = CommunityFactory.build();
      const memberships = [
        {
          ...MembershipFactory.build({
            userId: user.id,
            communityId: community1.id,
          }),
          community: community1,
        },
        {
          ...MembershipFactory.build({
            userId: user.id,
            communityId: community2.id,
          }),
          community: community2,
        },
      ];

      mockDatabase.membership.findMany.mockResolvedValue(memberships);

      const result = await service.findAllForUser(user.id);

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(mockDatabase.membership.findMany).toHaveBeenCalledWith({
        where: { userId: user.id },
        include: {
          community: {
            select: {
              id: true,
              name: true,
              description: true,
              avatar: true,
            },
          },
        },
      });
    });

    it('should return empty array when no memberships exist', async () => {
      const user = UserFactory.build();
      mockDatabase.membership.findMany.mockResolvedValue([]);

      const result = await service.findAllForUser(user.id);

      expect(result).toEqual([]);
    });

    it('should rethrow errors', async () => {
      const user = UserFactory.build();
      mockDatabase.membership.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(service.findAllForUser(user.id)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('findOne', () => {
    it('should return a specific membership', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });

      mockDatabase.membership.findUnique.mockResolvedValue(membership);

      const result = await service.findOne(user.id, community.id);

      expect(result).toBeDefined();
      expect(mockDatabase.membership.findUnique).toHaveBeenCalledWith({
        where: {
          userId_communityId: {
            userId: user.id,
            communityId: community.id,
          },
        },
      });
    });

    it('should throw NotFoundException when membership not found', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();

      mockDatabase.membership.findUnique.mockResolvedValue(null);

      await expect(service.findOne(user.id, community.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(user.id, community.id)).rejects.toThrow(
        'Membership not found',
      );
    });
  });

  describe('remove', () => {
    it('should remove membership and all related data in transaction', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });

      mockDatabase.membership.findUniqueOrThrow.mockResolvedValue(membership);

      const mockTx = {
        channelMembership: {
          deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
        },
        userRoles: {
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
        membership: {
          delete: jest.fn().mockResolvedValue(membership),
        },
      };

      // eslint-disable-next-line @typescript-eslint/require-await
      mockDatabase.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      await service.remove(user.id, community.id);

      expect(mockTx.channelMembership.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: user.id,
          channel: {
            communityId: community.id,
          },
        },
      });
      expect(mockTx.userRoles.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: user.id,
          communityId: community.id,
        },
      });
      expect(mockTx.membership.delete).toHaveBeenCalledWith({
        where: {
          userId_communityId: {
            userId: user.id,
            communityId: community.id,
          },
        },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        RoomEvents.MEMBERSHIP_REMOVED,
        { userId: user.id, communityId: community.id },
      );
      // Role assignments were removed via the raw tx.userRoles.deleteMany
      // above, which bypasses CommunityRolesService — remove() must bump explicitly.
      expect(permissionsCacheService.bumpUserEpoch).toHaveBeenCalledWith(
        user.id,
      );
    });

    it('should throw NotFoundException when membership not found', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();

      mockDatabase.membership.findUniqueOrThrow.mockRejectedValue(
        new Error('Not found'),
      );

      await expect(service.remove(user.id, community.id)).rejects.toThrow();
    });

    it('should handle P2025 error from transaction', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });

      mockDatabase.membership.findUniqueOrThrow.mockResolvedValue(membership);
      mockDatabase.$transaction.mockRejectedValue({ code: 'P2025' });

      await expect(service.remove(user.id, community.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove(user.id, community.id)).rejects.toThrow(
        'Membership not found',
      );
    });

    it('should log successful removal', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });

      mockDatabase.membership.findUniqueOrThrow.mockResolvedValue(membership);

      const mockTx = {
        channelMembership: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        userRoles: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        membership: {
          delete: jest.fn().mockResolvedValue(membership),
        },
      };

      // eslint-disable-next-line @typescript-eslint/require-await
      mockDatabase.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx);
      });

      const loggerLogSpy = jest
        .spyOn(service['logger'], 'log')
        .mockImplementation();

      await service.remove(user.id, community.id);

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Removed user ${user.id}`),
      );

      loggerLogSpy.mockRestore();
    });
  });

  describe('isMember', () => {
    it('should return true when user is a member', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();
      const membership = MembershipFactory.build({
        userId: user.id,
        communityId: community.id,
      });

      mockDatabase.membership.findUnique.mockResolvedValue(membership);

      const result = await service.isMember(user.id, community.id);

      expect(result).toBe(true);
    });

    it('should return false when user is not a member', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();

      mockDatabase.membership.findUnique.mockResolvedValue(null);

      const result = await service.isMember(user.id, community.id);

      expect(result).toBe(false);
    });

    it('should propagate database errors', async () => {
      const user = UserFactory.build();
      const community = CommunityFactory.build();

      mockDatabase.membership.findUnique.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(service.isMember(user.id, community.id)).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('searchMembers', () => {
    it('should search members by username with default limit', async () => {
      const community = CommunityFactory.build();
      const user1 = UserFactory.build({ username: 'alice' });
      const user2 = UserFactory.build({ username: 'alex' });
      const memberships = [
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: user1.id,
          }),
          user: user1,
        },
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: user2.id,
          }),
          user: user2,
        },
      ];

      mockDatabase.membership.findMany.mockResolvedValue(memberships);

      const result = await service.searchMembers(community.id, 'al');

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(mockDatabase.membership.findMany).toHaveBeenCalledWith({
        where: {
          communityId: community.id,
          user: {
            OR: [
              {
                username: {
                  contains: 'al',
                  mode: 'insensitive',
                },
              },
              {
                displayName: {
                  contains: 'al',
                  mode: 'insensitive',
                },
              },
            ],
          },
        },
        include: {
          user: { select: PUBLIC_USER_SELECT },
        },
        take: 10,
        orderBy: {
          user: {
            username: 'asc',
          },
        },
      });
    });

    it('should not leak sensitive user fields even when the query returns a full user row', async () => {
      const community = CommunityFactory.build();
      const fullUser = UserFactory.buildComplete({ username: 'alice' });
      const memberships = [
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: fullUser.id,
          }),
          user: fullUser,
        },
      ];

      mockDatabase.membership.findMany.mockResolvedValue(memberships);

      const result = await service.searchMembers(community.id, 'al');

      expect(result[0].user).toBeDefined();
      expectNoSensitiveUserFields(result[0].user!);
    });

    it('should search members by displayName', async () => {
      const community = CommunityFactory.build();
      const user1 = UserFactory.build({ displayName: 'John Doe' });
      const memberships = [
        {
          ...MembershipFactory.build({
            communityId: community.id,
            userId: user1.id,
          }),
          user: user1,
        },
      ];

      mockDatabase.membership.findMany.mockResolvedValue(memberships);

      const result = await service.searchMembers(community.id, 'john');

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
    });

    it('should use custom limit parameter', async () => {
      const community = CommunityFactory.build();
      mockDatabase.membership.findMany.mockResolvedValue([]);

      await service.searchMembers(community.id, 'test', 5);

      expect(mockDatabase.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        }),
      );
    });

    it('should return empty array when no members match', async () => {
      const community = CommunityFactory.build();
      mockDatabase.membership.findMany.mockResolvedValue([]);

      const result = await service.searchMembers(community.id, 'nomatch');

      expect(result).toEqual([]);
    });

    it('should order results by username ascending', async () => {
      const community = CommunityFactory.build();
      mockDatabase.membership.findMany.mockResolvedValue([]);

      await service.searchMembers(community.id, 'test');

      expect(mockDatabase.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            user: {
              username: 'asc',
            },
          },
        }),
      );
    });

    it('should rethrow errors', async () => {
      const community = CommunityFactory.build();
      mockDatabase.membership.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(service.searchMembers(community.id, 'test')).rejects.toThrow(
        'Database error',
      );
    });
  });
});
