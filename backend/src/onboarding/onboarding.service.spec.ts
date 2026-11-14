import { TestBed } from '@suites/unit';
import { OnboardingService } from './onboarding.service';
import { DatabaseService } from '@/database/database.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { CommunityRolesService } from '@/roles/community-roles.service';
import { InstanceRolesService } from '@/roles/instance-roles.service';
import { PermissionsCacheService } from '@/roles/permissions-cache.service';
import { ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  UserFactory,
  CommunityFactory,
  ChannelFactory,
  InstanceInviteFactory,
  createMockDatabase,
  createMockRedis,
  type MockDatabaseService,
} from '@/test-utils';
import { SetupInstanceDto } from './dto/setup-instance.dto';
import { InstanceRole } from '@prisma/client';
import { InstanceService } from '@/instance/instance.service';
import type { Mocked } from '@suites/doubles.jest';

// Mock bcrypt and crypto
jest.mock('bcrypt');
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(() => 'mock-uuid-123'),
}));

describe('OnboardingService', () => {
  let service: OnboardingService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let communityRolesService: Mocked<CommunityRolesService>;
  let instanceRolesService: Mocked<InstanceRolesService>;
  let permissionsCacheService: Mocked<PermissionsCacheService>;

  const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();
    mockRedis = createMockRedis();
    (mockRedis as unknown as { persist: jest.Mock }).persist = jest
      .fn()
      .mockResolvedValue(1);
    delete process.env.REQUIRE_SETUP_TOKEN;
    delete process.env.SETUP_TOKEN;

    const mockCommunityRolesService = {
      createDefaultCommunityRoles: jest.fn(),
      assignUserToCommunityRole: jest.fn(),
    };
    const mockInstanceRolesService = {
      createDefaultInstanceRole: jest
        .fn()
        .mockResolvedValue('mock-instance-admin-role-id'),
      assignUserToInstanceRole: jest.fn(),
      createDefaultCommunityCreatorRole: jest
        .fn()
        .mockResolvedValue('mock-community-creator-role-id'),
    };

    const { unit, unitRef } = await TestBed.solitary(OnboardingService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .mock(REDIS_CLIENT)
      .final(mockRedis)
      .mock(CommunityRolesService)
      .final(mockCommunityRolesService)
      .mock(InstanceRolesService)
      .final(mockInstanceRolesService)
      .compile();

    service = unit;
    communityRolesService =
      mockCommunityRolesService as unknown as Mocked<CommunityRolesService>;
    instanceRolesService =
      mockInstanceRolesService as unknown as Mocked<InstanceRolesService>;
    permissionsCacheService = unitRef.get(PermissionsCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_SETUP_TOKEN;
    delete process.env.SETUP_TOKEN;
  });

  describe('needsSetup', () => {
    it('should return true when there are no users and no active invites', async () => {
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);

      const result = await service.needsSetup();

      expect(result).toBe(true);
      expect(mockDatabase.user.count).toHaveBeenCalled();
      expect(mockDatabase.instanceInvite.count).toHaveBeenCalledWith({
        where: { disabled: false },
      });
    });

    it('should return false when there are existing users', async () => {
      mockDatabase.user.count.mockResolvedValue(1);

      const result = await service.needsSetup();

      expect(result).toBe(false);
      expect(mockDatabase.user.count).toHaveBeenCalled();
      expect(mockDatabase.instanceInvite.count).not.toHaveBeenCalled();
    });

    it('should return false when there are active invites but no users', async () => {
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(1);

      const result = await service.needsSetup();

      expect(result).toBe(false);
      expect(mockDatabase.instanceInvite.count).toHaveBeenCalledWith({
        where: { disabled: false },
      });
    });
  });

  describe('generateSetupToken', () => {
    it('should generate and store a new setup token when setup is needed', async () => {
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(undefined);

      const token = await service.generateSetupToken();

      expect(token).toBe('mock-uuid-123');
      // No TTL: the operator reads the token from the logs, maybe hours later
      expect(mockRedis.set).toHaveBeenCalledWith(
        'onboarding:setup-token',
        'mock-uuid-123',
        'NX',
      );
    });

    it('logs a newly created token on one greppable line', async () => {
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      mockRedis.get.mockResolvedValue(null);
      const warn = jest.spyOn(service['logger'], 'warn');

      await service.generateSetupToken();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Setup token: mock-uuid-123'),
      );
    });

    it('uses SETUP_TOKEN from the environment instead of Redis', async () => {
      process.env.SETUP_TOKEN = '  operator-chosen-token-123  ';
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      const warn = jest.spyOn(service['logger'], 'warn');

      const token = await service.generateSetupToken();

      expect(token).toBe('operator-chosen-token-123');
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('operator-chosen-token-123'),
      );
    });

    it('should return existing token if one already exists', async () => {
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      mockRedis.get.mockResolvedValue('existing-token');

      const token = await service.generateSetupToken();

      expect(token).toBe('existing-token');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when setup is not needed', async () => {
      mockDatabase.user.count.mockResolvedValue(1);

      await expect(service.generateSetupToken()).rejects.toThrow(
        ConflictException,
      );
      await expect(service.generateSetupToken()).rejects.toThrow(
        'Instance setup is not needed',
      );
    });
  });

  describe('validateSetupToken', () => {
    it('should return true when token matches stored token', async () => {
      mockRedis.get.mockResolvedValue('valid-token');

      const result = await service.validateSetupToken('valid-token');

      expect(result).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith('onboarding:setup-token');
    });

    it('should return false when token does not match', async () => {
      mockRedis.get.mockResolvedValue('valid-token');

      const result = await service.validateSetupToken('wrong-token');

      expect(result).toBe(false);
    });

    it('should return false when no token is stored', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.validateSetupToken('any-token');

      expect(result).toBe(false);
    });

    it('trims whitespace around a pasted token', async () => {
      mockRedis.get.mockResolvedValue('valid-token');

      expect(await service.validateSetupToken('  valid-token\n')).toBe(true);
    });

    it('rejects an empty token', async () => {
      mockRedis.get.mockResolvedValue('valid-token');

      expect(await service.validateSetupToken('   ')).toBe(false);
    });

    it('checks against SETUP_TOKEN when it is set', async () => {
      process.env.SETUP_TOKEN = 'operator-chosen-token-123';
      mockRedis.get.mockResolvedValue('redis-token');

      expect(await service.validateSetupToken('redis-token')).toBe(false);
      expect(
        await service.validateSetupToken('operator-chosen-token-123'),
      ).toBe(true);
    });
  });

  describe('completeSetup', () => {
    const validSetupDto: SetupInstanceDto = {
      adminUsername: 'admin',
      adminPassword: 'password123',
      adminEmail: 'admin@example.com',
      instanceName: 'My Instance',
      instanceDescription: 'Test instance',
      defaultCommunityName: 'General',
      createDefaultCommunity: true,
      setupToken: 'valid-token',
    };

    const mockAdmin = UserFactory.build({
      username: 'admin',
      role: InstanceRole.OWNER,
      verified: true,
    });

    const mockCommunity = CommunityFactory.build({
      name: 'General',
      description: 'Test instance',
    });

    const mockChannels = [
      ChannelFactory.build({ name: 'general', type: 'TEXT' }),
      ChannelFactory.build({ name: 'announcements', type: 'TEXT' }),
      ChannelFactory.build({ name: 'voice-chat', type: 'VOICE' }),
    ];

    const mockInvite = InstanceInviteFactory.build();

    // The transaction client the service uses, so tests can inspect and
    // adjust what happens inside the setup transaction.
    let setupTx: MockDatabaseService;

    beforeEach(() => {
      mockRedis.get.mockResolvedValue('valid-token');
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      mockBcrypt.hash.mockResolvedValue('hashed-password' as never);

      // Setup transaction mock
      mockDatabase.$transaction.mockImplementation(
        (callback: (tx: MockDatabaseService) => unknown) => {
          const mockTx = createMockDatabase();
          setupTx = mockTx;

          // The service repeats the "needs setup" check under the setup lock.
          mockTx.user.count.mockResolvedValue(0);
          mockTx.instanceInvite.count.mockResolvedValue(0);

          // Mock instance settings lookup
          mockTx.instanceSettings.findFirst.mockResolvedValue(null);

          // Mock admin user creation
          mockTx.user.create.mockResolvedValue(mockAdmin);

          // Mock community creation
          mockTx.community.create.mockResolvedValue(mockCommunity);

          // Mock membership creation
          mockTx.membership.create.mockResolvedValue({
            userId: mockAdmin.id,
            communityId: mockCommunity.id,
          });

          // Mock channel creation
          mockTx.channel.create
            .mockResolvedValueOnce(mockChannels[0])
            .mockResolvedValueOnce(mockChannels[1])
            .mockResolvedValueOnce(mockChannels[2]);

          // Mock channel membership creation
          mockTx.channelMembership.createMany.mockResolvedValue({ count: 3 });

          // Mock message creation
          mockTx.message.create.mockResolvedValue({
            id: 'msg-1',
            channelId: mockChannels[0].id,
            authorId: mockAdmin.id,
          });

          // Mock invite creation
          mockTx.instanceInvite.create.mockResolvedValue(mockInvite);

          // Mock roles service
          jest
            .spyOn(communityRolesService, 'createDefaultCommunityRoles')
            .mockResolvedValue('admin-role-id');
          jest
            .spyOn(communityRolesService, 'assignUserToCommunityRole')
            .mockResolvedValue(undefined);

          return callback(mockTx);
        },
      );

      mockRedis.del.mockResolvedValue(undefined);
      mockRedis.set.mockResolvedValue(undefined);
    });

    it('should complete setup successfully with default community', async () => {
      const result = await service.completeSetup(validSetupDto, 'valid-token');

      expect(result.adminUser).toBeDefined();
      expect(result.adminUser.username).toBe('admin');
      expect(result.adminUser.role).toBe(InstanceRole.OWNER);
      expect(result.defaultCommunity).toBeDefined();
      expect(result.defaultCommunity?.name).toBe('General');
    });

    it('should hash admin password with bcrypt', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    it('should create admin user with correct properties', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    it('should create default community with three channels', async () => {
      const result = await service.completeSetup(validSetupDto, 'valid-token');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      expect(result.defaultCommunity).toBeDefined();
      expect(result.defaultCommunity?.name).toBe('General');
    });

    it('should add admin to community and all channels', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      expect(
        communityRolesService.createDefaultCommunityRoles,
      ).toHaveBeenCalled();
    });

    it('should create default roles and assign admin', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(
        communityRolesService.createDefaultCommunityRoles,
      ).toHaveBeenCalled();
      expect(
        communityRolesService.assignUserToCommunityRole,
      ).toHaveBeenCalled();
    });

    it('should create welcome message in general channel', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
    });

    it('should create permanent instance invite', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
    });

    it('should skip community creation when createDefaultCommunity is false', async () => {
      const dtoWithoutCommunity: SetupInstanceDto = {
        ...validSetupDto,
        createDefaultCommunity: false,
      };

      const result = await service.completeSetup(
        dtoWithoutCommunity,
        'valid-token',
      );

      expect(result.defaultCommunity).toBeNull();
    });

    it('should clear setup token after successful completion', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(mockRedis.del).toHaveBeenCalledWith('onboarding:setup-token');
    });

    it('saves the instance name and description into instance settings', async () => {
      await service.completeSetup(validSetupDto, 'valid-token');

      expect(setupTx.instanceSettings.create).toHaveBeenCalledWith({
        data: { name: 'My Instance', description: 'Test instance' },
      });
      // The name used to go to a Redis key nothing read.
      expect(mockRedis.set).not.toHaveBeenCalledWith(
        'instance:name',
        expect.anything(),
      );
    });

    it('public instance settings return the name given at setup', async () => {
      const settingsTx = createMockDatabase();
      let stored: {
        id: string;
        name?: string;
        description?: string | null;
      } | null = null;

      settingsTx.user.count.mockResolvedValue(0);
      settingsTx.instanceInvite.count.mockResolvedValue(0);
      settingsTx.user.create.mockResolvedValue(mockAdmin);
      settingsTx.instanceInvite.create.mockResolvedValue(mockInvite);
      settingsTx.instanceSettings.findFirst.mockImplementation(() =>
        Promise.resolve(stored as never),
      );
      settingsTx.instanceSettings.create.mockImplementation(
        (args: { data: { name: string; description: string | null } }) => {
          stored = { id: 'settings-1', ...args.data };
          return Promise.resolve(stored as never);
        },
      );
      mockDatabase.$transaction.mockImplementation(
        (callback: (tx: MockDatabaseService) => unknown) =>
          callback(settingsTx),
      );
      // InstanceService.getSettings() is what GET /instance/settings/public
      // reads the name from.
      mockDatabase.instanceSettings.findFirst.mockImplementation(() =>
        Promise.resolve(stored as never),
      );

      await service.completeSetup(
        { ...validSetupDto, createDefaultCommunity: false },
        'valid-token',
      );

      const publicSettings = await new InstanceService(
        mockDatabase as unknown as DatabaseService,
      ).getSettings();

      expect(publicSettings.name).toBe('My Instance');
      expect(publicSettings.description).toBe('Test instance');
    });

    it('creates exactly one owner when two setups run concurrently', async () => {
      const raceTx = createMockDatabase();
      let ownersCreated = 0;
      let inTransaction: Promise<unknown> = Promise.resolve();

      raceTx.user.count.mockImplementation(() =>
        Promise.resolve(ownersCreated),
      );
      raceTx.instanceInvite.count.mockResolvedValue(0);
      raceTx.user.create.mockImplementation(() => {
        ownersCreated += 1;
        return Promise.resolve(mockAdmin);
      });

      // The advisory lock is what serializes the two transactions in
      // Postgres; simulate that ordering here.
      mockDatabase.$transaction.mockImplementation(
        (callback: (tx: MockDatabaseService) => unknown) => {
          const run = inTransaction.then(() => callback(raceTx));
          inTransaction = run.catch(() => undefined);
          return run;
        },
      );

      const results = await Promise.allSettled([
        service.completeSetup(
          { ...validSetupDto, createDefaultCommunity: false },
          'valid-token',
        ),
        service.completeSetup(
          { ...validSetupDto, createDefaultCommunity: false },
          'valid-token',
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected).toBeDefined();
      expect(rejected!.reason).toBeInstanceOf(ConflictException);
      expect(rejected!.reason.message).toBe(
        'Instance setup is no longer needed',
      );
      expect(ownersCreated).toBe(1);
      // The lock is taken inside the transaction, before the repeat check.
      expect(raceTx.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException when setup token is invalid', async () => {
      mockRedis.get.mockResolvedValue('different-token');

      await expect(
        service.completeSetup(validSetupDto, 'invalid-token'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.completeSetup(validSetupDto, 'invalid-token'),
      ).rejects.toThrow('Invalid setup token');
    });

    it('should throw ConflictException when setup is no longer needed', async () => {
      mockDatabase.user.count.mockResolvedValue(1);

      await expect(
        service.completeSetup(validSetupDto, 'valid-token'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.completeSetup(validSetupDto, 'valid-token'),
      ).rejects.toThrow('Instance setup is no longer needed');
    });

    it('should lowercase admin username', async () => {
      const dtoWithUppercase: SetupInstanceDto = {
        ...validSetupDto,
        adminUsername: 'ADMIN',
      };

      const result = await service.completeSetup(
        dtoWithUppercase,
        'valid-token',
      );

      expect(result.adminUser.username).toBe('admin');
    });

    it('flushes deferred epoch bumps only after the transaction commits', async () => {
      const order: string[] = [];
      const dto: SetupInstanceDto = {
        ...validSetupDto,
        createDefaultCommunity: false,
      };

      mockDatabase.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = createMockDatabase();
        mockTx.user.count.mockResolvedValue(0);
        mockTx.instanceInvite.count.mockResolvedValue(0);
        mockTx.user.create.mockResolvedValue(mockAdmin);
        mockTx.instanceInvite.create.mockResolvedValue(mockInvite);
        const result = await callback(mockTx);
        order.push('commit');
        return result;
      });

      // The (mocked) tx-nested role mutations record their bumps on the
      // collector the service passes in, like the real implementations do.
      instanceRolesService.createDefaultInstanceRole.mockImplementation(((
        _tx: unknown,
        bumps: any[],
      ) => {
        bumps.push({ kind: 'instance' });
        return Promise.resolve('mock-instance-admin-role-id');
      }) as any);
      instanceRolesService.assignUserToInstanceRole.mockImplementation(((
        userId: string,
        _roleId: string,
        _tx: unknown,
        bumps: any[],
      ) => {
        bumps.push({ kind: 'user', userId });
        return Promise.resolve();
      }) as any);
      instanceRolesService.createDefaultCommunityCreatorRole.mockImplementation(
        ((_tx: unknown, bumps: any[]) => {
          bumps.push({ kind: 'instance' });
          return Promise.resolve('mock-community-creator-role-id');
        }) as any,
      );
      permissionsCacheService.executeBumps.mockImplementation(() => {
        order.push('flush-bumps');
        return Promise.resolve();
      });

      await service.completeSetup(dto, 'valid-token');

      // Bumps must flush strictly AFTER the transaction resolves (commit).
      expect(order).toEqual(['commit', 'flush-bumps']);
      expect(permissionsCacheService.executeBumps).toHaveBeenCalledWith([
        { kind: 'instance' },
        { kind: 'user', userId: mockAdmin.id },
        { kind: 'instance' },
      ]);
    });

    it('does not flush epoch bumps when the setup transaction rolls back', async () => {
      const dto: SetupInstanceDto = {
        ...validSetupDto,
        createDefaultCommunity: false,
      };

      mockDatabase.$transaction.mockImplementation((callback: any) => {
        const mockTx = createMockDatabase();
        mockTx.user.count.mockResolvedValue(0);
        mockTx.instanceInvite.count.mockResolvedValue(0);
        mockTx.user.create.mockResolvedValue(mockAdmin);
        mockTx.instanceInvite.create.mockResolvedValue(mockInvite);
        return callback(mockTx);
      });
      instanceRolesService.createDefaultInstanceRole.mockRejectedValue(
        new Error('instance role creation failed'),
      );

      await expect(service.completeSetup(dto, 'valid-token')).rejects.toThrow(
        'instance role creation failed',
      );

      expect(permissionsCacheService.executeBumps).not.toHaveBeenCalled();
    });

    it('should use default community name if not provided', async () => {
      const dtoWithoutName: SetupInstanceDto = {
        ...validSetupDto,
        defaultCommunityName: undefined,
      };

      const result = await service.completeSetup(dtoWithoutName, 'valid-token');

      expect(result.defaultCommunity?.name).toBe('General');
    });
  });

  describe('getStatus', () => {
    it('never returns the setup token by default, and says one is required', async () => {
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      mockRedis.get.mockResolvedValue(null);

      const status = await service.getStatus();

      expect(status.needsSetup).toBe(true);
      expect(status.hasUsers).toBe(false);
      expect(status.setupTokenRequired).toBe(true);
      expect(status).not.toHaveProperty('setupToken');
      // The token still exists (it is in the logs) for the wizard to check
      expect(mockRedis.set).toHaveBeenCalledWith(
        'onboarding:setup-token',
        'mock-uuid-123',
        'NX',
      );
    });

    it('returns the token as before when REQUIRE_SETUP_TOKEN=false', async () => {
      process.env.REQUIRE_SETUP_TOKEN = 'false';
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      mockRedis.get.mockResolvedValue(null);

      const status = await service.getStatus();

      expect(status.needsSetup).toBe(true);
      expect(status.setupTokenRequired).toBe(false);
      expect(status.setupToken).toBe('mock-uuid-123');
    });

    it('should return needsSetup false when users exist', async () => {
      mockDatabase.user.count.mockResolvedValue(1);

      const status = await service.getStatus();

      expect(status.needsSetup).toBe(false);
      expect(status.hasUsers).toBe(true);
      expect(status.setupToken).toBeUndefined();
    });

    it('should not generate token when setup is not needed', async () => {
      mockDatabase.user.count.mockResolvedValue(1);

      await service.getStatus();

      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('onApplicationBootstrap', () => {
    it('logs the existing setup token on every boot while setup is needed', async () => {
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      mockRedis.get.mockResolvedValue('existing-token');
      const warn = jest.spyOn(service['logger'], 'warn');

      await service.onApplicationBootstrap();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Setup token: existing-token'),
      );
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('logs nothing about a token once setup is done', async () => {
      mockDatabase.user.count.mockResolvedValue(1);
      const warn = jest.spyOn(service['logger'], 'warn');

      await service.onApplicationBootstrap();

      expect(warn).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('points at SETUP_TOKEN without printing it', async () => {
      process.env.SETUP_TOKEN = 'operator-chosen-token-123';
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      const warn = jest.spyOn(service['logger'], 'warn');

      await service.onApplicationBootstrap();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SETUP_TOKEN'));
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('operator-chosen-token-123'),
      );
    });

    it('logs nothing when REQUIRE_SETUP_TOKEN=false', async () => {
      process.env.REQUIRE_SETUP_TOKEN = 'false';
      mockDatabase.user.count.mockResolvedValue(0);
      mockDatabase.instanceInvite.count.mockResolvedValue(0);
      const warn = jest.spyOn(service['logger'], 'warn');

      await service.onApplicationBootstrap();

      expect(warn).not.toHaveBeenCalled();
    });

    it('does not fail the boot when the database is unreachable', async () => {
      mockDatabase.user.count.mockRejectedValue(new Error('db down'));

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });
});
