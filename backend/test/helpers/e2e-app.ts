/**
 * E2E application boot helper.
 *
 * Boots the full AppModule with the same global prefix / pipes / interceptors
 * as src/main.ts, so e2e specs exercise the exact request pipeline production
 * uses: global JwtAuthGuard, RBAC guard chain, ValidationPipe whitelist and
 * ClassSerializerInterceptor (helmet/CORS/Swagger/WS-adapter are omitted —
 * they don't affect route behavior under supertest).
 *
 * NODE_ENV is forced to 'test' in helpers/setup-env.ts (jest setupFiles)
 * before AppModule is imported; this disables the ThrottlerGuard per
 * app.module.ts.
 */
import {
  ClassSerializerInterceptor,
  INestApplication,
  LoggerService,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppValidationPipe } from '@/common/pipes/app-validation.pipe';
import * as cookieParser from 'cookie-parser';
import type { Application } from 'express';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { Response } from 'supertest';
import { AppModule } from '@/app.module';
import { DatabaseService } from '@/database/database.service';
import { InstanceRolesService } from '@/roles/instance-roles.service';

export type E2eApp = INestApplication<App>;

/** Instance invite code seeded for registration in e2e flows. */
export const E2E_INVITE_CODE = 'e2e-test-invite';

export async function createE2eApp(options?: {
  /**
   * Override the app's Nest logger. Defaults to `false` (silenced) to keep
   * test output readable — Nest boot logs are noisy. Pass a `LoggerService`
   * (e.g. a capturing logger) when a suite needs to inspect service-level
   * `Logger.warn`/`.error` calls that are normally swallowed by `false`,
   * such as diagnosing a non-fatal background failure (thumbnail
   * generation, etc.) that otherwise surfaces only as an opaque assertion
   * failure.
   */
  logger?: LoggerService | false;
  /**
   * Express's `trust proxy` setting, as src/main.ts sets it from
   * TRUST_PROXY. With 'loopback', supertest requests can pose as other
   * clients through an X-Forwarded-For header (req.ip).
   */
  trustProxy?: boolean | number | string;
}): Promise<E2eApp> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: E2eApp = moduleFixture.createNestApplication({
    logger: options?.logger ?? false,
  });

  // Mirror src/main.ts request pipeline.
  if (options?.trustProxy !== undefined) {
    (app.getHttpAdapter().getInstance() as Application).set(
      'trust proxy',
      options.trustProxy,
    );
  }
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.init();
  return app;
}

/**
 * `LoggerService` that buffers every call instead of writing to stdout, so a
 * failing e2e assertion can dump exactly what the app's `Logger.log/warn/
 * error/debug/verbose` calls said right before the failure — most useful for
 * diagnosing non-fatal background failures (e.g. thumbnail generation
 * catching and logging an ffmpeg error, then returning null) that otherwise
 * surface only as an opaque assertion failure with no indication of *why*
 * the backend didn't do what was expected.
 *
 * Pass an instance to `createE2eApp({ logger })` in place of the default
 * `false`, call `logger.clear()` before each test, and on catch print
 * `logger.dump()` before rethrowing.
 */
