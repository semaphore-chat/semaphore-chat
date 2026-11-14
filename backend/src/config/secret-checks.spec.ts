import { validateSecrets } from './secret-checks';

const STRONG_A = 'q7Vx2mK9pL4nR8sT1wY6zB3cD5fG0hJ2kM4nP6rS8tU=';
const STRONG_B = 'Z9yX8wV7uT6sR5qP4oN3mL2kJ1iH0gF9eD8cB7aZ6yX=';
const LK_SECRET = 'L1v3K1tS3cr3tV4lu3Th4tIsL0ngEn0ughF0rPr0d==';

const valid = (overrides: Record<string, string | undefined> = {}) =>
  ({
    JWT_SECRET: STRONG_A,
    JWT_REFRESH_SECRET: STRONG_B,
    LIVEKIT_URL: 'wss://lk.chat.example.org',
    LIVEKIT_API_KEY: 'APIa8Kd93Ld',
    LIVEKIT_API_SECRET: LK_SECRET,
    ...overrides,
  }) as NodeJS.ProcessEnv;

/** The placeholders the docs, README, env.sample and Helm chart have shipped. */
const PUBLIC_PLACEHOLDERS = [
  'replace-with-a-long-random-string',
  'replace-with-a-different-long-random-string',
  'CHANGE-ME-long-random-secret-for-jwt-signing',
  'CHANGE-ME-different-long-random-secret-for-refresh-tokens',
  'some long elaborate secret that you really need to change',
  'a different long elaborate secret to change',
];

describe('validateSecrets', () => {
  describe.each([
    ['production', 'production'],
    ['unset', undefined],
    ['an unknown mode', 'staging'],
  ])('NODE_ENV %s (strict)', (_label, nodeEnv) => {
    const env = (o: Record<string, string | undefined> = {}) =>
      valid({ NODE_ENV: nodeEnv, ...o });

    it('accepts strong, distinct secrets', () => {
      expect(() => validateSecrets(env())).not.toThrow();
    });

    it('accepts no LiveKit configuration at all', () => {
      expect(() =>
        validateSecrets(
          env({
            LIVEKIT_URL: undefined,
            LIVEKIT_API_KEY: undefined,
            LIVEKIT_API_SECRET: undefined,
          }),
        ),
      ).not.toThrow();
    });

    it.each(PUBLIC_PLACEHOLDERS)('refuses JWT_SECRET=%s', (placeholder) => {
      expect(() => validateSecrets(env({ JWT_SECRET: placeholder }))).toThrow(
        /JWT_SECRET/,
      );
    });

    it.each(PUBLIC_PLACEHOLDERS)(
      'refuses JWT_REFRESH_SECRET=%s',
      (placeholder) => {
        expect(() =>
          validateSecrets(env({ JWT_REFRESH_SECRET: placeholder })),
        ).toThrow(/JWT_REFRESH_SECRET/);
      },
    );

    it('refuses a missing JWT secret', () => {
      expect(() => validateSecrets(env({ JWT_SECRET: undefined }))).toThrow(
        /JWT_SECRET/,
      );
    });

    it('refuses a JWT secret shorter than 32 characters', () => {
      expect(() =>
        validateSecrets(env({ JWT_REFRESH_SECRET: 'x'.repeat(31) })),
      ).toThrow(/JWT_REFRESH_SECRET.*32/);
    });

    it('refuses JWT_SECRET equal to JWT_REFRESH_SECRET', () => {
      expect(() =>
        validateSecrets(env({ JWT_REFRESH_SECRET: STRONG_A })),
      ).toThrow(/JWT_SECRET and JWT_REFRESH_SECRET/);
    });

    it.each([
      'secret-that-is-at-least-32-characters-long',
      'replace-with-a-secret-at-least-32-characters',
      'your-livekit-api-secret-that-is-long-enough',
    ])('refuses LIVEKIT_API_SECRET=%s', (placeholder) => {
      expect(() =>
        validateSecrets(env({ LIVEKIT_API_SECRET: placeholder })),
      ).toThrow(/LIVEKIT_API_SECRET/);
    });

    it('refuses a LiveKit secret shorter than 32 characters', () => {
      expect(() =>
        validateSecrets(env({ LIVEKIT_API_SECRET: 'k'.repeat(20) })),
      ).toThrow(/LIVEKIT_API_SECRET.*32/);
    });

    it('names the fix and never prints the secret', () => {
      let message = '';
      try {
        validateSecrets(
          env({ JWT_SECRET: 'replace-with-a-long-random-string' }),
        );
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('openssl rand -base64 64');
      expect(message).not.toContain('replace-with-a-long-random-string');
      expect(message).not.toContain(STRONG_B);
    });

    it('lists every failing variable at once', () => {
      expect(() =>
        validateSecrets(
          env({
            JWT_SECRET: 'CHANGE-ME-long-random-secret-for-jwt-signing',
            LIVEKIT_API_SECRET: 'secret-that-is-at-least-32-characters-long',
          }),
        ),
      ).toThrow(/JWT_SECRET[\s\S]*LIVEKIT_API_SECRET/);
    });
  });

  describe('NODE_ENV=development', () => {
    it('warns instead of refusing to start', () => {
      const warn = jest.fn();
      expect(() =>
        validateSecrets(
          valid({
            NODE_ENV: 'development',
            JWT_SECRET:
              'some long elaborate secret that you really need to change',
            LIVEKIT_API_SECRET: 'secret-that-is-at-least-32-characters-long',
          }),
          warn,
        ),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/JWT_SECRET/));
    });

    it('starts without any JWT secrets (ConfigModule reports them)', () => {
      const warn = jest.fn();
      expect(() =>
        validateSecrets({ NODE_ENV: 'development' }, warn),
      ).not.toThrow();
    });
  });

  describe('NODE_ENV=test', () => {
    it('skips the checks', () => {
      const warn = jest.fn();
      expect(() =>
        validateSecrets(
          valid({
            NODE_ENV: 'test',
            JWT_SECRET: 'short',
            JWT_REFRESH_SECRET: 'short',
          }),
          warn,
        ),
      ).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
