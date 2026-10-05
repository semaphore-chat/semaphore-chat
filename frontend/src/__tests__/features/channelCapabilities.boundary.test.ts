import { describe, it, expect } from 'vitest';

/**
 * "No scattered rules" (frontend): what a user can do in a channel comes
 * only from useChannelPermissions (GET .../permissions/me, already resolved
 * by the server: overwrites, private channels, timeouts). No component,
 * page, hook or feature may check channel-scoped actions through roles
 * itself, so this fails if one names those actions.
 */
const CHANNEL_ACTIONS =
  /(['"`]|RBAC_ACTIONS\.)(READ_CHANNEL|CREATE_MESSAGE|ATTACH_FILES|CREATE_REACTION|JOIN_CHANNEL|SPEAK|VIDEO|SCREEN_SHARE)\b/;

const EXEMPT = ['/hooks/useChannelPermissions.ts'];

function codeLines(source: string): string[] {
  // Ignore comments (line and block-comment lines)
  return source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
}

describe('channel capabilities boundary', () => {
  it('only useChannelPermissions decides channel capabilities', () => {
    const sources = import.meta.glob(
      '../../{components,pages,hooks,features}/**/*.{ts,tsx}',
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(50);

    const violations = Object.entries(sources).flatMap(([path, source]) =>
      EXEMPT.some((e) => path.endsWith(e))
        ? []
        : codeLines(source)
            .filter((line) => CHANNEL_ACTIONS.test(line))
            .map((line) => `${path}: ${line}`),
    );
    expect(violations).toEqual([]);
  });

  it('catches a role-based check (self-test)', () => {
    expect(CHANNEL_ACTIONS.test('actions: ["CREATE_MESSAGE"],')).toBe(true);
    expect(CHANNEL_ACTIONS.test('RBAC_ACTIONS.ATTACH_FILES')).toBe(true);
    expect(CHANNEL_ACTIONS.test('const canSpeak = can("speak")')).toBe(false);
  });
});
