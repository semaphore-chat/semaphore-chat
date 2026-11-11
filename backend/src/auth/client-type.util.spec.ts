import {
  DEVICE_NAME_MAX_LENGTH,
  hasNativeClientIdentity,
  isBrowserPageRequest,
  parseClientType,
  parseDeviceName,
  presentedRefreshToken,
  refreshingClientType,
  resolveSignInClient,
} from './client-type.util';

const ELECTRON_UA = 'Mozilla/5.0 Chrome/140.0.0.0 Electron/39.0.0';
const WEB = { clientType: 'web', tokenDelivery: 'cookie' };

describe('parseClientType', () => {
  it.each(['web', 'electron', 'desktop-native', 'mobile-native'])(
    'knows %s',
    (type) => {
      expect(parseClientType(type)).toBe(type);
    },
  );

  it.each(['native', 'WEB', '', undefined, ['web'], 1])(
    'does not know %j',
    (value) => {
      expect(parseClientType(value)).toBeUndefined();
    },
  );
});

describe('isBrowserPageRequest', () => {
  it.each([
    ['an https origin', { origin: 'https://chat.example.com' }],
    ['an http origin', { origin: 'http://chat.lan' }],
    ['same-origin fetch metadata', { 'sec-fetch-site': 'same-origin' }],
    ['same-site fetch metadata', { 'sec-fetch-site': 'same-site' }],
    [
      'Origin: null with same-origin fetch metadata',
      { origin: 'null', 'sec-fetch-site': 'same-origin' },
    ],
  ])('is true for %s', (_name, headers) => {
    expect(isBrowserPageRequest(headers)).toBe(true);
  });

  it.each([
    ['no headers', {}],
    ['Origin: null', { origin: 'null' }],
    ['the packaged app', { origin: 'null', 'sec-fetch-site': 'cross-site' }],
    ['a file origin', { origin: 'file://' }],
  ])('is false for %s', (_name, headers) => {
    expect(isBrowserPageRequest(headers)).toBe(false);
  });

  describe('the Electron dev server', () => {
    const headers = {
      origin: 'http://localhost:5173',
      'user-agent': ELECTRON_UA,
      'sec-fetch-site': 'same-site',
    };
    const nodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = nodeEnv;
    });

    it('is not a browser page in development', () => {
      process.env.NODE_ENV = 'development';
      expect(isBrowserPageRequest(headers)).toBe(false);
    });

    it.each(['production', 'test'])('is a browser page in %s', (env) => {
      process.env.NODE_ENV = env;
      expect(isBrowserPageRequest(headers)).toBe(true);
    });

    it('needs the Electron user agent', () => {
      process.env.NODE_ENV = 'development';
      expect(
        isBrowserPageRequest({ ...headers, 'user-agent': 'Mozilla/5.0' }),
      ).toBe(true);
    });
  });
});

describe('resolveSignInClient', () => {
  it('is a web client without a declaration', () => {
    expect(resolveSignInClient({ 'user-agent': 'Mozilla/5.0' })).toEqual(WEB);
  });

  it('is a web client for an unknown type', () => {
    expect(resolveSignInClient({ 'x-client-type': 'toaster' })).toEqual(WEB);
  });

  it('is a web client for a repeated header', () => {
    expect(
      resolveSignInClient({ 'x-client-type': ['desktop-native', 'web'] }),
    ).toEqual(WEB);
  });

  it('honours an explicit web declaration from an Electron user agent', () => {
    expect(
      resolveSignInClient({
        'x-client-type': 'web',
        'user-agent': ELECTRON_UA,
      }),
    ).toEqual(WEB);
  });

  describe('Electron', () => {
    const body = { clientType: 'electron', tokenDelivery: 'body' };

    it('declared, from the packaged app', () => {
      expect(
        resolveSignInClient({
          'x-client-type': 'electron',
          'user-agent': ELECTRON_UA,
          'sec-fetch-site': 'cross-site',
        }),
      ).toEqual(body);
    });

    it('recognised by its user agent, from before the header', () => {
      expect(
        resolveSignInClient({ 'user-agent': ELECTRON_UA, origin: 'null' }),
      ).toEqual(body);
      expect(resolveSignInClient({ 'user-agent': ELECTRON_UA })).toEqual(body);
    });

    it.each([
      ['an https origin', { origin: 'https://chat.example.com' }],
      ['same-origin fetch metadata', { 'sec-fetch-site': 'same-origin' }],
      [
        'Origin: null with same-origin fetch metadata',
        { origin: 'null', 'sec-fetch-site': 'same-origin' },
      ],
    ])('is cookies with %s', (_name, page) => {
      expect(
        resolveSignInClient({ 'user-agent': ELECTRON_UA, ...page }),
      ).toEqual(WEB);
      expect(
        resolveSignInClient({
          'x-client-type': 'electron',
          'user-agent': ELECTRON_UA,
          ...page,
        }),
      ).toEqual(WEB);
    });
  });

  describe.each(['desktop-native', 'mobile-native'])('%s', (clientType) => {
    const declared = { 'x-client-type': clientType };

    it('gets body delivery', () => {
      expect(resolveSignInClient(declared)).toEqual({
        clientType,
        tokenDelivery: 'body',
      });
    });

    it.each([
      ['any Origin', { origin: 'null' }],
      ['a web Origin', { origin: 'https://chat.example.com' }],
      ['cross-site fetch metadata', { 'sec-fetch-site': 'cross-site' }],
      ['other fetch metadata', { 'sec-fetch-mode': 'cors' }],
    ])('is cookies with %s', (_name, page) => {
      expect(resolveSignInClient({ ...declared, ...page })).toEqual(WEB);
    });
  });
});

