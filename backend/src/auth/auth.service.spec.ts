import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { AuthService, SESSION_ACTIVITY_DELAY_MS } from './auth.service';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@/database/database.service';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  UserFactory,
  RefreshTokenFactory,
  createMockDatabase,
  createMockJwtService,
  createMockConfigService,
} from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';
import { SessionRevocationService } from './session-revocation.service';
import {
  REFRESH_TOKEN_REUSE_GRACE_MS,
  RefreshTokenGraceService,
} from './refresh-token-grace.service';

// Mock bcrypt — hashSync must return a value so the DUMMY_HASH class property initializes
jest.mock('bcrypt', () => ({
  ...jest.requireActual('bcrypt'),
  compare: jest.fn(),
  hash: jest.fn(),
  hashSync: jest.fn(() => '$2b$10$dummy-hash-for-timing-attack-prevention'),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userService: Mocked<UserService>;
  let jwtService: Mocked<JwtService>;
  let sessionRevocationService: Mocked<SessionRevocationService>;
  let refreshTokenGraceService: Mocked<RefreshTokenGraceService>;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();
    const mockJwtService = createMockJwtService();

    const { unit, unitRef } = await TestBed.solitary(AuthService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .mock(JwtService)
      .final(mockJwtService)
      .mock(ConfigService)
      .final(
        createMockConfigService({
          JWT_REFRESH_SECRET: 'test-refresh-secret',
        }),
      )
      .compile();

    service = unit;
    userService = unitRef.get(UserService);
    sessionRevocationService = unitRef.get(SessionRevocationService);
    refreshTokenGraceService = unitRef.get(RefreshTokenGraceService);
    jwtService = mockJwtService as unknown as Mocked<JwtService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw error if JWT_REFRESH_SECRET is not set', () => {
      expect(() => {
        new AuthService(
          userService as unknown as UserService,
          jwtService as unknown as JwtService,
          mockDatabase as unknown as DatabaseService,
          createMockConfigService({
            JWT_REFRESH_SECRET: undefined,
          }) as unknown as ConfigService,
          sessionRevocationService as unknown as SessionRevocationService,
          refreshTokenGraceService as unknown as RefreshTokenGraceService,
        );
      }).toThrow('JWT_REFRESH_SECRET not set');
    });
  });

  describe('validateUser', () => {
    it('should return user entity when credentials are valid', async () => {
      const mockUser = UserFactory.build({
        username: 'testuser',
        hashedPassword: 'hashed-password',
      });

      jest.spyOn(userService, 'findByUsername').mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validateUser('TestUser', 'correct-password');

      expect(result).toBeInstanceOf(UserEntity);
      expect(result?.username).toBe(mockUser.username);
      expect(userService.findByUsername).toHaveBeenCalledWith('testuser');
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'correct-password',
        mockUser.hashedPassword,
      );
    });

    it('should return null when user is not found and still run bcrypt for timing parity', async () => {
      jest.spyOn(userService, 'findByUsername').mockResolvedValue(null);
      mockBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateUser('nonexistent', 'password');

      expect(result).toBeNull();
      // bcrypt.compare must still be called against a dummy hash to prevent timing-based user enumeration
      // The hash is dynamically generated at construction time, so we only verify the call shape
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password',
        expect.anything(),
      );
    });

    it('should return null when password is incorrect', async () => {
      const mockUser = UserFactory.build({
        username: 'testuser',
        hashedPassword: 'hashed-password',
      });

      jest.spyOn(userService, 'findByUsername').mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateUser('testuser', 'wrong-password');

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'wrong-password',
        mockUser.hashedPassword,
      );
    });

    it('should convert username to lowercase before querying', async () => {
      const mockUser = UserFactory.build({ username: 'testuser' });

      jest.spyOn(userService, 'findByUsername').mockResolvedValue(mockUser);
      mockBcrypt.compare.mockResolvedValue(true as never);

      await service.validateUser('TESTUSER', 'password');

      expect(userService.findByUsername).toHaveBeenCalledWith('testuser');
    });
  });

  describe('login', () => {
    it('should generate JWT token with correct payload', () => {
      const user = new UserEntity(UserFactory.build());
      const mockToken = 'mock-jwt-token';

      jest.spyOn(jwtService, 'sign').mockReturnValue(mockToken);

      const result = service.login(user);

      expect(result).toBe(mockToken);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          username: user.username,
          sub: user.id,
          role: user.role,
          jti: expect.any(String),
        }),
      );
      expect(jwtService.sign.mock.calls[0][0]).not.toHaveProperty('sid');
    });

    it('should carry the session id as the sid claim', () => {
      const user = new UserEntity(UserFactory.build());
      jest.spyOn(jwtService, 'sign').mockReturnValue('mock-jwt-token');

      service.login(user, 'session-1');

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, sid: 'session-1' }),
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate refresh token and store hash in database', async () => {
      const userId = 'user-123';
      const mockRefreshToken = 'mock-refresh-token';
      const mockHash = 'hashed-token';

      jest.spyOn(jwtService, 'sign').mockReturnValue(mockRefreshToken);
      mockBcrypt.hash.mockResolvedValue(mockHash as never);
      mockDatabase.refreshToken.create.mockResolvedValue({
        id: 'token-id',
        userId,
        tokenHash: mockHash,
      });

      const result = await service.generateRefreshToken(userId);

      // A fresh login starts a new session (refresh token family)
      expect(result).toEqual({
        refreshToken: mockRefreshToken,
        sessionId: expect.any(String),
      });
      expect(mockDatabase.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ familyId: result.sessionId }),
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: userId }),
        expect.objectContaining({
          secret: 'test-refresh-secret',
          expiresIn: '30d',
        }),
      );
      expect(bcrypt.hash).toHaveBeenCalledWith(mockRefreshToken, 10);
      expect(mockDatabase.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('should use transaction client when provided', async () => {
      const userId = 'user-123';
      const mockTx = createMockDatabase();
      const mockRefreshToken = 'mock-refresh-token';
      const mockHash = 'hashed-token';

      jest.spyOn(jwtService, 'sign').mockReturnValue(mockRefreshToken);
      mockBcrypt.hash.mockResolvedValue(mockHash as never);
      mockTx.refreshToken.create.mockResolvedValue({
        id: 'token-id',
        userId,
        tokenHash: mockHash,
      });

      await service.generateRefreshToken(
        userId,
        undefined, // deviceInfo
        mockTx as unknown as Parameters<typeof service.generateRefreshToken>[2],
      );

      expect(mockTx.refreshToken.create).toHaveBeenCalled();
      expect(mockDatabase.refreshToken.create).not.toHaveBeenCalled();
    });

    it('stores a token prepared ahead without signing or hashing again', async () => {
      mockDatabase.refreshToken.create.mockResolvedValue({});

      const result = await service.generateRefreshToken(
        'user-123',
        undefined,
        undefined,
        'family-1',
        { id: 'jti-9', refreshToken: 'prepared-token', tokenHash: 'hash-9' },
      );

      expect(result).toEqual({
        refreshToken: 'prepared-token',
        sessionId: 'family-1',
      });
      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockDatabase.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'jti-9',
          tokenHash: 'hash-9',
          familyId: 'family-1',
        }),
      });
    });

    it('should delete existing sessions for same device on fresh login (no familyId)', async () => {
      const userId = 'user-123';
      const deviceInfo = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        ipAddress: '1.2.3.4',
      };

      jest.spyOn(jwtService, 'sign').mockReturnValue('mock-refresh-token');
      mockBcrypt.hash.mockResolvedValue('hashed-token' as never);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
      mockDatabase.refreshToken.create.mockResolvedValue({
        id: 'token-id',
        userId,
        tokenHash: 'hashed-token',
      });

      await service.generateRefreshToken(userId, deviceInfo);

      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId, deviceName: 'Chrome on Windows', consumed: false },
      });
    });

    it('should NOT delete existing sessions when familyId is provided (token rotation)', async () => {
      const userId = 'user-123';
      const deviceInfo = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        ipAddress: '1.2.3.4',
      };

      jest.spyOn(jwtService, 'sign').mockReturnValue('mock-refresh-token');
      mockBcrypt.hash.mockResolvedValue('hashed-token' as never);
      mockDatabase.refreshToken.create.mockResolvedValue({
        id: 'token-id',
        userId,
        tokenHash: 'hashed-token',
      });

      const result = await service.generateRefreshToken(
        userId,
        deviceInfo,
        undefined,
        'existing-family-id',
      );

      expect(mockDatabase.refreshToken.deleteMany).not.toHaveBeenCalled();
      // Rotation stays in the session
      expect(result.sessionId).toBe('existing-family-id');
    });

    it('should generate unique jti for each token', async () => {
      const userId = 'user-123';
      const calls: Array<{ sub: string; jti: string }> = [];

      jest
        .spyOn(jwtService, 'sign')
        .mockImplementation((payload: { sub: string; jti: string }) => {
          calls.push(payload);
          return 'mock-token';
        });
      mockBcrypt.hash.mockResolvedValue('hash' as never);
      mockDatabase.refreshToken.create.mockResolvedValue({
        id: 'id',
        userId,
        tokenHash: 'hash',
        expiresAt: new Date(),
      });

      await service.generateRefreshToken(userId);
      await service.generateRefreshToken(userId);

      expect(calls[0]?.jti).toBeDefined();
      expect(calls[1]?.jti).toBeDefined();
      expect(calls[0]?.jti).not.toBe(calls[1]?.jti);
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify valid refresh token and return user with jti', async () => {
      const mockUser = UserFactory.build();
      const jti = 'token-jti-123';
      const refreshToken = 'valid-refresh-token';

      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: mockUser.id,
        jti,
        iat: 1_700_000_000,
      });
      jest.spyOn(userService, 'findById').mockResolvedValue(mockUser);

      const [user, returnedJti, issuedAt] =
        await service.verifyRefreshToken(refreshToken);

      expect(user).toBeInstanceOf(UserEntity);
      expect(user.id).toBe(mockUser.id);
      expect(returnedJti).toBe(jti);
      // Refresh checks the session's revocation against it
      expect(issuedAt).toBe(1_700_000_000);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(refreshToken, {
        secret: 'test-refresh-secret',
        ignoreExpiration: false,
      });
    });

    it('should throw UnauthorizedException when token verification fails', async () => {
      jest
        .spyOn(jwtService, 'verifyAsync')
        .mockResolvedValue(
          undefined as unknown as { sub: string; jti: string },
        );

      await expect(service.verifyRefreshToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user not found', async () => {
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: 'nonexistent-user-id',
        jti: 'jti-123',
      });
      jest.spyOn(userService, 'findById').mockResolvedValue(null);

      await expect(service.verifyRefreshToken('valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('validateRefreshToken', () => {
    it('should return full token record when token is valid and not expired', async () => {
      const jti = 'token-jti-123';
      const refreshToken = 'valid-token';
      const mockToken = RefreshTokenFactory.build({
        id: jti,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
      });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validateRefreshToken(jti, refreshToken);

      expect(result).toEqual(mockToken);
      expect(mockDatabase.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { id: jti },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        refreshToken,
        mockToken.tokenHash,
      );
    });

    it('should return null when token is expired', async () => {
      const jti = 'expired-token-jti';
      const refreshToken = 'expired-token';
      const mockToken = RefreshTokenFactory.buildExpired({ id: jti });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validateRefreshToken(jti, refreshToken);

      expect(result).toBeNull();
    });

    it('should return null when token not found in database', async () => {
      mockDatabase.refreshToken.findUnique.mockResolvedValue(null);
      mockBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateRefreshToken('nonexistent', 'token');

      expect(result).toBeNull();
      // bcrypt.compare should still be called with dummy hash to prevent timing attacks
      expect(bcrypt.compare).toHaveBeenCalled();
    });

    it('should always call bcrypt.compare to prevent timing attacks (token exists)', async () => {
      const jti = 'existing-token';
      const mockToken = RefreshTokenFactory.build({ id: jti });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);

      await service.validateRefreshToken(jti, 'token');

      expect(bcrypt.compare).toHaveBeenCalledWith('token', mockToken.tokenHash);
    });

    it('should always call bcrypt.compare to prevent timing attacks (token missing)', async () => {
      mockDatabase.refreshToken.findUnique.mockResolvedValue(null);
      mockBcrypt.compare.mockResolvedValue(false as never);

      await service.validateRefreshToken('nonexistent', 'token');

      // Should compare against dummy hash when token not found
      // The hash is dynamically generated at construction time, so we only verify the call shape
      expect(bcrypt.compare).toHaveBeenCalledWith('token', expect.anything());
    });

    it('should return null when token hash does not match', async () => {
      const jti = 'token-jti-123';
      const refreshToken = 'wrong-token';
      const mockToken = RefreshTokenFactory.build({ id: jti });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateRefreshToken(jti, refreshToken);

      expect(result).toBeNull();
    });
  });

  describe('consumeRefreshToken', () => {
    it("marks the token consumed at the database's time and returns it", async () => {
      const dbNow = new Date('2030-01-01T00:00:00.000Z');
      const consumed = RefreshTokenFactory.build({
        id: 'token-jti-123',
        familyId: 'family-1',
        consumed: true,
        consumedAt: dbNow,
      });
      mockDatabase.$queryRaw.mockResolvedValue([{ now: dbNow }]);
      mockDatabase.refreshToken.update.mockResolvedValue(consumed);

      const result = await service.consumeRefreshToken(
        'token-jti-123',
        mockDatabase as any,
      );

      const [strings] = mockDatabase.$queryRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toMatch(/clock_timestamp\(\)/);
      expect(mockDatabase.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'token-jti-123' },
        data: { consumed: true, consumedAt: dbNow },
      });
      expect(result).toEqual(consumed);
      // Validated before the transaction: no bcrypt under the locks
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });

  describe('reloadRefreshToken', () => {
    it('reads the token again, without bcrypt', async () => {
      const token = RefreshTokenFactory.build({ id: 'jti-1' });
      mockDatabase.refreshToken.findUnique.mockResolvedValue(token);

      await expect(
        service.reloadRefreshToken('jti-1', mockDatabase as any),
      ).resolves.toEqual(token);
      expect(mockDatabase.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { id: 'jti-1' },
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it.each([
      ['gone', null],
      [
        'expired',
        RefreshTokenFactory.build({ expiresAt: new Date(Date.now() - 1000) }),
      ],
    ])('returns null when it is %s', async (_, token) => {
      mockDatabase.refreshToken.findUnique.mockResolvedValue(token);

      await expect(
        service.reloadRefreshToken('jti-1', mockDatabase as any),
      ).resolves.toBeNull();
    });
  });

  describe('deleteRefreshToken', () => {
    it('should delete all tokens in the family when familyId exists', async () => {
      const jti = 'token-jti-123';
      const refreshToken = 'valid-token';
      const mockToken = RefreshTokenFactory.build({
        id: jti,
        familyId: 'family-1',
      });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      const sessionId = await service.deleteRefreshToken(jti, refreshToken);

      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          familyId: 'family-1',
        },
      });
      expect(sessionId).toBe('family-1');
    });

    it('should delete single token when no familyId', async () => {
      const jti = 'token-jti-123';
      const refreshToken = 'valid-token';
      const mockToken = RefreshTokenFactory.build({ id: jti, familyId: null });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockDatabase.refreshToken.delete.mockResolvedValue(mockToken);

      const sessionId = await service.deleteRefreshToken(jti, refreshToken);

      expect(mockDatabase.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: jti },
      });
      expect(sessionId).toBeNull();
    });

    it('should throw UnauthorizedException when token not found', async () => {
      mockDatabase.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteRefreshToken('nonexistent', 'token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should use transaction client when provided', async () => {
      const mockTx = createMockDatabase();
      const jti = 'token-jti-123';
      const mockToken = RefreshTokenFactory.build({
        id: jti,
        familyId: 'family-1',
      });

      mockTx.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockTx.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.deleteRefreshToken(
        jti,
        'token',
        mockTx as unknown as Parameters<typeof service.deleteRefreshToken>[2],
      );

      expect(mockTx.refreshToken.deleteMany).toHaveBeenCalled();
      expect(mockDatabase.refreshToken.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('getUserSessions', () => {
    const at = (minutesAgo: number) =>
      new Date(Date.now() - minutesAgo * 60_000);

    it('lists sessions by family, with the activity the delayed query picked', async () => {
      mockDatabase.refreshToken.findMany.mockResolvedValue([
        { id: 'live-a', familyId: 'family-a' },
        { id: 'live-b', familyId: 'family-b' },
      ]);
      mockDatabase.refreshToken.findFirst.mockResolvedValue({
        id: 'consumed-b',
        familyId: 'family-b',
      });
      mockDatabase.$queryRaw.mockResolvedValue([
        {
          familyId: 'family-a',
          deviceName: 'Chrome on Windows',
          ipAddress: '203.0.113.1',
          lastUsedAt: at(30),
          expiresAt: at(-60),
          sessionCreatedAt: at(600),
        },
        {
          familyId: 'family-b',
          deviceName: null,
          ipAddress: null,
          lastUsedAt: at(5),
          expiresAt: at(-60),
          sessionCreatedAt: at(10),
        },
      ]);

      const sessions = await service.getUserSessions('user-1', 'consumed-b');

      expect(sessions).toEqual([
        {
          id: 'family-b',
          deviceName: 'Unknown Device',
          ipAddress: null,
          createdAt: at(10),
          lastUsedAt: at(5),
          expiresAt: at(-60),
          // The current session, also when its cookie was rotated since
          isCurrent: true,
        },
        {
          id: 'family-a',
          deviceName: 'Chrome on Windows',
          ipAddress: '203.0.113.1',
          createdAt: at(600),
          lastUsedAt: at(30),
          expiresAt: at(-60),
          isCurrent: false,
        },
      ]);
      const [strings, ...values] = mockDatabase.$queryRaw.mock.calls[0];
      const sql = (strings as string[]).join('?');
      // Rotations newer than the delay don't show
      expect(sql).toMatch(/DISTINCT ON \(t."familyId"\)/);
      expect(sql).toMatch(/clock_timestamp\(\)/);
      expect(values).toEqual(
        expect.arrayContaining([
          SESSION_ACTIVITY_DELAY_MS / 1000,
          'user-1',
          ['family-a', 'family-b'],
        ]),
      );
      expect(SESSION_ACTIVITY_DELAY_MS).toBeGreaterThan(
        REFRESH_TOKEN_REUSE_GRACE_MS,
      );
    });

    it('lists a token without a family as a session of its own', async () => {
      mockDatabase.refreshToken.findMany.mockResolvedValue([
        {
          id: 'legacy',
          familyId: null,
          deviceName: 'Firefox',
          ipAddress: null,
          createdAt: at(60),
          lastUsedAt: at(60),
          expiresAt: at(-60),
        },
      ]);
      mockDatabase.refreshToken.findFirst.mockResolvedValue({
        id: 'legacy',
        familyId: null,
      });

      const sessions = await service.getUserSessions('user-1', 'legacy');

      expect(sessions).toEqual([
        expect.objectContaining({ id: 'legacy', isCurrent: true }),
      ]);
      expect(mockDatabase.$queryRaw).not.toHaveBeenCalled();
    });

    it('lists nothing without a live token', async () => {
      mockDatabase.refreshToken.findMany.mockResolvedValue([]);

      await expect(service.getUserSessions('user-1')).resolves.toEqual([]);
    });
  });

  describe('revokeSession', () => {
    it('should delete the whole family, revoke the session and disconnect it', async () => {
      mockDatabase.refreshToken.findFirst.mockResolvedValue({
        id: 'token-1',
        familyId: 'family-1',
      });
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.revokeSession('user-1', 'family-1');

      expect(result).toBe(true);
      // By session (family) id, or by a token id as before
      expect(mockDatabase.refreshToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          OR: [{ familyId: 'family-1' }, { id: 'family-1' }],
        },
        select: { id: true, familyId: true },
      });
      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', userId: 'user-1' },
      });
      expect(sessionRevocationService.revokeSessions).toHaveBeenCalledWith(
        'user-1',
        ['family-1'],
        'SESSION_REVOKED',
      );
    });

    it('should lock the user against refreshes before reading the session', async () => {
      mockDatabase.refreshToken.findFirst.mockResolvedValue({
        id: 'token-1',
        familyId: 'family-1',
      });
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeSession('user-1', 'token-1');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      const [strings, userId] = mockDatabase.$queryRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toMatch(/FOR NO KEY UPDATE/);
      expect(userId).toBe('user-1');
      expect(mockDatabase.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockDatabase.refreshToken.findFirst.mock.invocationCallOrder[0],
      );
    });

    it('should delete just the token when it has no family', async () => {
      mockDatabase.refreshToken.findFirst.mockResolvedValue({
        id: 'token-1',
        familyId: null,
      });
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.revokeSession('user-1', 'token-1')).resolves.toBe(
        true,
      );
      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { id: 'token-1', userId: 'user-1' },
      });
      expect(sessionRevocationService.revokeSessions).not.toHaveBeenCalled();
    });

    it("should return false for another user's or an unknown session", async () => {
      mockDatabase.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.revokeSession('user-1', 'token-9')).resolves.toBe(
        false,
      );
      expect(mockDatabase.refreshToken.deleteMany).not.toHaveBeenCalled();
      expect(sessionRevocationService.revokeSessions).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllOtherSessions', () => {
    it('should revoke every other family and keep the current one', async () => {
      mockDatabase.refreshToken.findFirst.mockResolvedValue({
        familyId: 'current-family',
      });
      mockDatabase.refreshToken.findMany.mockResolvedValue([
        { familyId: 'current-family' }, // a consumed token of this session
        { familyId: 'family-a' },
        { familyId: 'family-a' },
        { familyId: 'family-b' },
        { familyId: null },
      ]);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 4 });

      const count = await service.revokeAllOtherSessions(
        'user-1',
        'current-token',
      );

      expect(count).toBe(4);
      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          id: { not: 'current-token' },
          OR: [
            { familyId: { in: ['family-a', 'family-b'] } },
            { familyId: null },
          ],
        },
      });
      expect(sessionRevocationService.revokeSessions).toHaveBeenCalledWith(
        'user-1',
        ['family-a', 'family-b'],
        'SESSION_REVOKED',
      );
    });

    it('should lock the user against refreshes before reading the sessions', async () => {
      mockDatabase.refreshToken.findFirst.mockResolvedValue(null);
      mockDatabase.refreshToken.findMany.mockResolvedValue([]);
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      await service.revokeAllOtherSessions('user-1', 'current-token');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      const [strings, userId] = mockDatabase.$queryRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toMatch(/FOR NO KEY UPDATE/);
      expect(userId).toBe('user-1');
      expect(mockDatabase.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockDatabase.refreshToken.findFirst.mock.invocationCallOrder[0],
      );
    });
  });

  describe('issueLoginTokens', () => {
    const user = new UserEntity(
      UserFactory.build({ hashedPassword: '$2b$10$checked-hash' }),
    );

    /** The SQL of the raw queries run, in order. */
    const rawQueries = () =>
      mockDatabase.$queryRaw.mock.calls.map(([strings]) =>
        (strings as string[]).join('?'),
      );

    const prepared = {
      id: 'jti-1',
      refreshToken: 'new-refresh-token',
      tokenHash: 'hash-1',
    };

    beforeEach(() => {
      jest.spyOn(service, 'prepareRefreshToken').mockResolvedValue(prepared);
      jest.spyOn(service, 'generateRefreshToken').mockResolvedValue({
        refreshToken: 'new-refresh-token',
        sessionId: 'family-1',
      });
      jest.spyOn(service, 'login').mockReturnValue('new-access-token');
    });

    it('issues both tokens when the password is still the one checked', async () => {
      mockDatabase.$queryRaw.mockResolvedValue([
        { hashedPassword: '$2b$10$checked-hash' },
      ]);

      const result = await service.issueLoginTokens(user, {
        userAgent: 'Chrome',
      });

      expect(result).toEqual({
        refreshToken: 'new-refresh-token',
        accessToken: 'new-access-token',
      });
      expect(service.generateRefreshToken).toHaveBeenCalledWith(
        user.id,
        { userAgent: 'Chrome' },
        mockDatabase,
        undefined,
        prepared,
      );
      expect(service.login).toHaveBeenCalledWith(user, 'family-1');
    });

    it('hashes the refresh token before the transaction takes its locks', async () => {
      mockDatabase.$queryRaw.mockResolvedValue([
        { hashedPassword: '$2b$10$checked-hash' },
      ]);

      await service.issueLoginTokens(user, {});

      expect(service.prepareRefreshToken).toHaveBeenCalledWith(user.id);
      expect(
        (service.prepareRefreshToken as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(mockDatabase.$transaction.mock.invocationCallOrder[0]);
    });

    it('locks the user (shared) before it issues anything', async () => {
      mockDatabase.$queryRaw.mockResolvedValue([
        { hashedPassword: '$2b$10$checked-hash' },
      ]);

      await service.issueLoginTokens(user, {});

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      expect(rawQueries()).toEqual([
        expect.stringMatching(
          /SELECT "hashedPassword" FROM "User" WHERE "id" = \? FOR SHARE/,
        ),
      ]);
      expect(mockDatabase.$queryRaw.mock.calls[0][1]).toBe(user.id);
      expect(mockDatabase.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        (service.generateRefreshToken as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it.each([
      [
        'the password was changed since it was checked',
        [{ hashedPassword: '$2b$10$new-hash' }],
      ],
      ['the user is gone', []],
    ])('refuses when %s', async (_, rows) => {
      mockDatabase.$queryRaw.mockResolvedValue(rows);

      await expect(service.issueLoginTokens(user, {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(service.generateRefreshToken).not.toHaveBeenCalled();
      expect(service.login).not.toHaveBeenCalled();
    });

    it('signs the access token before the login commits', async () => {
      // A password reset waiting for the login sets its cutoff after the
      // commit: the access token must be older than that
      mockDatabase.$queryRaw.mockResolvedValue([
        { hashedPassword: '$2b$10$checked-hash' },
      ]);
      let committed = false;
      let committedWhenSigned: boolean | undefined;
      mockDatabase.$transaction.mockImplementation(async (callback: any) => {
        const result = await callback(mockDatabase);
        committed = true;
        return result;
      });
      (service.login as jest.Mock).mockImplementation(() => {
        committedWhenSigned = committed;
        return 'new-access-token';
      });

      await service.issueLoginTokens(user, {});

      expect(committedWhenSigned).toBe(false);
    });
  });

  describe('findGraceSuccessor', () => {
    const consumedAt = new Date();
    const presented = RefreshTokenFactory.build({
      id: 'jti-0',
      userId: 'user-1',
      familyId: 'family-1',
      consumed: true,
      consumedAt,
    });
    // The client that rotated jti-0 (stored on its successor) and asks again
    const client = { ipAddress: '203.0.113.1', userAgent: 'Chrome' };
    const now = new Date();
    const live = RefreshTokenFactory.build({
      id: 'jti-1',
      userId: 'user-1',
      familyId: 'family-1',
      consumed: false,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      ...client,
    });
    const find = (tokenId = 'token-0', from = client) =>
      service.findGraceSuccessor(
        presented,
        tokenId,
        from,
        now,
        mockDatabase as any,
      );

    beforeEach(() => {
      mockDatabase.$queryRaw.mockResolvedValue([]);
      refreshTokenGraceService.isWithinGraceWindow.mockReturnValue(true);
      jwtService.verifyAsync.mockImplementation((token: string) =>
        Promise.resolve({
          sub: 'user-1',
          jti: token.replace('token-', 'jti-'),
          iat: 1_700_000_100,
        }),
      );
    });

    it('returns the token the presented one was rotated to, with its session', async () => {
      refreshTokenGraceService.recall.mockResolvedValue('token-1');
      mockDatabase.refreshToken.findUnique.mockResolvedValue(live);

      await expect(find()).resolves.toEqual({
        kind: 'found',
        refreshToken: 'token-1',
        sessionId: 'family-1',
        iat: 1_700_000_100,
      });
      expect(refreshTokenGraceService.recall).toHaveBeenCalledWith(
        'jti-0',
        'token-0',
      );
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('token-1', {
        secret: 'test-refresh-secret',
      });
      // Locked, so a rotation of the successor in progress finishes first
      const [strings, id] = mockDatabase.$queryRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toMatch(
        /FROM "RefreshToken" WHERE "id" = \? FOR UPDATE/,
      );
      expect(id).toBe('jti-1');
    });

    it('follows later rotations within the window to the live token', async () => {
      refreshTokenGraceService.recall.mockImplementation((jti: string) =>
        Promise.resolve(jti === 'jti-0' ? 'token-1' : 'token-2'),
      );
      mockDatabase.refreshToken.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'jti-1'
              ? { ...live, consumed: true, consumedAt: new Date() }
              : { ...live, id: 'jti-2' },
          ),
      );

      await expect(find()).resolves.toMatchObject({
        kind: 'found',
        refreshToken: 'token-2',
      });
      expect(refreshTokenGraceService.isWithinGraceWindow).toHaveBeenCalledWith(
        expect.any(Date),
        now,
      );
      expect(refreshTokenGraceService.recall).toHaveBeenLastCalledWith(
        'jti-1',
        'token-1',
      );
    });

    it.each([
      [
        'nothing is remembered for it',
        () => {
          refreshTokenGraceService.recall.mockResolvedValue(null);
        },
      ],
      [
        'the successor is gone (revoked)',
        () => {
          refreshTokenGraceService.recall.mockResolvedValue('token-1');
          mockDatabase.refreshToken.findUnique.mockResolvedValue(null);
        },
      ],
      [
        'the successor has expired',
        () => {
          refreshTokenGraceService.recall.mockResolvedValue('token-1');
          mockDatabase.refreshToken.findUnique.mockResolvedValue({
            ...live,
            expiresAt: new Date(Date.now() - 1000),
          });
        },
      ],
      [
        'the successor belongs to another session',
        () => {
          refreshTokenGraceService.recall.mockResolvedValue('token-1');
          mockDatabase.refreshToken.findUnique.mockResolvedValue({
            ...live,
            familyId: 'family-2',
          });
        },
      ],
      [
        'the successor is not a valid refresh token',
        () => {
          refreshTokenGraceService.recall.mockResolvedValue('token-1');
          jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
        },
      ],
      [
        'the successor was itself rotated outside the window',
        () => {
          refreshTokenGraceService.recall.mockResolvedValue('token-1');
          mockDatabase.refreshToken.findUnique.mockResolvedValue({
            ...live,
            consumed: true,
            consumedAt: new Date(Date.now() - 60_000),
          });
          refreshTokenGraceService.isWithinGraceWindow.mockReturnValue(false);
        },
      ],
    ])('finds none when %s', async (_, arrange) => {
      arrange();

      await expect(find()).resolves.toEqual({ kind: 'none' });
    });

    it.each([
      ['another IP address', { ...client, ipAddress: '198.51.100.7' }],
      ['another user agent', { ...client, userAgent: 'Firefox' }],
      ['no address', { ...client, ipAddress: '' }],
    ])(
      'refuses a client with %s than the rotation (a stolen token)',
      async (_, other) => {
        refreshTokenGraceService.recall.mockResolvedValue('token-1');
        mockDatabase.refreshToken.findUnique.mockResolvedValue(live);

        await expect(find('token-0', other)).resolves.toEqual({
          kind: 'other-client',
        });
      },
    );

    it('refuses a client that did not do a later rotation of the chain', async () => {
      refreshTokenGraceService.recall.mockImplementation((jti: string) =>
        Promise.resolve(jti === 'jti-0' ? 'token-1' : 'token-2'),
      );
      mockDatabase.refreshToken.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'jti-1'
              ? { ...live, consumed: true, consumedAt: new Date() }
              : { ...live, id: 'jti-2', ipAddress: '198.51.100.7' },
          ),
      );

      await expect(find()).resolves.toEqual({ kind: 'other-client' });
    });

    it('serves the same client from another address of its IPv6 /64', async () => {
      refreshTokenGraceService.recall.mockResolvedValue('token-1');
      mockDatabase.refreshToken.findUnique.mockResolvedValue({
        ...live,
        ipAddress: '2001:db8:5:6::10',
      });

      await expect(
        find('token-0', { ...client, ipAddress: '2001:db8:5:6:a:b:c:d' }),
      ).resolves.toMatchObject({ kind: 'found' });
    });

    it('gives up on an endless chain', async () => {
      refreshTokenGraceService.recall.mockResolvedValue('token-1');
      mockDatabase.refreshToken.findUnique.mockResolvedValue({
        ...live,
        consumed: true,
        consumedAt: new Date(),
      });

      await expect(find()).resolves.toEqual({ kind: 'none' });
    });
  });

  describe('revokeReusedSession', () => {
    it('deletes the session under the revocation lock, then revokes it and disconnects its sockets', async () => {
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.revokeReusedSession('user-1', 'family-1');

      expect(mockDatabase.$transaction).toHaveBeenCalled();
      const [strings, userId] = mockDatabase.$queryRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toMatch(/FOR NO KEY UPDATE/);
      expect(userId).toBe('user-1');
      expect(mockDatabase.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockDatabase.refreshToken.deleteMany.mock.invocationCallOrder[0],
      );
      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', userId: 'user-1' },
      });
      expect(sessionRevocationService.revokeSessions).toHaveBeenCalledWith(
        'user-1',
        ['family-1'],
        'SESSION_REVOKED',
      );
      expect(
        mockDatabase.refreshToken.deleteMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        sessionRevocationService.revokeSessions.mock.invocationCallOrder[0],
      );
    });
  });

  describe('invalidateTokenFamily', () => {
    it('should delete all tokens in the family', async () => {
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.invalidateTokenFamily('family-1');

      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1' },
      });
      expect(result).toBe(3);
    });

    it('should use transaction client when provided', async () => {
      const mockTx = createMockDatabase();
      mockTx.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.invalidateTokenFamily(
        'family-1',
        mockTx as unknown as Parameters<
          typeof service.invalidateTokenFamily
        >[1],
      );

      expect(mockTx.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1' },
      });
      expect(result).toBe(2);
      expect(mockDatabase.refreshToken.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('cleanExpiredTokens', () => {
    it('should delete expired and old consumed tokens and log counts', async () => {
      mockDatabase.refreshToken.deleteMany
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 3 });

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.cleanExpiredTokens();

      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledTimes(2);
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('5 expired'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('3 consumed'),
      );
    });

    it('should handle zero expired and consumed tokens', async () => {
      mockDatabase.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.cleanExpiredTokens();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('0 expired'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('0 consumed'),
      );
    });
  });
});
