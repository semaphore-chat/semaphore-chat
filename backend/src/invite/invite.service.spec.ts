import { TestBed } from '@suites/unit';
import { Logger, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@semaphore-chat/shared';
import type { Mocked } from '@suites/doubles.jest';
import { InviteService } from './invite.service';
import { PermissionsService } from '@/roles/permissions.service';
import { DatabaseService } from '@/database/database.service';
import { RbacResourceType } from '@/auth/rbac-resource.decorator';
import {
  createMockDatabase,
  UserFactory,
  InstanceInviteFactory,
} from '@/test-utils';

describe('InviteService', () => {
  let service: InviteService;
  let mockDatabase: any;
  let permissionsService: Mocked<PermissionsService>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(InviteService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    service = unit;
    permissionsService = unitRef.get(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createInvite', () => {
    beforeEach(() => {
      // An invite that names no community is an instance invite (#685)
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        true,
      );
    });

    it('should create invite with generated code', async () => {
      const creator = UserFactory.build();
      const mockInvite = InstanceInviteFactory.build({
        createdById: creator.id,
        code: 'ABC123',
      });

      mockDatabase.instanceInvite.findFirst.mockResolvedValue(null);
      mockDatabase.instanceInvite.create.mockResolvedValue(mockInvite);

      const result = await service.createInvite(creator);

      expect(result).toEqual(mockInvite);
      expect(mockDatabase.instanceInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          createdById: creator.id,
          code: expect.any(String),
        }),
        include: expect.objectContaining({
          defaultCommunities: true,
          usages: true,
        }),
      });
    });

    it('should create invite with maxUses', async () => {
      const creator = UserFactory.build();
      const maxUses = 10;
      const mockInvite = InstanceInviteFactory.build({
        createdById: creator.id,
        maxUses,
      });

      mockDatabase.instanceInvite.findFirst.mockResolvedValue(null);
      mockDatabase.instanceInvite.create.mockResolvedValue(mockInvite);

      const result = await service.createInvite(creator, maxUses);

      expect(result.maxUses).toBe(maxUses);
      expect(mockDatabase.instanceInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          maxUses,
        }),
        include: expect.objectContaining({
          defaultCommunities: true,
          usages: true,
        }),
      });
    });

    it('should create invite with validUntil date', async () => {
      const creator = UserFactory.build();
      const validUntil = new Date(Date.now() + 1000 * 60 * 60 * 24); // 1 day
      const mockInvite = InstanceInviteFactory.build({
        createdById: creator.id,
        validUntil,
      });

      mockDatabase.instanceInvite.findFirst.mockResolvedValue(null);
      mockDatabase.instanceInvite.create.mockResolvedValue(mockInvite);

      const result = await service.createInvite(creator, undefined, validUntil);

      expect(result.validUntil).toEqual(validUntil);
      expect(mockDatabase.instanceInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          validUntil,
        }),
        include: expect.objectContaining({
          defaultCommunities: true,
          usages: true,
        }),
      });
    });

    it('should create invite with default community IDs via junction table', async () => {
      const creator = UserFactory.build();
      const communityIds = ['community-1', 'community-2'];
      const mockInvite = InstanceInviteFactory.build({
        createdById: creator.id,
      });

      mockDatabase.instanceInvite.findFirst.mockResolvedValue(null);
      mockDatabase.instanceInvite.create.mockResolvedValue(mockInvite);
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        true,
      );

      const result = await service.createInvite(
        creator,
        undefined,
        undefined,
        communityIds,
      );

      expect(result).toEqual(mockInvite);
      expect(mockDatabase.instanceInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          defaultCommunities: {
            create: [
              { communityId: 'community-1' },
              { communityId: 'community-2' },
            ],
          },
        }),
        include: expect.objectContaining({
          defaultCommunities: true,
          usages: true,
        }),
      });
    });

    it('requires the instance create action for an invite naming no community (#685)', async () => {
      const creator = UserFactory.build();
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        false,
      );

      await expect(
        service.createInvite(creator, undefined, undefined, []),
      ).rejects.toThrow("You don't have permission to create instance invites");
      expect(mockDatabase.instanceInvite.create).not.toHaveBeenCalled();
    });

    it('lets a community admin invite to their own community without any instance permission (#685)', async () => {
      const creator = UserFactory.build();
      const mockInvite = InstanceInviteFactory.build({
        createdById: creator.id,
      });
      permissionsService.verifyActionsForUserAndResource.mockImplementation(
        (_userId, _resourceId, resourceType) =>
          Promise.resolve(resourceType === RbacResourceType.COMMUNITY),
      );

      mockDatabase.instanceInvite.findFirst.mockResolvedValue(null);
      mockDatabase.instanceInvite.create.mockResolvedValue(mockInvite);

      await expect(
        service.createInvite(creator, undefined, undefined, ['community-1']),
      ).resolves.toEqual(mockInvite);
      expect(mockDatabase.instanceInvite.create).toHaveBeenCalled();
    });

    it('should regenerate code on collision', async () => {
      const creator = UserFactory.build();
      const mockInvite = InstanceInviteFactory.build();

      // First call returns existing invite (collision), second returns null
      mockDatabase.instanceInvite.findFirst
        .mockResolvedValueOnce(InstanceInviteFactory.build())
        .mockResolvedValueOnce(null);
      mockDatabase.instanceInvite.create.mockResolvedValue(mockInvite);

      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation();

      await service.createInvite(creator);

      expect(mockDatabase.instanceInvite.findFirst).toHaveBeenCalledTimes(2);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('collision'),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should generate 12-character code by default', async () => {
      const creator = UserFactory.build();
      const mockInvite = InstanceInviteFactory.build();

      mockDatabase.instanceInvite.findFirst.mockResolvedValue(null);
      mockDatabase.instanceInvite.create.mockResolvedValue(mockInvite);

      await service.createInvite(creator);

      const createCall = mockDatabase.instanceInvite.create.mock.calls[0][0];
      expect(createCall.data.code).toHaveLength(12);
    });
  });

  describe('getPublicInvite', () => {
    const invite = {
      code: 'PUBLIC123',
      uses: 1,
      maxUses: 5,
      validUntil: null,
      disabled: false,
      createdBy: { username: 'owner' },
    };

    /** The error a rejected lookup threw. */
    const rejection = async (code: string): Promise<NotFoundException> => {
      try {
        await service.getPublicInvite(code);
      } catch (error) {
        return error as NotFoundException;
      }
      throw new Error('expected getPublicInvite to reject');
    };

    it('returns what the join screen shows for a usable code', async () => {
      mockDatabase.instanceInvite.findUnique.mockResolvedValue(invite);

      await expect(service.getPublicInvite(invite.code)).resolves.toEqual(
        invite,
      );
    });

    it.each([
      ['an unknown code', null, ErrorCode.INVITE_NOT_FOUND],
      [
        'an expired invite',
        { ...invite, validUntil: new Date(Date.now() - 60_000) },
        ErrorCode.INVITE_EXPIRED,
      ],
      [
        'an exhausted invite',
        { ...invite, uses: 5, maxUses: 5 },
        ErrorCode.INVITE_EXHAUSTED,
      ],
      [
        'a disabled invite',
        { ...invite, disabled: true },
        ErrorCode.INVITE_DISABLED,
      ],
    ])('answers 404 with a reason for %s', async (_label, row, code) => {
      mockDatabase.instanceInvite.findUnique.mockResolvedValue(row);

      const error = await rejection('whatever');

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.getStatus()).toBe(404);
      expect(error.getResponse()).toMatchObject({ errorCode: code });
    });

    it('reports exhaustion rather than "disabled" when the last use spent it', async () => {
      // Redemption also flips `disabled` on the last use.
      mockDatabase.instanceInvite.findUnique.mockResolvedValue({
        ...invite,
        uses: 5,
        maxUses: 5,
        disabled: true,
      });

      const error = await rejection('whatever');

      expect(error.getResponse()).toMatchObject({
        errorCode: ErrorCode.INVITE_EXHAUSTED,
      });
    });
  });

  describe('validateInviteCode', () => {
    it('should return invite when valid', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
        validUntil: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
        maxUses: 10,
        uses: 5,
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      const result = await service.validateInviteCode(mockInvite.code);

      expect(result).toEqual(mockInvite);
    });

    it('should return null when invite not found', async () => {
      mockDatabase.instanceInvite.findUnique.mockResolvedValue(null);

      const result = await service.validateInviteCode('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when invite is disabled', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: true,
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      const result = await service.validateInviteCode(mockInvite.code);

      expect(result).toBeNull();
    });

    it('should return null when invite is expired', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
        validUntil: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      const result = await service.validateInviteCode(mockInvite.code);

      expect(result).toBeNull();
    });

    it('should return null when invite reached max uses', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
        maxUses: 10,
        uses: 10,
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      const result = await service.validateInviteCode(mockInvite.code);

      expect(result).toBeNull();
    });

    it('should return invite when maxUses is null (unlimited)', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
        maxUses: null,
        uses: 100,
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      const result = await service.validateInviteCode(mockInvite.code);

      expect(result).toEqual(mockInvite);
    });

    it('should return invite when validUntil is null (no expiry)', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
        validUntil: null,
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      const result = await service.validateInviteCode(mockInvite.code);

      expect(result).toEqual(mockInvite);
    });
  });

  describe('redeemForExistingUser', () => {
    const buildTx = (opts: { invite?: any; usage?: any; maxUses?: number }) => {
      const invite =
        opts.invite === undefined
          ? InstanceInviteFactory.build({
              code: 'C',
              disabled: false,
              maxUses: opts.maxUses ?? 5,
              uses: 0,
            })
          : opts.invite;
      return {
        invite,
        tx: {
          $queryRaw: jest.fn().mockResolvedValue([]),
          instanceInvite: {
            findUnique: jest.fn().mockResolvedValue(invite),
            update: jest.fn().mockResolvedValue(invite),
          },
          instanceInviteUsage: {
            findUnique: jest.fn().mockResolvedValue(opts.usage ?? null),
            create: jest.fn().mockResolvedValue({}),
          },
        },
      };
    };

    it('locks the invite row and spends a use', async () => {
      const { tx } = buildTx({});
      await expect(
        service.redeemForExistingUser(tx as any, 'C', 'u1'),
      ).resolves.toBe('redeemed');
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.instanceInviteUsage.create).toHaveBeenCalledTimes(1);
    });

    it('answers already_used without a second use', async () => {
      const { tx } = buildTx({ usage: { id: 'x' } });
      await expect(
        service.redeemForExistingUser(tx as any, 'C', 'u1'),
      ).resolves.toBe('already_used');
      expect(tx.instanceInviteUsage.create).not.toHaveBeenCalled();
      expect(tx.instanceInvite.update).not.toHaveBeenCalled();
    });

    it.each([
      ['exhausted', { maxUses: 1, uses: 1 }],
      ['disabled', { disabled: true }],
      ['expired', { validUntil: new Date(Date.now() - 1000) }],
    ])('answers unusable for an %s invite', async (_name, patch) => {
      const invite = InstanceInviteFactory.build({
        code: 'C',
        disabled: false,
        maxUses: 5,
        uses: 0,
        ...patch,
      });
      const { tx } = buildTx({ invite });
      await expect(
        service.redeemForExistingUser(tx as any, 'C', 'u1'),
      ).resolves.toBe('unusable');
      expect(tx.instanceInviteUsage.create).not.toHaveBeenCalled();
    });

    it.each([
      ['exhausted', { maxUses: 1, uses: 1 }],
      ['disabled', { disabled: true }],
      ['expired', { validUntil: new Date(Date.now() - 1000) }],
    ])(
      'answers unusable for an %s invite even to someone who used it before',
      async (_name, patch) => {
        const invite = InstanceInviteFactory.build({
          code: 'C',
          disabled: false,
          maxUses: 5,
          uses: 0,
          ...patch,
        });
        const { tx } = buildTx({ invite, usage: { id: 'x' } });
        await expect(
          service.redeemForExistingUser(tx as any, 'C', 'u1'),
        ).resolves.toBe('unusable');
      },
    );

    it('answers unusable for an unknown code', async () => {
      const { tx } = buildTx({ invite: null });
      await expect(
        service.redeemForExistingUser(tx as any, 'nope', 'u1'),
      ).resolves.toBe('unusable');
    });
  });

  describe('redeemInviteWithTx', () => {
    it('should redeem valid invite and increment uses', async () => {
      const userId = 'user-123';
      const inviteCode = 'ABC123';
      const mockInvite = InstanceInviteFactory.build({
        code: inviteCode,
        disabled: false,
        maxUses: 10,
        uses: 5,
      });

      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        instanceInvite: {
          findUnique: jest.fn().mockResolvedValue(mockInvite),
          update: jest.fn().mockResolvedValue({
            ...mockInvite,
            uses: 6,
          }),
        },
        instanceInviteUsage: {
          findUnique: jest.fn().mockResolvedValue(null), // User hasn't used this invite
          create: jest
            .fn()
            .mockResolvedValue({ inviteId: mockInvite.id, userId }),
        },
      };

      const result = await service.redeemInviteWithTx(
        mockTx as any,
        inviteCode,
        userId,
      );

      expect(result).toBeDefined();
      // Should check for existing usage via junction table
      expect(mockTx.instanceInviteUsage.findUnique).toHaveBeenCalledWith({
        where: {
          inviteId_userId: {
            inviteId: mockInvite.id,
            userId,
          },
        },
      });
      // Should record usage in junction table
      expect(mockTx.instanceInviteUsage.create).toHaveBeenCalledWith({
        data: {
          inviteId: mockInvite.id,
          userId,
        },
      });
      // Should increment uses count (no more usedByIds push)
      expect(mockTx.instanceInvite.update).toHaveBeenCalledWith({
        where: { code: inviteCode },
        data: {
          uses: { increment: 1 },
          disabled: false,
        },
        include: expect.objectContaining({
          defaultCommunities: true,
          usages: true,
        }),
      });
    });

    it('should disable invite when reaching max uses', async () => {
      const userId = 'user-123';
      const inviteCode = 'ABC123';
      const mockInvite = InstanceInviteFactory.build({
        code: inviteCode,
        disabled: false,
        maxUses: 10,
        uses: 9, // One use away from max
      });

      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        instanceInvite: {
          findUnique: jest.fn().mockResolvedValue(mockInvite),
          update: jest.fn().mockResolvedValue({
            ...mockInvite,
            uses: 10,
            disabled: true,
          }),
        },
        instanceInviteUsage: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest
            .fn()
            .mockResolvedValue({ inviteId: mockInvite.id, userId }),
        },
      };

      await service.redeemInviteWithTx(mockTx as any, inviteCode, userId);

      expect(mockTx.instanceInvite.update).toHaveBeenCalledWith({
        where: { code: inviteCode },
        data: {
          uses: { increment: 1 },
          disabled: true, // Should disable (9 + 1 >= 10)
        },
        include: expect.objectContaining({
          defaultCommunities: true,
          usages: true,
        }),
      });
    });

    it('should return null when invite not found', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        instanceInvite: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };

      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation();

      const result = await service.redeemInviteWithTx(
        mockTx as any,
        'nonexistent',
        'user-123',
      );

      expect(result).toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid invite code'),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should return null when invite is disabled', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: true,
      });

      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        instanceInvite: {
          findUnique: jest.fn().mockResolvedValue(mockInvite),
        },
      };

      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation();

      const result = await service.redeemInviteWithTx(
        mockTx as any,
        mockInvite.code,
        'user-123',
      );

      expect(result).toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
    });

    it('should return null when invite is expired', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
        validUntil: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      });

      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        instanceInvite: {
          findUnique: jest.fn().mockResolvedValue(mockInvite),
        },
      };

      const result = await service.redeemInviteWithTx(
        mockTx as any,
        mockInvite.code,
        'user-123',
      );

      expect(result).toBeNull();
    });

    it('should return null when invite reached max uses', async () => {
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
        maxUses: 10,
        uses: 10,
      });

      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        instanceInvite: {
          findUnique: jest.fn().mockResolvedValue(mockInvite),
        },
      };

      const result = await service.redeemInviteWithTx(
        mockTx as any,
        mockInvite.code,
        'user-123',
      );

      expect(result).toBeNull();
    });

    it('should return null when user already redeemed invite', async () => {
      const userId = 'user-123';
      const mockInvite = InstanceInviteFactory.build({
        disabled: false,
      });

      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        instanceInvite: {
          findUnique: jest.fn().mockResolvedValue(mockInvite),
        },
        instanceInviteUsage: {
          findUnique: jest.fn().mockResolvedValue({
            inviteId: mockInvite.id,
            userId,
            usedAt: new Date(),
          }), // User already used this invite
        },
      };

      const result = await service.redeemInviteWithTx(
        mockTx as any,
        mockInvite.code,
        userId,
      );

      expect(result).toBeNull();
    });
  });

  describe('getInvites', () => {
    beforeEach(() => {
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        true,
      );
    });

    it('should return all invites created by user', async () => {
      const user = UserFactory.build();
      const mockInvites = [
        InstanceInviteFactory.build({ createdById: user.id }),
        InstanceInviteFactory.build({ createdById: user.id }),
      ];

      mockDatabase.instanceInvite.findMany.mockResolvedValue(mockInvites);

      const result = await service.getInvites(user);

      expect(result).toEqual(mockInvites);
      expect(mockDatabase.instanceInvite.findMany).toHaveBeenCalledWith({
        where: { createdById: user.id },
        include: {
          createdBy: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          defaultCommunities: true,
          usages: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when user has no invites', async () => {
      const user = UserFactory.build();

      mockDatabase.instanceInvite.findMany.mockResolvedValue([]);

      const result = await service.getInvites(user);

      expect(result).toEqual([]);
    });

    it('should order invites by creation date descending', async () => {
      const user = UserFactory.build();

      mockDatabase.instanceInvite.findMany.mockResolvedValue([]);

      await service.getInvites(user);

      expect(mockDatabase.instanceInvite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('getInvites for one community (#685)', () => {
    const holdsCommunities = (held: string[]) =>
      permissionsService.verifyActionsForUserAndResource.mockImplementation(
        (_userId, resourceId, resourceType) =>
          Promise.resolve(
            resourceType === RbacResourceType.COMMUNITY &&
              held.includes(resourceId as string),
          ),
      );
    const inviteFor = (...communityIds: string[]) => ({
      ...InstanceInviteFactory.build(),
      defaultCommunities: communityIds.map((communityId) => ({ communityId })),
    });

    it('refuses a caller without the community CREATE_INVITE, even with instance read', async () => {
      const user = UserFactory.build();
      permissionsService.verifyActionsForUserAndResource.mockImplementation(
        (_u, _r, resourceType) =>
          Promise.resolve(resourceType === RbacResourceType.INSTANCE),
      );

      await expect(service.getInvites(user, 'community-1')).rejects.toThrow(
        "You don't have permission to view this community's invites",
      );
      expect(mockDatabase.instanceInvite.findMany).not.toHaveBeenCalled();
    });

    it('queries the invites that include the community', async () => {
      const user = UserFactory.build();
      holdsCommunities(['community-1']);
      mockDatabase.instanceInvite.findMany.mockResolvedValue([]);

      await service.getInvites(user, 'community-1');

      expect(mockDatabase.instanceInvite.findMany).toHaveBeenCalledWith({
        where: { defaultCommunities: { some: { communityId: 'community-1' } } },
        include: expect.objectContaining({
          defaultCommunities: true,
          usages: true,
        }),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('hides an invite that also names a community the caller cannot invite to', async () => {
      const user = UserFactory.build();
      holdsCommunities(['community-1']);
      const mine = inviteFor('community-1');
      const mixed = inviteFor('community-1', 'community-2');
      mockDatabase.instanceInvite.findMany.mockResolvedValue([mixed, mine]);

      const result = await service.getInvites(user, 'community-1');

      expect(result).toEqual([mine]);
    });

    it('shows an invite naming several communities when the caller may invite to all', async () => {
      const user = UserFactory.build();
      holdsCommunities(['community-1', 'community-2']);
      const both = inviteFor('community-1', 'community-2');
      mockDatabase.instanceInvite.findMany.mockResolvedValue([both]);

      expect(await service.getInvites(user, 'community-1')).toEqual([both]);
    });

    it('shows every invite to the instance owner', async () => {
      const user = UserFactory.build({ role: 'OWNER' });
      const mixed = inviteFor('community-1', 'community-2');
      mockDatabase.instanceInvite.findMany.mockResolvedValue([mixed]);

      expect(await service.getInvites(user, 'community-1')).toEqual([mixed]);
    });

    it('keeps the creator-scoped list when no community is given', async () => {
      const user = UserFactory.build();
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        false,
      );

      await expect(service.getInvites(user)).rejects.toThrow(
        "You don't have permission to view instance invites",
      );
      expect(mockDatabase.instanceInvite.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getInviteByCode', () => {
    it('should return invite with creator info', async () => {
      const mockInvite = InstanceInviteFactory.build();

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      const result = await service.getInviteByCode(mockInvite.code);

      expect(result).toEqual(mockInvite);
      expect(mockDatabase.instanceInvite.findUnique).toHaveBeenCalledWith({
        where: { code: mockInvite.code },
        include: {
          createdBy: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
          defaultCommunities: true,
          usages: true,
        },
      });
    });

    it('should return null when invite not found', async () => {
      mockDatabase.instanceInvite.findUnique.mockResolvedValue(null);

      const result = await service.getInviteByCode('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('deleteInvite', () => {
    const notCreatorScenario = (
      defaultCommunities: { communityId: string }[],
    ) => {
      const user = UserFactory.build();
      const other = UserFactory.build();
      const invite = {
        ...InstanceInviteFactory.build({ createdById: other.id }),
        defaultCommunities,
      };
      mockDatabase.instanceInvite.findUnique.mockResolvedValue(invite);
      return { user, invite };
    };

    it('deletes the invite when the caller is its creator', async () => {
      const user = UserFactory.build();
      const invite = {
        ...InstanceInviteFactory.build({ createdById: user.id }),
        defaultCommunities: [],
      };

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(invite);
      mockDatabase.instanceInvite.delete.mockResolvedValue(invite);

      await service.deleteInvite(user, invite.code);

      expect(mockDatabase.instanceInvite.delete).toHaveBeenCalledWith({
        where: { code: invite.code },
      });
      expect(
        permissionsService.verifyActionsForUserAndResource,
      ).not.toHaveBeenCalled();
    });

    it('throws when the invite does not exist', async () => {
      const user = UserFactory.build();
      mockDatabase.instanceInvite.findUnique.mockResolvedValue(null);

      await expect(service.deleteInvite(user, 'nonexistent')).rejects.toThrow(
        'Invite not found',
      );
      expect(mockDatabase.instanceInvite.delete).not.toHaveBeenCalled();
    });

    it('throws for a stranger with no instance delete action and no named community', async () => {
      const { user, invite } = notCreatorScenario([]);
      permissionsService.verifyActionsForUserAndResource.mockResolvedValue(
        false,
      );

      await expect(service.deleteInvite(user, invite.code)).rejects.toThrow(
        'Unauthorized to delete this invite',
      );
      expect(mockDatabase.instanceInvite.delete).not.toHaveBeenCalled();
    });

    it('deletes for a holder of the instance delete action', async () => {
      const { user, invite } = notCreatorScenario([
        { communityId: 'community-1' },
      ]);
      permissionsService.verifyActionsForUserAndResource.mockImplementation(
        (_userId, _resourceId, resourceType) =>
          Promise.resolve(resourceType === RbacResourceType.INSTANCE),
      );
      mockDatabase.instanceInvite.delete.mockResolvedValue(invite);

      await service.deleteInvite(user, invite.code);

      expect(mockDatabase.instanceInvite.delete).toHaveBeenCalled();
    });

    it("deletes for a holder of every named community's delete action", async () => {
      const { user, invite } = notCreatorScenario([
        { communityId: 'community-1' },
        { communityId: 'community-2' },
      ]);
      permissionsService.verifyActionsForUserAndResource.mockImplementation(
        (_userId, _resourceId, resourceType) =>
          Promise.resolve(resourceType === RbacResourceType.COMMUNITY),
      );
      mockDatabase.instanceInvite.delete.mockResolvedValue(invite);

      await service.deleteInvite(user, invite.code);

      expect(mockDatabase.instanceInvite.delete).toHaveBeenCalled();
    });

    it('refuses when a named community is one the caller cannot delete invites in', async () => {
      const { user, invite } = notCreatorScenario([
        { communityId: 'community-1' },
        { communityId: 'community-2' },
      ]);
      permissionsService.verifyActionsForUserAndResource.mockImplementation(
        (_userId, resourceId, resourceType) =>
          Promise.resolve(
            resourceType === RbacResourceType.COMMUNITY &&
              resourceId === 'community-1',
          ),
      );

      await expect(service.deleteInvite(user, invite.code)).rejects.toThrow(
        'Unauthorized to delete this invite',
      );
      expect(mockDatabase.instanceInvite.delete).not.toHaveBeenCalled();
    });

    it('the instance owner deletes any invite', async () => {
      const owner = UserFactory.buildOwner();
      const invite = {
        ...InstanceInviteFactory.build(),
        defaultCommunities: [],
      };
      mockDatabase.instanceInvite.findUnique.mockResolvedValue(invite);
      mockDatabase.instanceInvite.delete.mockResolvedValue(invite);

      await service.deleteInvite(owner, invite.code);

      expect(mockDatabase.instanceInvite.delete).toHaveBeenCalled();
    });
  });
});
