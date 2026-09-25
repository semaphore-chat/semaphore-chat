import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { JwtService } from '@nestjs/jwt';
import { WsAuthService } from './ws-auth.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { UserService } from '@/user/user.service';
import { UserFactory, expectNoSensitiveUserFields } from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';

describe('WsAuthService', () => {
  let service: WsAuthService;
  let jwtService: Mocked<JwtService>;
  let userService: Mocked<UserService>;
  let tokenBlacklistService: Mocked<TokenBlacklistService>;

  const exp = Math.floor(Date.now() / 1000) + 3600;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(WsAuthService).compile();

    service = unit;
    jwtService = unitRef.get(JwtService);
    userService = unitRef.get(UserService);
    tokenBlacklistService = unitRef.get(TokenBlacklistService);
    tokenBlacklistService.isRevoked.mockResolvedValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns the user and the token claims for a valid token', async () => {
    const user = UserFactory.buildComplete({ banned: false });
    const claims = { sub: user.id, jti: 'jti-1', sid: 'sid-1', exp };
    jwtService.verify.mockReturnValue(claims);
    userService.findAuthUserById.mockResolvedValue(user);

    const result = await service.authenticate('valid-token');

    expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
    expect(tokenBlacklistService.isRevoked).toHaveBeenCalledWith(claims);
    expect(result.claims).toEqual(claims);
    expect(result.user).toBeInstanceOf(UserEntity);
    expect(result.user.id).toBe(user.id);
    expectNoSensitiveUserFields(result.user);
  });

  it('rejects a token that fails verification (bad signature, expired)', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(service.authenticate('bad')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(userService.findAuthUserById).not.toHaveBeenCalled();
  });

  it('rejects a token without an expiry', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1' });

    await expect(service.authenticate('no-exp')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('rejects a revoked token without looking up the user', async () => {
    jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'jti-1', exp });
    tokenBlacklistService.isRevoked.mockResolvedValue(true);

    await expect(service.authenticate('revoked')).rejects.toMatchObject({
      code: 'TOKEN_REVOKED',
    });
    expect(userService.findAuthUserById).not.toHaveBeenCalled();
  });

  it('rejects a deleted user', async () => {
    jwtService.verify.mockReturnValue({ sub: 'gone', exp });
    userService.findAuthUserById.mockResolvedValue(null);

    await expect(service.authenticate('token')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('rejects a banned user', async () => {
    const user = UserFactory.build({ banned: true });
    jwtService.verify.mockReturnValue({ sub: user.id, exp });
    userService.findAuthUserById.mockResolvedValue(user);

    await expect(service.authenticate('token')).rejects.toMatchObject({
      code: 'USER_BANNED',
    });
  });
});
