import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * "No scattered rules": channel visibility (who can see a channel, its name,
 * id and content) is decided ONLY by the roles module
 * (ChannelAccessService / PermissionsService / channel-permissions.util).
 * This test fails if source elsewhere reads `isPrivate` or filters on
 * ChannelMembership itself.
 *
 * Exempt:
 * - src/roles/ (the permissions module) and src/channel-membership/ (the
 *   CRUD for the ChannelMembership table itself, whose own validations are
 *   not visibility checks);
 * - specs, test utilities and DTOs;
 * - a line marked `channel-visibility:` (on it or the line above) with a
 *   reason, for writes and other non-visibility uses.
 */
const SRC = join(__dirname, '..');

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\.isPrivate\b/, why: 'reads isPrivate' },
  { pattern: /\bisPrivate\s*:\s*(true|false)\b/, why: 'filters on isPrivate' },
  {
    pattern: /\bChannelMembership\s*:\s*\{/,
    why: 'filters channels by ChannelMembership',
  },
  {
    pattern:
      /\bchannelMembership\.(findFirst|findUnique|findMany|count|groupBy|aggregate)\b/,
    why: 'reads ChannelMembership',
  },
];

const EXEMPT_DIRS = ['roles', 'channel-membership', 'test-utils'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

function isExempt(rel: string): boolean {
  const [top] = rel.split(sep);
  return (
    EXEMPT_DIRS.includes(top) ||
    rel.endsWith('.spec.ts') ||
    rel.split(sep).includes('dto')
  );
}

describe('channel visibility boundary', () => {
  it('only the roles module decides channel visibility', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (isExempt(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        const marked =
          line.includes('channel-visibility:') ||
          (i > 0 && lines[i - 1].includes('channel-visibility:'));
        if (marked) return;
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(line)) {
            violations.push(`${rel}:${i + 1} ${why}: ${line.trim()}`);
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('flags a hand-rolled check (self-test)', () => {
    const sample =
      'where: { OR: [{ isPrivate: false }, { ChannelMembership: { some: { userId } } }] }';
    expect(FORBIDDEN.some(({ pattern }) => pattern.test(sample))).toBe(true);
  });
});
