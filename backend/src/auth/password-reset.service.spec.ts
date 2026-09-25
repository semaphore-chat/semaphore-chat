import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PasswordResetService } from './password-reset.service';
import { UserService } from '@/user/user.service';
import { MailerService } from '@/mailer/mailer.service';
import { SessionRevocationService } from './session-revocation.service';
import { createMockDatabase } from '@/test-utils';
import { UserFactory } from '@/test-utils/factories';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let mockUserService: jest.Mocked<
    Pick<UserService, 'hashPassword' | 'resetPasswordAndRevokeSessions'>
  >;
  let mockMailerService: {
    isEnabled: boolean;
    sendPasswordResetEmail: jest.Mock;
  };
  let mockConfigService: ConfigService;
  let mockSessionRevocationService: {
    revokeAllUserSessions: jest.Mock;
  };

  const hashToken = (token: string) =>
    createHash('sha256').update(token).digest('hex');

  beforeEach(() => {
    mockDatabase = createMockDatabase();

    mockUserService = {
      hashPassword: jest.fn().mockResolvedValue('hashed-new-password'),
      resetPasswordAndRevokeSessions: jest.fn(),
    };

    mockMailerService = {
      isEnabled: true,
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn((key: string) =>
        key === 'PUBLIC_APP_URL' ? 'https://chat.example.com' : undefined,
      ),
    } as unknown as ConfigService;

    mockSessionRevocationService = {
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };

    service = new PasswordResetService(
      mockDatabase as never,
      mockUserService as unknown as UserService,
      mockMailerService as unknown as MailerService,
      mockConfigService,
      mockSessionRevocationService as unknown as SessionRevocationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('requestReset', () => {
    it('is a no-op when the mailer is disabled (feature not enabled)', async () => {
      mockMailerService.isEnabled = false;

      await service.requestReset('someone@example.com');

      expect(mockDatabase.user.findUnique).not.toHaveBeenCalled();
      expect(mockDatabase.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mockMailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('creates no token and sends no email for an unknown address, but still "succeeds"', async () => {
      mockDatabase.user.findUnique.mockResolvedValue(null);

      await expect(
        service.requestReset('nobody@example.com'),
      ).resolves.toBeUndefined();

      expect(mockDatabase.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mockMailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('invalidates prior unused tokens, creates a new hashed token, and emails the reset link', async () => {
      const user = UserFactory.build({ email: 'user@example.com' });
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.passwordResetToken.deleteMany.mockResolvedValue({
        count: 1,
      });
      mockDatabase.passwordResetToken.create.mockResolvedValue({});

      await service.requestReset('user@example.com');

      expect(mockDatabase.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id, usedAt: null },
      });

      expect(mockDatabase.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const createArgs = mockDatabase.passwordResetToken.create.mock
        .calls[0][0] as {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      };
      expect(createArgs.data.userId).toBe(user.id);
      // Never store the raw token — only its SHA-256 hash. tokenHash is a
      // 64-char hex string and clearly isn't the (much longer) raw token.
      expect(createArgs.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(createArgs.data.expiresAt.getTime() - Date.now()).toBeGreaterThan(
        59 * 60 * 1000,
      );

      expect(mockMailerService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [to, resetUrl] =
        mockMailerService.sendPasswordResetEmail.mock.calls[0];
      expect(to).toBe('user@example.com');
      expect(resetUrl).toMatch(
        /^https:\/\/chat\.example\.com\/reset-password\?token=[0-9a-f]{64}$/,
      );
      // The raw token in the link must hash to the value that was stored.
      const rawToken = new URL(resetUrl).searchParams.get('token')!;
      expect(hashToken(rawToken)).toBe(createArgs.data.tokenHash);
    });

    it('still succeeds even if sending the email throws', async () => {
      const user = UserFactory.build({ email: 'user@example.com' });
      mockDatabase.user.findUnique.mockResolvedValue(user);
      mockDatabase.passwordResetToken.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockDatabase.passwordResetToken.create.mockResolvedValue({});
      mockMailerService.sendPasswordResetEmail.mockRejectedValue(
        new Error('SMTP exploded'),
      );

      await expect(
        service.requestReset('user@example.com'),
      ).resolves.toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequestException when no token matches', async () => {
      mockDatabase.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('bogus-token', 'new-password-123'),
      ).rejects.toThrow(BadRequestException);

      // No bcrypt for a token that can't reset anything
      expect(mockUserService.hashPassword).not.toHaveBeenCalled();

      expect(
        mockUserService.resetPasswordAndRevokeSessions,
      ).not.toHaveBeenCalled();
      expect(
        mockSessionRevocationService.revokeAllUserSessions,
      ).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an expired token', async () => {
      mockDatabase.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        tokenHash: hashToken('expired-token'),
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        createdAt: new Date(),
      });

      await expect(
        service.resetPassword('expired-token', 'new-password-123'),
      ).rejects.toThrow(BadRequestException);

      expect(
        mockUserService.resetPasswordAndRevokeSessions,
      ).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an already-used token (single-use)', async () => {
      mockDatabase.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        tokenHash: hashToken('used-token'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: new Date(),
        createdAt: new Date(),
      });

      await expect(
        service.resetPassword('used-token', 'new-password-123'),
      ).rejects.toThrow(BadRequestException);

      expect(
        mockUserService.resetPasswordAndRevokeSessions,
      ).not.toHaveBeenCalled();
    });

    it('resets the password, revokes sessions, and marks the token used on a valid token', async () => {
      const resetToken = {
        id: 'token-1',
        userId: 'user-1',
        tokenHash: hashToken('valid-token'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: null,
        createdAt: new Date(),
      };
      mockDatabase.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      mockDatabase.passwordResetToken.updateMany.mockResolvedValue({
        count: 1,
      });
      mockUserService.resetPasswordAndRevokeSessions.mockResolvedValue(
        UserFactory.build({ id: 'user-1' }),
      );

      await service.resetPassword('valid-token', 'new-password-123');

      expect(mockDatabase.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'token-1',
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockUserService.hashPassword).toHaveBeenCalledWith(
        'new-password-123',
      );
      expect(
        mockUserService.resetPasswordAndRevokeSessions,
      ).toHaveBeenCalledWith('user-1', 'hashed-new-password', mockDatabase);
      // After the commit: revoke the access tokens, disconnect the sockets
      expect(
        mockSessionRevocationService.revokeAllUserSessions,
      ).toHaveBeenCalledWith('user-1', 'PASSWORD_CHANGED');
    });

    it('hashes the new password (bcrypt) before the transaction claims the token', async () => {
      mockDatabase.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        tokenHash: hashToken('valid-token'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: null,
        createdAt: new Date(),
      });
      mockDatabase.passwordResetToken.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.resetPassword('valid-token', 'new-password-123');

      // Neither the claimed token's row nor a database connection is held
      // through it
      expect(
        mockUserService.hashPassword.mock.invocationCallOrder[0],
      ).toBeLessThan(mockDatabase.$transaction.mock.invocationCallOrder[0]);
    });

    it('rejects the second of two concurrent redemptions of the same token (atomic claim)', async () => {
      const resetToken = {
        id: 'token-1',
        userId: 'user-1',
        tokenHash: hashToken('racy-token'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: null,
        createdAt: new Date(),
      };

      // Both concurrent requests read the token before either has claimed it.
      mockDatabase.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      // The atomic `updateMany({ where: { usedAt: null } })` guard is what
      // actually decides the race: only one request's conditional update can
      // match, so the loser gets count 0 even though its findUnique read
      // still showed usedAt: null.
      mockDatabase.passwordResetToken.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.resetPassword('racy-token', 'new-password-123'),
      ).rejects.toThrow(BadRequestException);

      expect(
        mockUserService.resetPasswordAndRevokeSessions,
      ).not.toHaveBeenCalled();
    });

    it('rejects reusing the same token a second time (single-use enforced end-to-end)', async () => {
      const resetToken = {
        id: 'token-1',
        userId: 'user-1',
        tokenHash: hashToken('one-time-token'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: null,
        createdAt: new Date(),
      };

      // First redemption succeeds...
      mockDatabase.passwordResetToken.findUnique.mockResolvedValueOnce(
        resetToken,
      );
      mockDatabase.passwordResetToken.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      mockUserService.resetPasswordAndRevokeSessions.mockResolvedValue(
        UserFactory.build({ id: 'user-1' }),
      );
      await service.resetPassword('one-time-token', 'new-password-123');

      // ...second attempt with the same token now finds it already used.
      mockDatabase.passwordResetToken.findUnique.mockResolvedValueOnce({
        ...resetToken,
        usedAt: new Date(),
      });

      await expect(
        service.resetPassword('one-time-token', 'another-password-456'),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockUserService.resetPasswordAndRevokeSessions,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
