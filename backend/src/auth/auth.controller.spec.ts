import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { PasswordResetService } from './password-reset.service';
import { SessionRevocationService } from './session-revocation.service';
import { RefreshTokenGraceService } from './refresh-token-grace.service';
import { DatabaseService } from '@/database/database.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { UserFactory, createMockDatabase } from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Mocked<AuthService>;
  let tokenBlacklistService: Mocked<TokenBlacklistService>;
  let jwtService: Mocked<JwtService>;
  let passwordResetService: Mocked<PasswordResetService>;
  let sessionRevocationService: Mocked<SessionRevocationService>;
  let refreshTokenGraceService: Mocked<RefreshTokenGraceService>;
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
    passwordResetService = unitRef.get(PasswordResetService);
    sessionRevocationService = unitRef.get(SessionRevocationService);
    refreshTokenGraceService = unitRef.get(RefreshTokenGraceService);
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
      authService.issueLoginTokens.mockResolvedValue({
        refreshToken: mockRefreshToken,
        accessToken: mockAccessToken,
      });
    });

    it('should login web client and return only accessToken', async () => {
      const req = { ...mockReq, headers: { 'user-agent': 'Mozilla/5.0' } };
      const result = await controller.login(req, mockRes);

      // Issued for the user whose password was checked, serialized with
      // password resets (AuthService.issueLoginTokens)
      expect(authService.issueLoginTokens).toHaveBeenCalledWith(
        mockUser,
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

    it('should set no cookie when the tokens are refused', async () => {
      // The password changed while signing in
      authService.issueLoginTokens.mockRejectedValue(
        new UnauthorizedException(),
      );

      await expect(controller.login(mockReq, mockRes)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRes.cookie).not.toHaveBeenCalled();
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

    const refreshIssuedAt = 1_700_000_000;
    /** Whether the refresh transaction has committed. */
    let committed: boolean;

    /** The SQL of the raw queries run, in order. */
    const rawQueries = () =>
      mockDatabase.$queryRaw.mock.calls.map(([strings]) =>
        (strings as string[]).join('?'),
      );

    beforeEach(() => {
      committed = false;
      jest
        .spyOn(authService, 'verifyRefreshToken')
        .mockResolvedValue([mockUser, jti, refreshIssuedAt]);
      jest.spyOn(authService, 'login').mockReturnValue(mockAccessToken);
      mockDatabase.$transaction.mockImplementation(async (callback: any) => {
        const result = await callback(mockDatabase);
        committed = true;
        return result;
      });
      // The user row lock (session-lock.util)
      mockDatabase.$queryRaw.mockResolvedValue([{ banned: false }]);
      tokenBlacklistService.isRevoked.mockResolvedValue(false);
      jest
        .spyOn(authService, 'validateRefreshToken')
        .mockResolvedValue(mockTokenRecord);
      jest
        .spyOn(authService, 'consumeRefreshToken')
        .mockResolvedValue(mockTokenRecord);
      jest.spyOn(authService, 'generateRefreshToken').mockResolvedValue({
        refreshToken: newRefreshToken,
        sessionId: 'family-123',
      });
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
      // Same session: the new access token keeps the family's session id
      expect(authService.login).toHaveBeenCalledWith(mockUser, 'family-123');
      expect(result).toEqual({ accessToken: mockAccessToken });
    });

    it('should refuse to refresh for a banned user', async () => {
      const bannedUser = new UserEntity(UserFactory.build({ banned: true }));
      jest
        .spyOn(authService, 'verifyRefreshToken')
        .mockResolvedValue([bannedUser, jti]);
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      await expect(controller.refresh(req, mockRes)).rejects.toThrow(
        'Account has been banned',
      );
      expect(authService.consumeRefreshToken).not.toHaveBeenCalled();
      expect(authService.login).not.toHaveBeenCalled();
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

    describe('a token presented again after it was rotated', () => {
      const consumedRecord = {
        ...mockTokenRecord,
        consumed: true,
        consumedAt: new Date(),
      };
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      beforeEach(() => {
        jest
          .spyOn(authService, 'validateRefreshToken')
          .mockResolvedValue(consumedRecord);
      });

      describe('within the grace window (tabs sharing a cookie, a retry)', () => {
        beforeEach(() => {
          refreshTokenGraceService.isWithinGraceWindow.mockReturnValue(true);
          authService.findGraceSuccessor.mockResolvedValue({
            refreshToken: 'successor-token',
            sessionId: 'family-123',
            iat: 1_700_000_100,
          });
        });

        it('returns the token it was rotated to, without rotating again', async () => {
          const result = await controller.refresh(
            { ...req, headers: { 'user-agent': 'Electron/25.0.0' } },
            mockRes,
          );

          expect(
            refreshTokenGraceService.isWithinGraceWindow,
          ).toHaveBeenCalledWith(consumedRecord.consumedAt);
          expect(authService.findGraceSuccessor).toHaveBeenCalledWith(
            consumedRecord,
            mockRefreshToken,
            mockDatabase,
          );
          expect(result).toEqual({
            accessToken: mockAccessToken,
            refreshToken: 'successor-token',
          });
          expect(mockRes.cookie).toHaveBeenCalledWith(
            'refresh_token',
            'successor-token',
            expect.any(Object),
          );
          // Same session, no new refresh token
          expect(authService.login).toHaveBeenCalledWith(
            mockUser,
            'family-123',
          );
          expect(authService.consumeRefreshToken).not.toHaveBeenCalled();
          expect(authService.generateRefreshToken).not.toHaveBeenCalled();
          expect(authService.revokeReusedSession).not.toHaveBeenCalled();
        });

        it('signs the access token before the transaction commits', async () => {
          let committedWhenSigned: boolean | undefined;
          authService.login.mockImplementation(() => {
            committedWhenSigned = committed;
            return mockAccessToken;
          });

          await controller.refresh(req, mockRes);

          expect(committedWhenSigned).toBe(false);
        });

        it('refuses, without ending the session, when there is nothing to hand out', async () => {
          authService.findGraceSuccessor.mockResolvedValue(null);

          await expect(controller.refresh(req, mockRes)).rejects.toThrow(
            'Invalid refresh token',
          );
          expect(authService.login).not.toHaveBeenCalled();
          expect(authService.revokeReusedSession).not.toHaveBeenCalled();
          expect(
            sessionRevocationService.revokeSessions,
          ).not.toHaveBeenCalled();
        });

        it("refuses a revoked session's successor", async () => {
          tokenBlacklistService.isRevoked.mockResolvedValue(true);
          jest.spyOn(authService, 'invalidateTokenFamily').mockResolvedValue(1);

          await expect(controller.refresh(req, mockRes)).rejects.toThrow(
            'Invalid refresh token',
          );
          // Checked against the token it would hand out
          expect(tokenBlacklistService.isRevoked).toHaveBeenCalledWith({
            sub: mockUser.id,
            sid: 'family-123',
            iat: 1_700_000_100,
          });
          expect(authService.login).not.toHaveBeenCalled();
          expect(mockRes.cookie).not.toHaveBeenCalled();
        });
      });

      describe('after the grace window (a stolen token)', () => {
        beforeEach(() => {
          refreshTokenGraceService.isWithinGraceWindow.mockReturnValue(false);
        });

        it('ends the whole session after the transaction', async () => {
          let committedWhenRevoked: boolean | undefined;
          authService.revokeReusedSession.mockImplementation(() => {
            committedWhenRevoked = committed;
            return Promise.resolve();
          });

          await expect(controller.refresh(req, mockRes)).rejects.toThrow(
            UnauthorizedException,
          );

          // Refresh tokens deleted, access tokens revoked and sockets
          // disconnected (AuthService.revokeReusedSession), once the
          // refresh's locks are released
          expect(authService.revokeReusedSession).toHaveBeenCalledWith(
            mockUser.id,
            'family-123',
          );
          expect(committedWhenRevoked).toBe(true);
          expect(authService.findGraceSuccessor).not.toHaveBeenCalled();
          expect(authService.login).not.toHaveBeenCalled();
          expect(mockRes.cookie).not.toHaveBeenCalled();
        });

        it('deletes just the token when it has no session', async () => {
          jest
            .spyOn(authService, 'validateRefreshToken')
            .mockResolvedValue({ ...consumedRecord, familyId: null });

          await expect(controller.refresh(req, mockRes)).rejects.toThrow(
            UnauthorizedException,
          );
          expect(authService.revokeReusedSession).not.toHaveBeenCalled();
          expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
            where: { id: jti },
          });
        });
      });
    });

    describe('racing a revocation', () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      it('locks the user (shared), then the token, before it reads the token', async () => {
        await controller.refresh(req, mockRes);

        expect(rawQueries()).toEqual([
          expect.stringMatching(/FROM "User" WHERE "id" = \? FOR SHARE/),
          // Refreshes with the same token (tabs sharing a cookie) go one at
          // a time
          expect.stringMatching(
            /FROM "RefreshToken" WHERE "id" = \? FOR UPDATE/,
          ),
        ]);
        expect(mockDatabase.$queryRaw.mock.calls[0][1]).toBe(mockUser.id);
        expect(mockDatabase.$queryRaw.mock.calls[1][1]).toBe(jti);
        expect(mockDatabase.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
          authService.validateRefreshToken.mock.invocationCallOrder[0],
        );
      });

      it('remembers the new token for the grace window before it commits', async () => {
        let committedWhenRemembered: boolean | undefined;
        refreshTokenGraceService.remember.mockImplementation(() => {
          committedWhenRemembered = committed;
          return Promise.resolve();
        });

        await controller.refresh(req, mockRes);

        // A refresh waiting for this one's lock finds it once it commits
        expect(refreshTokenGraceService.remember).toHaveBeenCalledWith(
          jti,
          mockRefreshToken,
          newRefreshToken,
        );
        expect(committedWhenRemembered).toBe(false);
      });

      it.each([
        ['deleted', []],
        ['banned', [{ banned: true }]],
      ])('refuses a user %s by the time it has the lock', async (_, rows) => {
        mockDatabase.$queryRaw.mockResolvedValue(rows);

        await expect(controller.refresh(req, mockRes)).rejects.toThrow(
          UnauthorizedException,
        );
        expect(authService.consumeRefreshToken).not.toHaveBeenCalled();
      });

      it('signs the access token before the rotation commits', async () => {
        // A password reset waiting for the rotation sets its cutoff after
        // the commit: the access token must be older than that
        let committedWhenSigned: boolean | undefined;
        authService.login.mockImplementation(() => {
          committedWhenSigned = committed;
          return mockAccessToken;
        });

        await controller.refresh(req, mockRes);

        expect(committedWhenSigned).toBe(false);
      });

      it('refuses a revoked session and deletes its tokens', async () => {
        tokenBlacklistService.isRevoked.mockResolvedValue(true);
        let committedWhenDeleted: boolean | undefined;
        jest
          .spyOn(authService, 'invalidateTokenFamily')
          .mockImplementation(() => {
            committedWhenDeleted = committed;
            return Promise.resolve(2);
          });

        await expect(controller.refresh(req, mockRes)).rejects.toThrow(
          'Invalid refresh token',
        );

        // The session (family) and the per-user cutoff, against when this
        // refresh token was issued
        expect(tokenBlacklistService.isRevoked).toHaveBeenCalledWith({
          sub: mockUser.id,
          sid: 'family-123',
          iat: refreshIssuedAt,
        });
        // After the tx, which holds a lock on the token
        expect(authService.invalidateTokenFamily).toHaveBeenCalledWith(
          'family-123',
        );
        expect(committedWhenDeleted).toBe(true);
        expect(authService.consumeRefreshToken).not.toHaveBeenCalled();
        expect(authService.login).not.toHaveBeenCalled();
      });

      it('deletes just the token of a revoked session without a family', async () => {
        jest
          .spyOn(authService, 'validateRefreshToken')
          .mockResolvedValue({ ...mockTokenRecord, familyId: null });
        tokenBlacklistService.isRevoked.mockResolvedValue(true);

        await expect(controller.refresh(req, mockRes)).rejects.toThrow(
          UnauthorizedException,
        );

        expect(tokenBlacklistService.isRevoked).toHaveBeenCalledWith({
          sub: mockUser.id,
          sid: undefined,
          iat: refreshIssuedAt,
        });
        expect(mockDatabase.refreshToken.deleteMany).toHaveBeenCalledWith({
          where: { id: jti },
        });
      });
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
      jest
        .spyOn(authService, 'deleteRefreshToken')
        .mockResolvedValue('family-123');
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

    it('locks the user against refreshes before it deletes the session', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
      };

      await controller.logout(req, mockRes);

      const [strings, userId] = mockDatabase.$queryRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toMatch(
        /FROM "User" WHERE "id" = \? FOR NO KEY UPDATE/,
      );
      expect(userId).toBe(mockUser.id);
      expect(mockDatabase.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        authService.deleteRefreshToken.mock.invocationCallOrder[0],
      );
    });

    it('should revoke the session and disconnect its sockets', async () => {
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
        headers: {},
      };

      await controller.logout(req, mockRes);

      expect(sessionRevocationService.revokeSessions).toHaveBeenCalledWith(
        mockUser.id,
        ['family-123'],
        'LOGGED_OUT',
        [],
      );
    });

    it('should also disconnect sockets using the access token', async () => {
      const req = {
        ...mockReq,
        cookies: {
          refresh_token: mockRefreshToken,
          access_token: mockAccessToken,
        },
        headers: {},
      };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: mockUser.id,
        jti: 'access-jti',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await controller.logout(req, mockRes);

      expect(sessionRevocationService.revokeSessions).toHaveBeenCalledWith(
        mockUser.id,
        ['family-123'],
        'LOGGED_OUT',
        ['access-jti'],
      );
    });

    it('should disconnect sockets of the access token when there is no refresh token', async () => {
      const req = {
        ...mockReq,
        cookies: { access_token: mockAccessToken },
        headers: {},
      };
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: mockUser.id,
        jti: 'access-jti',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await controller.logout(req, mockRes);

      // No session revoked: its refresh token still exists
      expect(sessionRevocationService.revokeSessions).toHaveBeenCalledWith(
        mockUser.id,
        [],
        'LOGGED_OUT',
        ['access-jti'],
      );
    });

    it('should not fail logout if revoking the session fails', async () => {
      sessionRevocationService.revokeSessions.mockRejectedValue(
        new Error('Redis down'),
      );
      const req = {
        ...mockReq,
        cookies: { refresh_token: mockRefreshToken },
        headers: {},
      };

      await expect(controller.logout(req, mockRes)).resolves.toEqual({
        message: 'Logged out successfully',
      });
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
      expect(sessionRevocationService.revokeSessions).not.toHaveBeenCalled();
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

  describe('forgotPassword', () => {
    it('always returns the same 200 message, regardless of what the service does', async () => {
      jest
        .spyOn(passwordResetService, 'requestReset')
        .mockResolvedValue(undefined);

      const result = await controller.forgotPassword({
        email: 'someone@example.com',
      });

      expect(passwordResetService.requestReset).toHaveBeenCalledWith(
        'someone@example.com',
      );
      expect(result).toEqual({
        message:
          'If an account with that email exists, a reset link has been sent.',
      });
    });

    it('returns the identical response even when requestReset silently no-ops', async () => {
      // requestReset never throws / never signals whether the email existed
      // — this asserts the controller doesn't try to branch on it either.
      jest
        .spyOn(passwordResetService, 'requestReset')
        .mockResolvedValue(undefined);

      const result = await controller.forgotPassword({
        email: 'unknown@example.com',
      });

      expect(result).toEqual({
        message:
          'If an account with that email exists, a reset link has been sent.',
      });
    });
  });

  describe('resetPassword', () => {
    it('delegates to PasswordResetService and returns a success message', async () => {
      jest
        .spyOn(passwordResetService, 'resetPassword')
        .mockResolvedValue(undefined);

      const result = await controller.resetPassword({
        token: 'raw-token',
        newPassword: 'brand-new-password',
      });

      expect(passwordResetService.resetPassword).toHaveBeenCalledWith(
        'raw-token',
        'brand-new-password',
      );
      expect(result).toEqual({ message: 'Password has been reset.' });
    });

    it('propagates BadRequestException for an invalid/expired/used token', async () => {
      jest
        .spyOn(passwordResetService, 'resetPassword')
        .mockRejectedValue(
          new BadRequestException('Invalid or expired reset token'),
        );

      await expect(
        controller.resetPassword({
          token: 'bad-token',
          newPassword: 'brand-new-password',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
