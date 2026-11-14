/**
 * Schema-based environment validation (structural presence check).
 *
 * Division of labour with config/secret-checks.ts validateSecrets():
 *   - validateSecrets(): runs FIRST (main.ts), before NestFactory.create().
 *     Refuses placeholder, short or reused secrets outside development/test,
 *     and missing JWT secrets.
 *   - THIS FILE: runs SECOND, during ConfigModule.forRoot() initialization
 *     (i.e. when Nest is already being assembled). Performs structural presence
 *     validation for the full env-var inventory and rejects partial VAPID pairs.
 */

import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(Environment)
  NODE_ENV?: Environment;

  // Always required -------------------------------------------------------

  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL is required' })
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty({ message: 'REDIS_HOST is required' })
  REDIS_HOST: string;

  // Production-only (validated imperatively in validateEnv) ---------------

  @IsOptional()
  @IsString()
  JWT_SECRET?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_SECRET?: string;

  @IsOptional()
  @IsString()
  LIVEKIT_URL?: string;

  @IsOptional()
  @IsString()
  LIVEKIT_API_KEY?: string;

  @IsOptional()
  @IsString()
  LIVEKIT_API_SECRET?: string;

  // Auth cookies' Secure flag: auto (per request scheme), true or false
  @IsOptional()
  @IsIn(['auto', 'true', 'false'], {
    message: 'COOKIE_SECURE must be auto, true or false',
  })
  COOKIE_SECURE?: string;

  // Optional pair ---------------------------------------------------------

  @IsOptional()
  @IsString()
  VAPID_PUBLIC_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_PRIVATE_KEY?: string;

  // Thumbnail backfill (issue #409) ---------------------------------------

  @IsOptional()
  @IsString()
  THUMBNAIL_BACKFILL_ENABLED?: string;

  @IsOptional()
  @IsString()
  THUMBNAIL_BACKFILL_BATCH_SIZE?: string;

  @IsOptional()
  @IsString()
  THUMBNAIL_BACKFILL_STARTUP_DELAY_MS?: string;

  @IsOptional()
  @IsString()
  THUMBNAIL_BACKFILL_THROTTLE_MS?: string;

  // GIF search (Giphy) — feature is disabled when absent, no production
  // requirement.
  @IsOptional()
  @IsString()
  GIPHY_API_KEY?: string;

  // Background jobs (BullMQ) — queued notification fan-out + link previews.
  @IsOptional()
  @IsString()
  JOB_WORKER_CONCURRENCY?: string;

  @IsOptional()
  @IsString()
  CHANNEL_MESSAGE_MEMBER_THRESHOLD?: string;

  // Optional — Password reset via email (SMTP) ----------------------------
  // The feature is auto-disabled unless SMTP_HOST, SMTP_FROM, and
  // PUBLIC_APP_URL are all set (see MailerService.isEnabled).

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  @IsOptional()
  @IsString()
  PUBLIC_APP_URL?: string;

  // File storage backend (PR-16) --------------------------------------
  // STORAGE_TYPE defaults to LOCAL. S3_* vars are only required when
  // STORAGE_TYPE=S3 (checked imperatively below) — S3_ENDPOINT and
  // S3_FORCE_PATH_STYLE stay optional even then (AWS S3 needs neither;
  // they're for S3-compatible services like MinIO).
  //
  // @IsIn is restricted to the real `StorageType` Prisma enum members
  // (LOCAL, S3, AZURE_BLOB — see schema.prisma) so a typo (e.g. "s3",
  // "AWS_S3") fails fast at startup instead of silently falling back to
  // LOCAL via StorageService.getProvider()'s `default:` branch. AZURE_BLOB
  // is included even though StorageService.getProvider() currently throws
  // NotImplementedException for it — it's a real, intentionally-reserved
  // enum value (see storage.service.ts), not a typo.

  @IsOptional()
  @IsIn(['LOCAL', 'S3', 'AZURE_BLOB'])
  STORAGE_TYPE?: string;

  @IsOptional()
  @IsString()
  S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  S3_FORCE_PATH_STYLE?: string;

  // Replay segment orphan sweep — filesystem-first cleanup pass that catches
  // segment directories with no matching (or no longer active) egressSession
  // DB row (wiped row, missed webhook, a failed one-time cleanup). See
  // ReplaySegmentsService.sweepOrphanedSegmentDirectories.
  @IsOptional()
  @IsString()
  REPLAY_ORPHAN_SWEEP_ENABLED?: string;

  @IsOptional()
  @IsString()
  REPLAY_ORPHAN_SWEEP_GRACE_HOURS?: string;

  // First-run setup (OnboardingService) ------------------------------------
  // REQUIRE_SETUP_TOKEN (default true): the setup token is printed in the
  // backend log and must be entered in the setup wizard; it is never returned
  // by the API. "false" hands it to the wizard (private networks only).
  // SETUP_TOKEN: an operator-chosen token for unattended installs.
  @IsOptional()
  @IsIn(['true', 'false', 'TRUE', 'FALSE', 'True', 'False'])
  REQUIRE_SETUP_TOKEN?: string;

  // Empty counts as unset (a blank `SETUP_TOKEN=` line in an env file)
  @ValidateIf((env: EnvironmentVariables) => !!env.SETUP_TOKEN?.trim())
  @IsString()
  @MinLength(16, { message: 'SETUP_TOKEN must be at least 16 characters' })
  SETUP_TOKEN?: string;
}

