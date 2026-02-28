import { FileAuthGuard } from './file-auth.guard';
import { SignedUrlService } from './signed-url.service';
import { DatabaseService } from '@/database/database.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createMockDatabase } from '@/test-utils';

describe('FileAuthGuard', () => {
  let guard: FileAuthGuard;
  let signedUrlService: { sign: jest.Mock; verify: jest.Mock; generateSignedUrl: jest.Mock };
  let mockDatabase: ReturnType<typeof createMockDatabase>;
  let jwtAuthGuard: { canActivate: jest.Mock };

  const createContext = (
    query: Record<string, string> = {},
    params: Record<string, string> = {},
  ): ExecutionContext => {
    const req = { query, params };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
      getArgs: () => [req],
      getArgByIndex: () => req,
      switchToRpc: () => ({}),
      switchToWs: () => ({}),
      getType: () => 'http',
    } as unknown as ExecutionContext;
  };

  const getReqFromContext = (ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Record<string, unknown>>();

  beforeEach(() => {
    signedUrlService = {
      sign: jest.fn(),
      verify: jest.fn(),
      generateSignedUrl: jest.fn(),
    };

    mockDatabase = createMockDatabase();

    jwtAuthGuard = {
      canActivate: jest.fn().mockResolvedValue(true),
    };

    guard = new FileAuthGuard(
      signedUrlService as unknown as SignedUrlService,
      mockDatabase as unknown as DatabaseService,
      jwtAuthGuard as unknown as JwtAuthGuard,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signed URL path', () => {
    it('should allow access with a valid signed URL', async () => {
      const mockUser = { id: 'user-1', username: 'test', banned: false };
      signedUrlService.verify.mockReturnValue(true);
      mockDatabase.user.findUnique.mockResolvedValue(mockUser);

      const ctx = createContext(
        { sig: 'abc123', exp: '9999999999', uid: 'user-1' },
        { id: 'file-1' },
      );

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(signedUrlService.verify).toHaveBeenCalledWith(
        'file-1',
        'abc123',
        9999999999,
        'user-1',
      );
      expect(getReqFromContext(ctx)).toHaveProperty('user', mockUser);
    });

    it('should throw UnauthorizedException for invalid signature', async () => {
      signedUrlService.verify.mockReturnValue(false);

      const ctx = createContext(
        { sig: 'bad-sig', exp: '9999999999', uid: 'user-1' },
        { id: 'file-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Invalid or expired signed URL',
      );
    });

    it('should throw UnauthorizedException for expired signature', async () => {
      signedUrlService.verify.mockReturnValue(false);

      const pastExp = String(Math.floor(Date.now() / 1000) - 60);
      const ctx = createContext(
        { sig: 'some-sig', exp: pastExp, uid: 'user-1' },
        { id: 'file-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for non-numeric exp', async () => {
      const ctx = createContext(
        { sig: 'abc', exp: 'not-a-number', uid: 'user-1' },
        { id: 'file-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Invalid signed URL',
      );
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      signedUrlService.verify.mockReturnValue(true);
      mockDatabase.user.findUnique.mockResolvedValue(null);

      const ctx = createContext(
        { sig: 'valid', exp: '9999999999', uid: 'ghost-user' },
        { id: 'file-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'User not found or banned',
      );
    });

    it('should throw UnauthorizedException when user is banned', async () => {
      const bannedUser = { id: 'user-1', username: 'banned', banned: true };
      signedUrlService.verify.mockReturnValue(true);
      mockDatabase.user.findUnique.mockResolvedValue(bannedUser);

      const ctx = createContext(
        { sig: 'valid', exp: '9999999999', uid: 'user-1' },
        { id: 'file-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'User not found or banned',
      );
    });

    it('should attach user to request on valid signed URL', async () => {
      const mockUser = { id: 'user-1', username: 'test', banned: false };
      signedUrlService.verify.mockReturnValue(true);
      mockDatabase.user.findUnique.mockResolvedValue(mockUser);

      const ctx = createContext(
        { sig: 'abc', exp: '9999999999', uid: 'user-1' },
        { id: 'file-1' },
      );

      await guard.canActivate(ctx);

      const req = getReqFromContext(ctx);
      expect(req.user).toBe(mockUser);
    });
  });

  describe('JWT fallback path', () => {
    it('should delegate to JwtAuthGuard when no signed URL params', async () => {
      const ctx = createContext({}, { id: 'file-1' });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(ctx);
      expect(signedUrlService.verify).not.toHaveBeenCalled();
    });

    it('should delegate to JwtAuthGuard when only some params are present (sig only)', async () => {
      const ctx = createContext({ sig: 'abc' }, { id: 'file-1' });

      await guard.canActivate(ctx);

      expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(ctx);
      expect(signedUrlService.verify).not.toHaveBeenCalled();
    });

    it('should delegate to JwtAuthGuard when only some params are present (sig + exp)', async () => {
      const ctx = createContext({ sig: 'abc', exp: '123' }, { id: 'file-1' });

      await guard.canActivate(ctx);

      expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(ctx);
      expect(signedUrlService.verify).not.toHaveBeenCalled();
    });

    it('should propagate JwtAuthGuard rejection', async () => {
      jwtAuthGuard.canActivate.mockRejectedValue(
        new UnauthorizedException('No JWT'),
      );

      const ctx = createContext({}, { id: 'file-1' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
