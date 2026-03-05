import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { AuthService } from './auth.service';
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

      expect(result).toBe(mockRefreshToken);
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

    it('should delete existing sessions for same device on fresh login (no familyId)', async () => {
      const userId = 'user-123';
      const deviceInfo = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', ipAddress: '1.2.3.4' };

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
      const deviceInfo = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', ipAddress: '1.2.3.4' };

      jest.spyOn(jwtService, 'sign').mockReturnValue('mock-refresh-token');
      mockBcrypt.hash.mockResolvedValue('hashed-token' as never);
      mockDatabase.refreshToken.create.mockResolvedValue({
        id: 'token-id',
        userId,
        tokenHash: 'hashed-token',
      });

      await service.generateRefreshToken(userId, deviceInfo, undefined, 'existing-family-id');

      expect(mockDatabase.refreshToken.deleteMany).not.toHaveBeenCalled();
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
      });
      jest.spyOn(userService, 'findById').mockResolvedValue(mockUser);

      const [user, returnedJti] =
        await service.verifyRefreshToken(refreshToken);

      expect(user).toBeInstanceOf(UserEntity);
      expect(user.id).toBe(mockUser.id);
      expect(returnedJti).toBe(jti);
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
    it('should mark token as consumed and return token record', async () => {
      const jti = 'token-jti-123';
      const refreshToken = 'valid-token';
      const mockToken = RefreshTokenFactory.build({
        id: jti,
        familyId: 'family-1',
      });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockDatabase.refreshToken.update.mockResolvedValue(mockToken);

      const result = await service.consumeRefreshToken(jti, refreshToken);

      expect(mockDatabase.refreshToken.update).toHaveBeenCalledWith({
        where: { id: jti },
        data: { consumed: true, consumedAt: expect.any(Date) },
      });
      expect(result).toEqual(mockToken);
    });

    it('should throw UnauthorizedException when token not found', async () => {
      mockDatabase.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.consumeRefreshToken('nonexistent', 'token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockDatabase.refreshToken.update).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when token hash does not match', async () => {
      const jti = 'token-jti-123';
      const mockToken = RefreshTokenFactory.build({ id: jti });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(false as never);

      await expect(
        service.consumeRefreshToken(jti, 'wrong-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockDatabase.refreshToken.update).not.toHaveBeenCalled();
    });

    it('should use transaction client when provided', async () => {
      const mockTx = createMockDatabase();
      const jti = 'token-jti-123';
      const mockToken = RefreshTokenFactory.build({ id: jti });

      mockTx.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockTx.refreshToken.update.mockResolvedValue(mockToken);

      await service.consumeRefreshToken(
        jti,
        'token',
        mockTx as unknown as Parameters<typeof service.consumeRefreshToken>[2],
      );

      expect(mockTx.refreshToken.update).toHaveBeenCalled();
      expect(mockDatabase.refreshToken.update).not.toHaveBeenCalled();
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

      await service.deleteRefreshToken(jti, refreshToken);

      expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          familyId: 'family-1',
        },
      });
    });

    it('should delete single token when no familyId', async () => {
      const jti = 'token-jti-123';
      const refreshToken = 'valid-token';
      const mockToken = RefreshTokenFactory.build({ id: jti, familyId: null });

      mockDatabase.refreshToken.findUnique.mockResolvedValue(mockToken);
      mockBcrypt.compare.mockResolvedValue(true as never);
      mockDatabase.refreshToken.delete.mockResolvedValue(mockToken);

      await service.deleteRefreshToken(jti, refreshToken);

      expect(mockDatabase.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: jti },
      });
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
