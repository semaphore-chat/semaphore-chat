/**
 * Startup check of the signing secrets: JWT_SECRET, JWT_REFRESH_SECRET and
 * LIVEKIT_API_SECRET. Runs in main.ts before NestFactory.create().
 *
 * Strict (refuses to start) in every mode except development and test, so
 * an instance started without NODE_ENV is held to production rules too
 * (Dockerfile.prod sets NODE_ENV=production). development only warns, and
 * test skips the check.
 *
 * A placeholder secret is public: anyone could sign an access token for any
 * user (JWT) or join and control every voice room (LiveKit).
 */

const MIN_SECRET_LENGTH = 32;

/** Exact values shipped in env.sample (and older docs). */
const KNOWN_WEAK_SECRETS = [
  'some long elaborate secret that you really need to change',
  'a different long elaborate secret to change',
  'secret-that-is-at-least-32-characters-long',
];

/**
 * Text found in the placeholders the docs, README, env.sample and Helm
 * values have shipped ("replace-with-...", "CHANGE-ME-...", "your-...").
 */
const PLACEHOLDER_PATTERN =
  /change[-_ ]?me|replace[-_ ]?with|your[-_ ]|example|devkey|secret-that-is-at-least|elaborate secret/i;

const FIX_HINT = "Generate one with: openssl rand -base64 64 | tr -d '\\n'";

/** Why `value` is unusable as a secret, or undefined if it is fine. */
function weakness(value: string): string | undefined {
  if (KNOWN_WEAK_SECRETS.includes(value) || PLACEHOLDER_PATTERN.test(value)) {
    return 'is a published placeholder value';
  }
  if (value.length < MIN_SECRET_LENGTH) {
    return `is shorter than ${MIN_SECRET_LENGTH} characters`;
  }
  return undefined;
}

/** Every problem with the secrets in `env`, one line each, never the values. */
function secretProblems(env: NodeJS.ProcessEnv, strict: boolean): string[] {
  const problems: string[] = [];

  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = env[key];
    if (!value) {
      // Outside strict mode, ConfigModule's validation reports what's missing
      if (strict) problems.push(`${key} is not set.`);
      continue;
    }
    const why = weakness(value);
    if (why) problems.push(`${key} ${why}.`);
  }

  if (
    env.JWT_SECRET &&
    env.JWT_REFRESH_SECRET &&
    env.JWT_SECRET === env.JWT_REFRESH_SECRET
  ) {
    problems.push(
      'JWT_SECRET and JWT_REFRESH_SECRET are the same value; they must differ.',
    );
  }

  // LiveKit is optional (all three of its variables or none, checked by
  // validateEnv); check its secret when there is one.
  const livekitSecret = env.LIVEKIT_API_SECRET;
  if (livekitSecret) {
    const why = weakness(livekitSecret);
    if (why) {
      problems.push(
        `LIVEKIT_API_SECRET ${why}. Set the new value in your LiveKit server's keys too.`,
      );
    }
  }

  return problems;
}

export function validateSecrets(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): void {
  if (env.NODE_ENV === 'test') return;
  const strict = env.NODE_ENV !== 'development';

  const problems = secretProblems(env, strict);
  if (problems.length === 0) return;

  const detail = problems.map((p) => `  - ${p}`).join('\n');
  if (strict) {
    throw new Error(
      'SECURITY: refusing to start with unsafe secrets ' +
        `(NODE_ENV=${env.NODE_ENV ?? 'unset'}):\n${detail}\n${FIX_HINT} ` +
        '(a different value for each variable).',
    );
  }
  warn(
    `\n⚠️  WARNING: unsafe secrets (allowed only because NODE_ENV=development):\n${detail}\n${FIX_HINT}\n`,
  );
}

/**
 * Startup warning for COOKIE_SECURE=auto (the default) without TRUST_PROXY,
 * outside development and test: auth cookies are Secure only when the
 * request counts as HTTPS (req.secure), which behind a TLS-terminating
 * proxy needs TRUST_PROXY to believe its X-Forwarded-Proto. Without it the
 * cookies go out without Secure on an HTTPS site.
 */
export function warnCookieSecureWithoutTrustProxy(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): void {
  if (env.NODE_ENV === 'test' || env.NODE_ENV === 'development') return;
  const mode = (env.COOKIE_SECURE ?? 'auto').toLowerCase();
  if (mode !== 'auto' || env.TRUST_PROXY) return;
  warn(
    '\n⚠️  WARNING: COOKIE_SECURE is auto and TRUST_PROXY is not set: behind an ' +
      'HTTPS reverse proxy the auth cookies will not be marked Secure, because ' +
      'the backend cannot tell the request was HTTPS. Set TRUST_PROXY to the ' +
      'number of proxy hops (usually 1), or set COOKIE_SECURE=true.\n',
  );
}