/**
 * Variables that must be present when NODE_ENV === 'production'.
 * Checked imperatively to keep error messages simple and aggregated.
 */
const REQUIRED_IN_PRODUCTION = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

/** Voice/video is optional: in production, all of these or none. */
const LIVEKIT_VARS = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
] as const;

/**
 * Validates the environment configuration object.
 *
 * Intended for use as the `validate` option in ConfigModule.forRoot().
 * Throws a single aggregated Error listing every missing/invalid variable.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    // Must stay false (the default). Flipping to true would strip every env
    // var not declared on EnvironmentVariables (CORS_ORIGIN, REPLAY_*, etc.)
    // from the object NestJS hands to ConfigService, breaking all undeclared
    // vars at runtime. validateSync ignores unknown keys on its own — no
    // whitelist option is set — so there is no need to strip them here.
    excludeExtraneousValues: false,
  });

  const errors: string[] = validateSync(validated, {
    skipMissingProperties: false,
  }).flatMap((e) => Object.values(e.constraints ?? {}));

  // Production-only presence checks (imperative — simpler than groups).
  if (validated.NODE_ENV === Environment.Production) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!config[key]) {
        errors.push(`${key} is required in production`);
      }
    }
    if (LIVEKIT_VARS.some((key) => config[key])) {
      for (const key of LIVEKIT_VARS) {
        if (!config[key]) {
          errors.push(
            `${key} is required in production when LiveKit is configured (set all of ${LIVEKIT_VARS.join(', ')} or none)`,
          );
        }
      }
    }
  }

  // VAPID pair check — both or neither.
  const hasPublic = Boolean(config.VAPID_PUBLIC_KEY);
  const hasPrivate = Boolean(config.VAPID_PRIVATE_KEY);
  if (hasPublic !== hasPrivate) {
    errors.push(
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together (or both omitted).',
    );
  }

  // SMTP_USER / SMTP_PASS pair check — both or neither.
  const hasSmtpUser = Boolean(config.SMTP_USER);
  const hasSmtpPass = Boolean(config.SMTP_PASS);
  if (hasSmtpUser !== hasSmtpPass) {
    errors.push(
      'SMTP_USER and SMTP_PASS must be set together (or both omitted).',
    );
  }

  // SMTP_HOST requires SMTP_FROM — a from-address is mandatory to send mail.
  if (config.SMTP_HOST && !config.SMTP_FROM) {
    errors.push('SMTP_HOST requires SMTP_FROM to be set.');
  }

  // S3 storage vars are required only when STORAGE_TYPE=S3. S3_ENDPOINT and
  // S3_FORCE_PATH_STYLE are never required — they exist for S3-compatible
  // services (MinIO) rather than AWS S3 itself.
  if (validated.STORAGE_TYPE === 'S3') {
    const REQUIRED_FOR_S3 = [
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const;
    for (const key of REQUIRED_FOR_S3) {
      if (!config[key]) {
        errors.push(`${key} is required when STORAGE_TYPE=S3`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return validated;
}
