import 'reflect-metadata';
import { validateEnv, Environment } from './env.validation';

/**
 * Minimal configs used across tests.
 * CI only sets DATABASE_URL, REDIS_HOST, JWT_SECRET, JWT_REFRESH_SECRET.
 */
const BASE_CONFIG = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_HOST: 'localhost',
};

const PROD_REQUIRED = {
  JWT_SECRET: 'super-secret-jwt',
  JWT_REFRESH_SECRET: 'super-secret-refresh',
  LIVEKIT_URL: 'wss://livekit.example.com',
  LIVEKIT_API_KEY: 'api-key',
  LIVEKIT_API_SECRET: 'api-secret',
};

describe('validateEnv', () => {
  describe('Test 1: Valid full config passes', () => {
    it('returns the validated object when all vars are provided', () => {
      const config = {
        ...BASE_CONFIG,
        NODE_ENV: Environment.Production,
        ...PROD_REQUIRED,
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
      };

      const result = validateEnv(config);

      expect(result).toBeDefined();
      expect(result.DATABASE_URL).toBe(config.DATABASE_URL);
      expect(result.REDIS_HOST).toBe(config.REDIS_HOST);
    });
  });

  describe('Test 2: Missing DATABASE_URL throws', () => {
    it('throws an error naming DATABASE_URL when it is absent', () => {
      const config = { REDIS_HOST: 'localhost' };

      expect(() => validateEnv(config)).toThrow(/DATABASE_URL/);
    });
  });

  describe('Test 3: production with missing LIVEKIT_API_KEY throws', () => {
    it('throws when NODE_ENV=production and LIVEKIT_API_KEY is absent', () => {
      const config = {
        ...BASE_CONFIG,
        NODE_ENV: Environment.Production,
        JWT_SECRET: 'secret',
        JWT_REFRESH_SECRET: 'refresh',
        LIVEKIT_URL: 'wss://livekit.example.com',
        // LIVEKIT_API_KEY intentionally omitted
        LIVEKIT_API_SECRET: 'api-secret',
      };

      expect(() => validateEnv(config)).toThrow(/LIVEKIT_API_KEY/);
    });
  });

  describe('Test 3b: LiveKit is optional in production (all or none)', () => {
    it('passes when NODE_ENV=production and no LiveKit variable is set', () => {
      const config = {
        ...BASE_CONFIG,
        NODE_ENV: Environment.Production,
        JWT_SECRET: 'secret',
        JWT_REFRESH_SECRET: 'refresh',
      };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('throws when only LIVEKIT_URL is set in production', () => {
      const config = {
        ...BASE_CONFIG,
        NODE_ENV: Environment.Production,
        ...PROD_REQUIRED,
        LIVEKIT_API_KEY: undefined,
        LIVEKIT_API_SECRET: undefined,
      };

      expect(() => validateEnv(config)).toThrow(
        /LIVEKIT_API_KEY[\s\S]*LIVEKIT_API_SECRET/,
      );
    });
  });

  describe('Test 3c: COOKIE_SECURE', () => {
    it.each(['auto', 'true', 'false'])('accepts %s', (value) => {
      expect(() =>
        validateEnv({ ...BASE_CONFIG, COOKIE_SECURE: value }),
      ).not.toThrow();
    });

    it('rejects anything else', () => {
      expect(() =>
        validateEnv({ ...BASE_CONFIG, COOKIE_SECURE: 'yes' }),
      ).toThrow(/COOKIE_SECURE/);
    });
  });

  describe('Test 4: NODE_ENV=test with only base vars passes', () => {
    it('passes when NODE_ENV=test with DATABASE_URL, REDIS_HOST, JWT_SECRET, JWT_REFRESH_SECRET only', () => {
      const config = {
        ...BASE_CONFIG,
        NODE_ENV: Environment.Test,
        JWT_SECRET: 'secret',
        JWT_REFRESH_SECRET: 'refresh',
        // LiveKit and VAPID intentionally absent
      };

      expect(() => validateEnv(config)).not.toThrow();
    });
  });

  describe('Test 5: NODE_ENV=development with missing LiveKit vars passes', () => {
    it('passes when NODE_ENV=development and LiveKit vars are absent', () => {
      const config = {
        ...BASE_CONFIG,
        NODE_ENV: Environment.Development,
        // LiveKit intentionally absent
      };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('passes when NODE_ENV is unset and LiveKit vars are absent', () => {
      const config = { ...BASE_CONFIG };

      expect(() => validateEnv(config)).not.toThrow();
    });
  });

  describe('Test 6: VAPID pair check', () => {
    it('throws when VAPID_PUBLIC_KEY is set but VAPID_PRIVATE_KEY is missing', () => {
      const config = {
        ...BASE_CONFIG,
        VAPID_PUBLIC_KEY: 'pub-key',
        // VAPID_PRIVATE_KEY intentionally omitted
      };

      expect(() => validateEnv(config)).toThrow(/VAPID/);
    });

    it('throws when VAPID_PRIVATE_KEY is set but VAPID_PUBLIC_KEY is missing', () => {
      const config = {
        ...BASE_CONFIG,
        VAPID_PRIVATE_KEY: 'priv-key',
        // VAPID_PUBLIC_KEY intentionally omitted
      };

      expect(() => validateEnv(config)).toThrow(/VAPID/);
    });

    it('passes when both VAPID keys are omitted', () => {
      const config = { ...BASE_CONFIG };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('passes when both VAPID keys are provided', () => {
      const config = {
        ...BASE_CONFIG,
        VAPID_PUBLIC_KEY: 'pub-key',
        VAPID_PRIVATE_KEY: 'priv-key',
      };

      expect(() => validateEnv(config)).not.toThrow();
    });
  });

  describe('Test 6b: SMTP pair/dependency checks', () => {
    it('throws when SMTP_USER is set but SMTP_PASS is missing', () => {
      const config = {
        ...BASE_CONFIG,
        SMTP_USER: 'user',
        // SMTP_PASS intentionally omitted
      };

      expect(() => validateEnv(config)).toThrow(/SMTP_USER/);
    });

    it('throws when SMTP_PASS is set but SMTP_USER is missing', () => {
      const config = {
        ...BASE_CONFIG,
        SMTP_PASS: 'pass',
        // SMTP_USER intentionally omitted
      };

      expect(() => validateEnv(config)).toThrow(/SMTP_USER/);
    });

    it('passes when both SMTP_USER and SMTP_PASS are omitted', () => {
      const config = { ...BASE_CONFIG };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('passes when both SMTP_USER and SMTP_PASS are provided', () => {
      const config = {
        ...BASE_CONFIG,
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
      };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('throws when SMTP_HOST is set but SMTP_FROM is missing', () => {
      const config = {
        ...BASE_CONFIG,
        SMTP_HOST: 'smtp.example.com',
        // SMTP_FROM intentionally omitted
      };

      expect(() => validateEnv(config)).toThrow(/SMTP_HOST requires SMTP_FROM/);
    });

    it('passes when SMTP_HOST and SMTP_FROM are both provided', () => {
      const config = {
        ...BASE_CONFIG,
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'noreply@example.com',
      };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('passes when SMTP_HOST is omitted entirely (no SMTP_FROM required)', () => {
      const config = { ...BASE_CONFIG };

      expect(() => validateEnv(config)).not.toThrow();
    });
  });

  describe('Test 6c: S3 storage vars required only when STORAGE_TYPE=S3', () => {
    it('passes when STORAGE_TYPE is unset (LOCAL default) with no S3 vars', () => {
      const config = { ...BASE_CONFIG };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('passes when STORAGE_TYPE=LOCAL explicitly with no S3 vars', () => {
      const config = { ...BASE_CONFIG, STORAGE_TYPE: 'LOCAL' };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('throws listing every missing S3 var when STORAGE_TYPE=S3 and none are set', () => {
      const config = { ...BASE_CONFIG, STORAGE_TYPE: 'S3' };

      let error: Error | null = null;
      try {
        validateEnv(config);
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(
        /S3_BUCKET is required when STORAGE_TYPE=S3/,
      );
      expect(error!.message).toMatch(
        /S3_REGION is required when STORAGE_TYPE=S3/,
      );
      expect(error!.message).toMatch(
        /S3_ACCESS_KEY_ID is required when STORAGE_TYPE=S3/,
      );
      expect(error!.message).toMatch(
        /S3_SECRET_ACCESS_KEY is required when STORAGE_TYPE=S3/,
      );
    });

    it('passes when STORAGE_TYPE=S3 with all required S3 vars set (no endpoint needed for AWS)', () => {
      const config = {
        ...BASE_CONFIG,
        STORAGE_TYPE: 'S3',
        S3_BUCKET: 'my-bucket',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'AKIA...',
        S3_SECRET_ACCESS_KEY: 'secret',
      };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('passes when STORAGE_TYPE=S3 with MinIO-style endpoint and path-style flag set', () => {
      const config = {
        ...BASE_CONFIG,
        STORAGE_TYPE: 'S3',
        S3_BUCKET: 'my-bucket',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'minioadmin',
        S3_SECRET_ACCESS_KEY: 'minioadmin',
        S3_ENDPOINT: 'http://minio:9000',
        S3_FORCE_PATH_STYLE: 'true',
      };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it('passes when STORAGE_TYPE=AZURE_BLOB (a real, reserved-for-later enum value)', () => {
      const config = { ...BASE_CONFIG, STORAGE_TYPE: 'AZURE_BLOB' };

      expect(() => validateEnv(config)).not.toThrow();
    });

    it("throws on a typo'd STORAGE_TYPE instead of silently falling back to LOCAL", () => {
      const config = { ...BASE_CONFIG, STORAGE_TYPE: 's3' };

      expect(() => validateEnv(config)).toThrow(/STORAGE_TYPE/);
    });

    it('throws on an unrecognized STORAGE_TYPE value', () => {
      const config = { ...BASE_CONFIG, STORAGE_TYPE: 'AWS_S3' };

      expect(() => validateEnv(config)).toThrow(/STORAGE_TYPE/);
    });
  });

  describe('Test 7: Unknown extra env vars are ignored', () => {
    it('does not throw when extra unknown vars are present and passes them through', () => {
      const config = {
        ...BASE_CONFIG,
        SOME_UNKNOWN_VAR: 'value',
        ANOTHER_RANDOM_VAR: '12345',
        HOME: '/root',
        PATH: '/usr/bin:/bin',
        USER: 'app',
      };

      const result = validateEnv(config);
      expect(
        (result as unknown as Record<string, unknown>).SOME_UNKNOWN_VAR,
      ).toBe('value');
    });
  });

  describe('Error aggregation', () => {
    it('aggregates all missing production vars in a single error', () => {
      const config = {
        ...BASE_CONFIG,
        NODE_ENV: Environment.Production,
        // All production-required vars omitted
      };

      let error: Error | null = null;
      try {
        validateEnv(config);
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      // All production-required vars must appear in the error
      expect(error!.message).toMatch(/JWT_SECRET/);
      expect(error!.message).toMatch(/JWT_REFRESH_SECRET/);
      // LiveKit is optional: absent altogether is not an error
      expect(error!.message).not.toMatch(/LIVEKIT/);
    });
  });
});
