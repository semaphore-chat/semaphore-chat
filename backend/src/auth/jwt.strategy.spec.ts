import { TestBed } from '@suites/unit';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@/database/database.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { createMockDatabase } from '@/test-utils';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let mockTokenBlacklist: { isBlacklisted: jest.Mock; blacklist: jest.Mock };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret-key';
      return null;
    }),
  };

  beforeEach(async () => {
    mockDatabase = createMockDatabase();
    mockTokenBlacklist = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
      blacklist: jest.fn().mockResolvedValue(undefined),
    };

    const { unit } = await TestBed.solitary(JwtStrategy)
      .mock(ConfigService)
      .final(mockConfigService)
      .mock(DatabaseService)
      .final(mockDatabase)
      .mock(TokenBlacklistService)
      .final(mockTokenBlacklist)
      .compile();

    strategy = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('constructor', () => {
    it('should throw error when JWT_SECRET is not set', () => {
      const badConfigService = {
        get: jest.fn(() => null),
      };

      expect(() => {
        new JwtStrategy(
          badConfigService as any,
          mockDatabase as any,
          mockTokenBlacklist as any,
        );
      }).toThrow('JWT_SECRET not set');
    });

    it('should initialize with JWT_SECRET from config', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith('JWT_SECRET');
      expect(strategy).toBeDefined();
    });
  });

  describe('JWT extractor precedence', () => {
    const getExtractor = (s: JwtStrategy) =>
      (s as any)._jwtFromRequest as (req: any) => string | null;

    it('should prefer Authorization header over cookie', () => {
      const extract = getExtractor(strategy);
      const req = {
        headers: { authorization: 'Bearer header-token' },
        cookies: { access_token: 'cookie-token' },
      };

      expect(extract(req)).toBe('header-token');
    });

    it('should fall back to cookie when no Authorization header', () => {
      const extract = getExtractor(strategy);
      const req = {
        headers: {},
        cookies: { access_token: 'cookie-token' },
      };

      expect(extract(req)).toBe('cookie-token');
    });

    it('should return null when no token source is available', () => {
      const extract = getExtractor(strategy);
      const req = {
        headers: {},
        cookies: {},
      };

      expect(extract(req)).toBeNull();
    });

    it('should not extract query param tokens', () => {
      const extract = getExtractor(strategy);
      const req = {
        headers: {},
        path: '/file/abc123',
        query: { token: 'query-token' },
        cookies: {},
      };

      expect(extract(req)).toBeNull();
    });
  });

  describe('validate', () => {
    it('should validate JWT payload and return user', async () => {
      const payload = {
        sub: 'user-123',
        username: 'testuser',
      };

      const mockUser = {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
      };

      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(mockUser);

      const result = await strategy.validate(payload);

      expect(result).toEqual(mockUser);
      expect(mockDatabase.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });

    it('should throw error when user not found', async () => {
      const payload = {
        sub: 'non-existent-user',
        username: 'ghost',
      };

      mockDatabase.user.findUniqueOrThrow.mockRejectedValue(
        new Error('User not found'),
      );

      await expect(strategy.validate(payload)).rejects.toThrow(
        'User not found',
      );
    });

    it('should validate multiple different users', async () => {
      const users = [
        { id: 'user-1', username: 'alice', email: 'alice@test.com' },
        { id: 'user-2', username: 'bob', email: 'bob@test.com' },
        { id: 'user-3', username: 'charlie', email: 'charlie@test.com' },
      ];

      for (const user of users) {
        mockDatabase.user.findUniqueOrThrow.mockResolvedValue(user);

        const result = await strategy.validate({
          sub: user.id,
          username: user.username,
        });

        expect(result).toEqual(user);
        expect(mockDatabase.user.findUniqueOrThrow).toHaveBeenCalledWith({
          where: { id: user.id },
        });

        jest.clearAllMocks();
      }
    });

    it('should reject blacklisted tokens', async () => {
      const payload = {
        sub: 'user-123',
        username: 'testuser',
        jti: 'blacklisted-jti',
      };

      mockTokenBlacklist.isBlacklisted.mockResolvedValue(true);

      await expect(strategy.validate(payload)).rejects.toThrow(
        'Token has been revoked',
      );
      expect(mockTokenBlacklist.isBlacklisted).toHaveBeenCalledWith(
        'blacklisted-jti',
      );
    });

    it('should allow tokens that are not blacklisted', async () => {
      const payload = {
        sub: 'user-123',
        username: 'testuser',
        jti: 'valid-jti',
      };

      const mockUser = {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com',
      };

      mockTokenBlacklist.isBlacklisted.mockResolvedValue(false);
      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(mockUser);

      const result = await strategy.validate(payload);
      expect(result).toEqual(mockUser);
    });

    it('should handle payload with only sub field', async () => {
      const payload = {
        sub: 'user-456',
        username: 'anyname',
      };

      const mockUser = {
        id: 'user-456',
        username: 'actualname',
        email: 'actual@test.com',
      };

      mockDatabase.user.findUniqueOrThrow.mockResolvedValue(mockUser);

      const result = await strategy.validate(payload);

      // Should return actual user data from DB, not payload username
      expect(result.username).toBe('actualname');
      expect(result.id).toBe('user-456');
    });
  });
});
