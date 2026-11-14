import type { Request, Response } from 'express';
import {
  clearAccessTokenCookie,
  clearRefreshTokenCookie,
  cookieConfig,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from './cookie-helper';

const fakeRes = (secure: boolean) =>
  ({
    req: { secure } as Request,
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  }) as unknown as Response & { cookie: jest.Mock; clearCookie: jest.Mock };

describe('cookie-helper', () => {
  const originalMode = process.env.COOKIE_SECURE;
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalMode === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = originalMode;
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('cookieConfig', () => {
    it('should have accessToken configuration', () => {
      expect(cookieConfig.accessToken).toBeDefined();
      expect(cookieConfig.accessToken.name).toBe('access_token');
    });

    it('should have correct access token cookie options', () => {
      const options = cookieConfig.accessToken.options;

      expect(options.path).toBe('/');
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.maxAge).toBe(1000 * 60 * 60); // 1 hour
    });
  });

  describe('Secure flag (COOKIE_SECURE)', () => {
    const secureFlag = (res: { cookie: jest.Mock }) =>
      (res.cookie.mock.calls[0][2] as { secure: boolean }).secure;

    it.each([
      // mode, request over https, expected
      [undefined, true, true],
      [undefined, false, false],
      ['auto', true, true],
      ['auto', false, false],
      ['true', false, true],
      ['true', true, true],
      ['false', true, false],
      ['false', false, false],
    ])('COOKIE_SECURE=%s, https=%s -> Secure=%s', (mode, https, expected) => {
      if (mode === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = mode;
      // auto ignores NODE_ENV: only the request's scheme counts
      process.env.NODE_ENV = expected ? 'development' : 'production';

      const access = fakeRes(https);
      setAccessTokenCookie(access, 'a');
      expect(secureFlag(access)).toBe(expected);

      const refresh = fakeRes(https);
      setRefreshTokenCookie(refresh, 'r');
      expect(secureFlag(refresh)).toBe(expected);
    });
  });

  describe('clearing', () => {
    it.each([true, false])(
      'clears each cookie with the attributes it was set with (https=%s)',
      (https) => {
        delete process.env.COOKIE_SECURE;
        const res = fakeRes(https);

        setAccessTokenCookie(res, 'a');
        setRefreshTokenCookie(res, 'r');
        clearAccessTokenCookie(res);
        clearRefreshTokenCookie(res);

        const [[, , accessSet], [, , refreshSet]] = res.cookie.mock.calls as [
          string,
          string,
          Record<string, unknown>,
        ][];
        const withoutMaxAge = (o: Record<string, unknown>) => {
          const rest = { ...o };
          delete rest.maxAge;
          return rest;
        };
        expect(res.clearCookie).toHaveBeenCalledWith(
          'access_token',
          withoutMaxAge(accessSet),
        );
        expect(res.clearCookie).toHaveBeenCalledWith(
          'refresh_token',
          withoutMaxAge(refreshSet),
        );
        expect(refreshSet).toMatchObject({
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          secure: https,
        });
      },
    );
  });
});
