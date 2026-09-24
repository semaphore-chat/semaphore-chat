// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseNameStatusZ, parseChangedLines } from '../../../../scripts/ui-review/lib/gitdiff.ts';

describe('parseNameStatusZ', () => {
  it('parses `git diff --name-status -z` output incl. renames (new path wins)', () => {
    const z = ['M', 'frontend/src/a.tsx', 'A', 'frontend/src/b.tsx', 'R087', 'frontend/src/old.tsx', 'frontend/src/new.tsx', 'D', 'frontend/src/gone.tsx', ''].join('\0');
    expect(parseNameStatusZ(z)).toEqual([
      { path: 'frontend/src/a.tsx', status: 'M' },
      { path: 'frontend/src/b.tsx', status: 'A' },
      { path: 'frontend/src/old.tsx', status: 'D' },
      { path: 'frontend/src/new.tsx', status: 'A' },
      { path: 'frontend/src/gone.tsx', status: 'D' },
    ]);
  });

  it('handles empty input', () => {
    expect(parseNameStatusZ('')).toEqual([]);
  });
});

describe('parseChangedLines', () => {
  const diff = [
    'diff --git a/frontend/src/a.tsx b/frontend/src/a.tsx',
    'index 111..222 100644',
    '--- a/frontend/src/a.tsx',
    '+++ b/frontend/src/a.tsx',
    '@@ -10,2 +10,3 @@ function A() {',
    '-x',
    '-y',
    '+x',
    '+y',
    '+z',
    '@@ -40 +41,0 @@',
    '-gone',
    '@@ -50 +50 @@',
    '-a',
    '+b',
    'diff --git a/frontend/src/new.tsx b/frontend/src/new.tsx',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/frontend/src/new.tsx',
    '@@ -0,0 +1,2 @@',
    '+a',
    '+b',
    'diff --git a/frontend/src/del.tsx b/frontend/src/del.tsx',
    'deleted file mode 100644',
    '--- a/frontend/src/del.tsx',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-a',
    'diff --git a/frontend/src/img.png b/frontend/src/img.png',
    'Binary files a/frontend/src/img.png and b/frontend/src/img.png differ',
    'diff --git a/frontend/src/old name.tsx b/frontend/src/renamed.tsx',
    'similarity index 90%',
    'rename from frontend/src/old name.tsx',
    'rename to frontend/src/renamed.tsx',
    '--- "a/frontend/src/old name.tsx"',
    '+++ b/frontend/src/renamed.tsx',
    '@@ -3 +3 @@',
    '-q',
    '+r',
    '',
  ].join('\n');

  const lines = parseChangedLines(diff);

  it('collects added/modified head lines per file and marks both sides of a pure deletion', () => {
    expect(lines.get('frontend/src/a.tsx')).toEqual([10, 11, 12, 41, 42, 50]);
  });

  it('marks new and binary files as whole-file changes, skips deleted files', () => {
    expect(lines.get('frontend/src/new.tsx')).toBe('all');
    expect(lines.get('frontend/src/img.png')).toBe('all');
    expect(lines.has('frontend/src/del.tsx')).toBe(false);
  });

  it('follows renames to the new path', () => {
    expect(lines.get('frontend/src/renamed.tsx')).toEqual([3]);
  });
});
