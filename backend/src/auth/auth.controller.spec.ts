import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { DatabaseService } from '@/database/database.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { UserFactory, createMockDatabase } from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Mocked<AuthService>;
  let tokenBlacklistService: Mocked<TokenBlacklistService>;
  let jwtService: Mocked<JwtService>;
  let mockDatabase: ReturnType<typeof createMockDatabase>;

  const mockUser = new UserEntity(UserFactory.build());
  const mockAccessToken = 'mock-access-token';
  const mockRefreshToken = 'mock-refresh-token';

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    const { unit, unitRef } = await TestBed.solitary(AuthController)
      .mock(DatabaseService)
      .final(mockDatabase)
      .compile();

    controller = unit;
    authService = unitRef.get(AuthService);
    tokenBlacklistService = unitRef.get(TokenBlacklistService);
    jwtService = unitRef.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    const mockReq = {
      user: mockUser,
      headers: {},
    } as any;

    const mockRes = {
      cookie: jest.fn(),
    } as any;

    beforeEach(() => {
      jest.spyOn(authService, 'login').mockReturnValue(mockAccessToken);
      jest
        .spyOn(authService, 'generateRefreshToken')
        .mockResolvedValue(mockRefreshToken);
    });

    it('should login web client and return only accessToken', async () => {
      const req = { ...mockReq, headers: { 'user-agent': 'Mozilla/5.0' } };
      const result = await controller.login(req, mockRes);

      expect(authService.login).toHaveBeenCalledWith(mockUser);
      expect(authService.generateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ userAgent: 'Mozilla/5.0' }),
      );
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refresh_token',
        mockRefreshToken,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
        }),
      );
      expect(result).toEqual({ accessToken: mockAccessToken });
      expect(result).not.toHaveProperty('refreshToken');
    });

    it('should login Electron client and return both tokens', async () => {
      const req = {
        ...mockReq,
        headers: { 'user-agent': 'Electron/25.0.0' },
      };
      const result = await controller.login(req, mockRes);

      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: mockRefreshToken,
      });
      expect(mockRes.cookie).toHaveBeenCalled();
    });

    it('should set refresh token cookie with correct options', async () => {
      await controller.login(mockReq, mockRes);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refresh_token',
        mockRefreshToken,
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 30 * 24 * 60 * 60 * 1000,
          path: '/',
        }),
      );
    });

    it('should generate refresh token for the correct user', async () => {
      await controller.login(mockReq, mockRes);

      expect(authService.generateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(Object),
      );
    });
  });

  describe('refresh', () => {
    const mockReq = {
      headers: {},
      cookies: {},
      body: {},
    } as any;

    const mockRes = {
      cookie: jest.fn(),
    } as any;

    const jti = 'token-id-123';
    const newRefreshToken = 'new-refresh-token';

    const mockTokenRecord = {
      id: jti,
      userId: mockUser.id,
      tokenHash: 'hashed',
      familyId: 'family-123',
      consumed: false,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      lastUsedAt: new Date(),
      deviceName: 'Chrome',
      userAgent: null,
      ipAddress: null,
    };

    beforeEach(() => {
      jest
        .spyOn(authService, 'verifyRefreshToken')
        .mockResolvedValue([mockUser, jti]);
      jest.spyOn(authService, 'login').mockReturnValue(mockAccessToken);
      mockDatabase.$transaction.mockImplementation((callback: any) => {
        return callback(mockDatabase);
      });
      jest
        .spyOn(authService, 'validateRefreshToken')
        .mockResolvedValue(mockTokenRecord);
      jest
        .spyOn(authService, 'consumeRefreshToken')
        .mockResolvedValue(mockTokenRecord);
      jest
        .spyOn(authService, 'generateRefreshToken')
        .mockResolvedValue(newRefreshToken);
    });

    it('should refresh tokens from cookie for web client', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
        headers: { 'user-agent': 'Mozilla/5.0' },
      };

      const result = await controller.refresh(req, mockRes);

      expect(authService.verifyRefreshToken).toHaveBeenCalledWith(
        mockRefreshToken,
      );
      expect(authService.validateRefreshToken).toHaveBeenCalledWith(
        jti,
        mockRefreshToken,
        mockDatabase,
      );
      expect(authService.consumeRefreshToken).toHaveBeenCalledWith(
        jti,
        mockRefreshToken,
        mockDatabase,
      );
      expect(authService.generateRefreshToken).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ userAgent: 'Mozilla/5.0' }),
        mockDatabase,
        'family-123',
      );
      expect(result).toEqual({ accessToken: mockAccessToken });
    });

    it('should refresh tokens from body for Electron client', async () => {
      const req = {
        ...mockReq,
        headers: { 'user-agent': 'Electron/25.0.0' },
        body: { refreshToken: mockRefreshToken },
      };

      const result = await controller.refresh(req, mockRes);

      expect(authService.verifyRefreshToken).toHaveBeenCalledWith(
        mockRefreshToken,
      );
      expect(result).toEqual({
        accessToken: mockAccessToken,
        refreshToken: newRefreshToken,
      });
    });

    it('should throw UnauthorizedException when no refresh token provided', async () => {
      const req = { ...mockReq };

      await expect(controller.refresh(req, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.refresh(req, mockRes)).rejects.toThrow(
        'No refresh token provided',
      );
    });

    it('should throw when refresh token is invalid', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: 'invalid-token' },
      };

      jest.spyOn(authService, 'validateRefreshToken').mockResolvedValue(null);

      await expect(controller.refresh(req, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.refresh(req, mockRes)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('should use transaction for token rotation', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      await controller.refresh(req, mockRes);

      expect(mockDatabase.$transaction).toHaveBeenCalled();
    });

    it('should set new refresh cookie after refresh', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      await controller.refresh(req, mockRes);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refresh_token',
        newRefreshToken,
        expect.any(Object),
      );
    });

    it('should prefer cookie over body for web clients', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
        body: { refreshToken: 'body-token' },
        headers: { 'user-agent': 'Mozilla/5.0' },
      };

      await controller.refresh(req, mockRes);

      expect(authService.verifyRefreshToken).toHaveBeenCalledWith(
        mockRefreshToken,
      );
    });

    it('should detect reuse and invalidate token family when token is already consumed', async () => {
      const consumedRecord = { ...mockTokenRecord, consumed: true };
      jest
        .spyOn(authService, 'validateRefreshToken')
        .mockResolvedValue(consumedRecord);
      jest.spyOn(authService, 'invalidateTokenFamily').mockResolvedValue(3);

      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      await expect(controller.refresh(req, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.invalidateTokenFamily).toHaveBeenCalledWith(
        'family-123',
        mockDatabase,
      );
    });
  });

  describe('logout', () => {
    const mockReq = {
      cookies: {},
    } as any;

    const mockRes = {
      clearCookie: jest.fn(),
    } as any;

    const jti = 'token-id-123';

    beforeEach(() => {
      mockDatabase.$transaction.mockImplementation((callback: any) => {
        return callback(mockDatabase);
      });
      jest
        .spyOn(authService, 'verifyRefreshToken')
        .mockResolvedValue([mockUser, jti]);
      jest.spyOn(authService, 'deleteRefreshToken').mockResolvedValue();
    });

    it('should logout and clear cookie when refresh token present', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      const result = await controller.logout(req, mockRes);

      expect(authService.verifyRefreshToken).toHaveBeenCalledWith(
        mockRefreshToken,
      );
      expect(authService.deleteRefreshToken).toHaveBeenCalledWith(
        jti,
        mockRefreshToken,
        mockDatabase,
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith('refresh_token');
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('should logout Electron client using refresh token from body', async () => {
      const req = {
        ...mockReq,
        cookies: {},
        body: { refreshToken: mockRefreshToken },
      };

      const result = await controller.logout(req, mockRes);

      expect(authService.deleteRefreshToken).toHaveBeenCalledWith(
        jti,
        mockRefreshToken,
        mockDatabase,
      );
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('should logout successfully when no refresh token present', async () => {
      const req = { ...mockReq, cookies: {} };

      const result = await controller.logout(req, mockRes);

      expect(authService.verifyRefreshToken).not.toHaveBeenCalled();
      // Should still clear access_token cookie even when no refresh token
      expect(mockRes.clearCookie).toHaveBeenCalledWith('access_token', {
        path: '/',
      });
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('should use transaction when removing refresh token', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      await controller.logout(req, mockRes);

      expect(mockDatabase.$transaction).toHaveBeenCalled();
    });

    it('should gracefully handle token verification failure during logout', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: 'invalid-token' },
      };

      jest
        .spyOn(authService, 'verifyRefreshToken')
        .mockRejectedValue(new UnauthorizedException('Invalid token'));

      const result = await controller.logout(req, mockRes);

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(mockRes.clearCookie).toHaveBeenCalledWith('refresh_token');
    });

    it('should blacklist access token from cookie on logout', async () => {
      const mockJti = 'access-token-jti';
      const mockExp = Math.floor(Date.now() / 1000) + 3600;
      const req = {
        ...mockReq,
        cookies: { access_token: mockAccessToken },
        headers: {},
      };

      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        jti: mockJti,
        exp: mockExp,
      });
      jest
        .spyOn(tokenBlacklistService, 'blacklist')
        .mockResolvedValue(undefined);

      await controller.logout(req, mockRes);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(mockAccessToken);
      expect(tokenBlacklistService.blacklist).toHaveBeenCalledWith(
        mockJti,
        mockExp,
      );
    });

    it('should blacklist access token from Authorization header on logout', async () => {
      const mockJti = 'header-token-jti';
      const mockExp = Math.floor(Date.now() / 1000) + 3600;
      const req = {
        ...mockReq,
        cookies: {},
        headers: { authorization: `Bearer ${mockAccessToken}` },
      };

      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        jti: mockJti,
        exp: mockExp,
      });
      jest
        .spyOn(tokenBlacklistService, 'blacklist')
        .mockResolvedValue(undefined);

      await controller.logout(req, mockRes);

      expect(tokenBlacklistService.blacklist).toHaveBeenCalledWith(
        mockJti,
        mockExp,
      );
    });

    it('should not fail logout if access token blacklisting fails', async () => {
      const req = {
        ...mockReq,
        cookies: { access_token: 'expired-or-invalid-token' },
        headers: {},
      };

      jest
        .spyOn(jwtService, 'verifyAsync')
        .mockRejectedValue(new Error('Token expired'));

      const result = await controller.logout(req, mockRes);

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(tokenBlacklistService.blacklist).not.toHaveBeenCalled();
    });

    it('should skip blacklisting when no access token is present', async () => {
      const req = {
        ...mockReq,
        cookies: {},
        headers: {},
      };

      await controller.logout(req, mockRes);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
      expect(tokenBlacklistService.blacklist).not.toHaveBeenCalled();
    });
  });
});