export class CapturingLogger implements LoggerService {
  private entries: string[] = [];

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.record('LOG', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.record('ERROR', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.record('WARN', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.record('DEBUG', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.record('VERBOSE', message, optionalParams);
  }

  clear(): void {
    this.entries = [];
  }

  dump(): string {
    return this.entries.length > 0
      ? this.entries.join('\n')
      : '(no backend log entries captured)';
  }

  private record(
    level: string,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const rest = optionalParams
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join(' ');
    const text =
      typeof message === 'string' ? message : JSON.stringify(message);
    this.entries.push(`[${level}] ${text}${rest ? ` ${rest}` : ''}`);
  }
}

/**
 * Truncate every table in the public schema except _prisma_migrations.
 * Single TRUNCATE ... CASCADE statement — fast, and resets identity columns.
 * Afterwards re-seeds the default instance roles that InstanceRolesService
 * creates at boot, so the post-reset state matches a freshly-migrated instance.
 *
 * Destructive by design, so it refuses to run unless the database name in
 * DATABASE_URL contains "test" (CI provisions a dedicated `test` database).
 * There is deliberately NO override: an env-var escape hatch documented as
 * the standard local command once wiped a developer's persistent dev
 * database. Local runs must point DATABASE_URL at a dedicated test database
 * instead, e.g.:
 *   docker compose exec postgres createdb -U semaphore semaphore_e2e_local_test
 *   docker compose run --rm \
 *     -e DATABASE_URL=postgresql://semaphore:semaphore@postgres:5432/semaphore_e2e_local_test \
 *     -e REDIS_DB=1 \
 *     backend sh -c 'pnpm run prisma:migrate && pnpm run test:e2e'
 *
 * LOCAL RUNS + BULLMQ: the `-e REDIS_DB=1` above matters when the dev
 * `backend` container is up. The dev container runs BullMQ workers on the
 * same Redis db 0 and `semaphore:jobs` prefix — without isolation it
 * consumes the jobs the e2e app enqueues (message-fanout, link-previews)
 * and processes them against the DEV database, so e2e assertions on job
 * outcomes never see their results. CI's dedicated Redis service has no
 * other consumers, so it doesn't need this.
 *
 * From a worktree (or to keep the dev database out of it entirely), use a
 * per-ticket stack instead: its own Postgres (database `semaphore_test`),
 * Redis and MinIO on the shared semaphore-test network, no REDIS_DB needed:
 *   scripts/test-stack.sh <ticket> run sh -c 'pnpm run prisma:migrate && pnpm run test:e2e'
 */
export async function resetDatabase(app: E2eApp): Promise<void> {
  let dbName: string;
  try {
    dbName = new URL(process.env.DATABASE_URL ?? '').pathname.replace(
      /^\//,
      '',
    );
  } catch {
    throw new Error(
      'resetDatabase() refused: DATABASE_URL is unset or not a parseable ' +
        'URL, so the target database cannot be identified.',
    );
  }
  if (!/test/i.test(dbName)) {
    throw new Error(
      `resetDatabase() refused: DATABASE_URL points at "${dbName}", which ` +
        'does not look like a test database. There is no override — point ' +
        'DATABASE_URL at a database whose name contains "test" (see the ' +
        'resetDatabase doc comment for the local setup commands).',
    );
  }

  const db = app.get(DatabaseService);
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const tableList = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );

  // Boot-time seeding ran before the truncate wiped it; restore the default
  // instance roles so instance-level RBAC behaves like production.
  await app.get(InstanceRolesService).ensureDefaultInstanceRolesExist();
}

/**
 * Create an open instance invite so POST /api/users registration works
 * (registration always requires a valid instance invite code).
 * Mirrors prisma/seed-e2e.ts conventions.
 */
export async function seedInstanceInvite(
  app: E2eApp,
  code: string = E2E_INVITE_CODE,
): Promise<string> {
  const db = app.get(DatabaseService);
  await db.instanceInvite.create({
    data: {
      code,
      maxUses: null, // unlimited
      validUntil: null, // never expires
      disabled: false,
    },
  });
  return code;
}

export interface RegisteredUser {
  id: string;
  username: string;
  role: string;
}

/**
 * Register a user through the real public endpoint.
 * The FIRST user registered after resetDatabase() becomes InstanceRole.OWNER
 * (user.service.ts: userCount === 0 → OWNER), subsequent users are USER.
 */
export async function registerUser(
  app: E2eApp,
  creds: { username: string; password: string; email?: string },
  code: string = E2E_INVITE_CODE,
): Promise<RegisteredUser> {
  const res = await request(app.getHttpServer())
    .post('/api/users')
    .send({ code, ...creds })
    .expect(201);
  return res.body as RegisteredUser;
}

export interface LoginResult {
  accessToken: string;
  /** Full `refresh_token=...` cookie pair (name=value), ready for a Cookie header. */
  refreshCookie: string;
  /** Raw Set-Cookie headers from the login response. */
  setCookies: string[];
}

export function getSetCookies(res: Response): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** Extract the `name=value` pair for a cookie from Set-Cookie headers. */
export function extractCookie(
  setCookies: string[],
  name: string,
): string | undefined {
  const header = setCookies.find((c) => c.startsWith(`${name}=`));
  return header?.split(';')[0];
}

export async function loginUser(
  app: E2eApp,
  username: string,
  password: string,
): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ username, password })
    .expect(200);

  const setCookies = getSetCookies(res);
  const refreshCookie = extractCookie(setCookies, 'refresh_token');
  const body = res.body as { accessToken: string };

  if (!body.accessToken || !refreshCookie) {
    throw new Error(
      'Login did not return an access token and refresh cookie as expected',
    );
  }

  return { accessToken: body.accessToken, refreshCookie, setCookies };
}
