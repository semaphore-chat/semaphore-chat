import { TestBed } from '@suites/unit';
import { Logger, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@semaphore-chat/shared';
import type { Mocked } from '@suites/doubles.jest';
import { InviteService } from './invite.service';
import { PermissionsService } from '@/roles/permissions.service';
import { DatabaseService } from '@/database/database.service';
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
    it('should delete invite when user is creator', async () => {
      const user = UserFactory.build();
      const mockInvite = InstanceInviteFactory.build({
        createdById: user.id,
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);
      mockDatabase.instanceInvite.delete.mockResolvedValue(mockInvite);

      await service.deleteInvite(user, mockInvite.code);

      expect(mockDatabase.instanceInvite.delete).toHaveBeenCalledWith({
        where: { code: mockInvite.code },
      });
    });

    it('should throw error when invite not found', async () => {
      const user = UserFactory.build();

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(null);

      await expect(service.deleteInvite(user, 'nonexistent')).rejects.toThrow(
        'Invite not found',
      );

      expect(mockDatabase.instanceInvite.delete).not.toHaveBeenCalled();
    });

    it('should throw error when user is not creator', async () => {
      const user = UserFactory.build();
      const otherUser = UserFactory.build();
      const mockInvite = InstanceInviteFactory.build({
        createdById: otherUser.id,
      });

      mockDatabase.instanceInvite.findUnique.mockResolvedValue(mockInvite);

      await expect(service.deleteInvite(user, mockInvite.code)).rejects.toThrow(
        'Unauthorized to delete this invite',
      );

      expect(mockDatabase.instanceInvite.delete).not.toHaveBeenCalled();
    });
  });
});