describe('hasNativeClientIdentity', () => {
  const deviceId = '123e4567-e89b-12d3-a456-426614174000';

  it('needs a well-formed device id and a user agent', () => {
    expect(
      hasNativeClientIdentity({
        'x-device-id': deviceId,
        'user-agent': 'SemaphoreChat-Desktop/0.1',
      }),
    ).toBe(true);
    expect(hasNativeClientIdentity({ 'x-device-id': deviceId })).toBe(false);
    expect(hasNativeClientIdentity({ 'user-agent': 'x' })).toBe(false);
    expect(
      hasNativeClientIdentity({ 'x-device-id': 'nope', 'user-agent': 'x' }),
    ).toBe(false);
    expect(
      hasNativeClientIdentity({ 'x-device-id': deviceId, 'user-agent': '' }),
    ).toBe(false);
  });
});

describe('refreshingClientType', () => {
  it('is web for a cookie, whatever the headers say', () => {
    expect(
      refreshingClientType('cookie', { 'x-client-type': 'desktop-native' }),
    ).toBe('web');
  });

  it('is the declared type for a body token', () => {
    expect(
      refreshingClientType('body', { 'x-client-type': 'mobile-native' }),
    ).toBe('mobile-native');
  });

  it('is electron for a body token from its user agent', () => {
    expect(refreshingClientType('body', { 'user-agent': ELECTRON_UA })).toBe(
      'electron',
    );
  });

  it('is unknown for a body token otherwise', () => {
    expect(refreshingClientType('body', {})).toBeUndefined();
    expect(
      refreshingClientType('body', { 'x-client-type': 'web' }),
    ).toBeUndefined();
  });
});

describe('presentedRefreshToken', () => {
  const cookies = { refresh_token: 'from-cookie' };

  it('reads the cookie', () => {
    expect(presentedRefreshToken({ cookies, body: {} })).toEqual({
      via: 'cookie',
      token: 'from-cookie',
    });
    expect(presentedRefreshToken({ cookies })).toEqual({
      via: 'cookie',
      token: 'from-cookie',
    });
  });

  it('reads the body', () => {
    expect(presentedRefreshToken({ body: { refreshToken: 'b' } })).toEqual({
      via: 'body',
      token: 'b',
    });
  });

  it('prefers the body to the cookie', () => {
    expect(
      presentedRefreshToken({ cookies, body: { refreshToken: 'b' } }),
    ).toEqual({ via: 'body', token: 'b' });
  });

  it.each([[''], [123], [{ a: 1 }], [['b']], [true]])(
    'does not fall back to the cookie for a malformed body token: %j',
    (refreshToken) => {
      expect(
        presentedRefreshToken({ cookies, body: { refreshToken } }),
      ).toEqual({ via: 'body' });
    },
  );

  it('treats a null body token as no body token', () => {
    expect(
      presentedRefreshToken({ cookies, body: { refreshToken: null } }),
    ).toEqual({ via: 'cookie', token: 'from-cookie' });
  });

  it('finds nothing without either', () => {
    expect(presentedRefreshToken({})).toEqual({ via: 'none' });
    expect(presentedRefreshToken({ cookies: {}, body: {} })).toEqual({
      via: 'none',
    });
  });
});

describe('parseDeviceName', () => {
  it('reads a plain name', () => {
    expect(parseDeviceName('Work laptop')).toBe('Work laptop');
  });

  it('decodes percent-encoded UTF-8', () => {
    expect(parseDeviceName(encodeURIComponent("Zoë's iPhone"))).toBe(
      "Zoë's iPhone",
    );
  });

  it('takes out control, format and separator characters', () => {
    expect(parseDeviceName(encodeURIComponent('a\r\nb‮c​d e\u0000f'))).toBe(
      'a b c d e f',
    );
  });

  it('takes out angle brackets', () => {
    expect(parseDeviceName('<script>x</script>')).toBe('script x /script');
  });

  it('caps the length in characters without splitting one', () => {
    const name = parseDeviceName(
      encodeURIComponent('🙂'.repeat(DEVICE_NAME_MAX_LENGTH + 10)),
    );
    expect(name).toBe('🙂'.repeat(DEVICE_NAME_MAX_LENGTH));
  });

  it.each([
    ['missing', undefined],
    ['repeated', ['a', 'b']],
    ['empty', ''],
    ['only whitespace', '   '],
    ['only control characters', '%00%01'],
    ['malformed percent-encoding', '%E0%A4%A'],
    ['absurdly long', 'x'.repeat(2000)],
  ])('is no name when %s', (_name, value) => {
    expect(parseDeviceName(value)).toBeUndefined();
  });
});
