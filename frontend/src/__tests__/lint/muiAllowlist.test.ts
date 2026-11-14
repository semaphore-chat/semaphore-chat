/**
 * MUI stays inside the kit.
 *
 * `@mui/*` and `@emotion/*` may only be imported from `src/kit`, which is
 * where the Lounge design system lives, and from tests, which build the old
 * themes and `renderWithProviders`. Every old screen and story that still
 * imports MUI directly is listed in `eslint/mui-allowlist.json`, and that list
 * may only shrink: convert a file to the kit, then delete its line. A new
 * story or screen imports from `src/kit`.
 *
 * The ESLint rule (`no-restricted-imports`, in `eslint.config.js`) stops new
 * imports; this test stops the allow-list from disagreeing with the tree, in
 * either direction (a stale entry for a converted file, or a file that imports
 * MUI without an entry). The CI step in `.github/workflows/frontend-tests.yml`
 * stops the list from growing, which a test cannot see.
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import allowListSource from '../../../eslint/mui-allowlist.json?raw';

const { files: allowList } = JSON.parse(allowListSource) as { files: string[] };

/** The directory this test file sits in, as a `src/...` path. */
const TEST_DIR = 'src/__tests__/lint';

/** `key` (relative to this file, from `import.meta.glob`) as a `src/...` path. */
function sourcePath(key: string): string {
  const parts: string[] = [];
  for (const part of `${TEST_DIR}/${key}`.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

/** Every source file under `src`, as `src/...` paths, excluding the two exempt trees. */
const SOURCES = Object.entries(
  import.meta.glob('../../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
)
  .map(([path, source]) => [sourcePath(path), source] as const)
  .filter(([path]) => !path.startsWith('src/kit/') && !path.startsWith('src/__tests__/'));

/**
 * The import and re-export statements in a file, one source per match. Two
 * patterns, both tolerant of line breaks inside braces (`icons.test.tsx` in
 * native/tools/web-export scans imports the same way): `from` statements and
 * side-effect imports (`import '@mui/material/Box'`).
 */
const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[^'";]*?\bfrom\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:[^'";]*?\bfrom\s+)?['"]([^'"]+)['"]/g,
];

/** Modules the lint rule restricts: `@mui/*` and `@emotion/*`. */
const RESTRICTED_SOURCE = /^@(?:mui|emotion)\//;

/** The restricted modules `source` imports. */
function restrictedImports(source: string): string[] {
  return IMPORT_PATTERNS.flatMap((pattern) =>
    [...source.matchAll(pattern)]
      .map((match) => match[1])
      .filter((specifier) => RESTRICTED_SOURCE.test(specifier)),
  );
}

/** The files that still import MUI directly, sorted. */
function filesImportingMui(): string[] {
  return SOURCES.filter(([, source]) => restrictedImports(source).length > 0)
    .map(([path]) => path)
    .sort();
}

describe('MUI allow-list', () => {
  it('lists exactly the files that still import @mui or @emotion', () => {
    const scanned = filesImportingMui();
    const stale = allowList.filter((path) => !scanned.includes(path));
    const missing = scanned.filter((path) => !allowList.includes(path));

    expect(
      { stale, missing },
      'eslint/mui-allowlist.json and the tree disagree. Stale entries are files that no longer ' +
        'import MUI (delete their line); missing entries are files that still import MUI (import ' +
        'from src/kit, or, if that is not possible yet, add the file to the allow-list).',
    ).toEqual({ stale: [], missing: [] });
  });

  it('is sorted and has no duplicates', () => {
    expect(allowList).toEqual([...allowList].sort());
    expect(new Set(allowList).size).toBe(allowList.length);
  });

  describe('the lint rule', () => {
    const BOX_IMPORT =
      "import Box from '@mui/material/Box';\n" +
      'export function NewThing() {\n' +
      '  return <Box />;\n' +
      '}\n';

    /** ESLint's messages for `code` linted as `filePath`. */
    async function lint(code: string, filePath: string) {
      const eslint = new ESLint();
      const [result] = await eslint.lintText(code, { filePath });
      return result.messages;
    }

    it('rejects the import outside the kit and the allow-list', async () => {
      const messages = await lint(BOX_IMPORT, 'src/NewThing.tsx');

      expect(messages.map((message) => message.ruleId)).toEqual(['no-restricted-imports']);
      expect(messages[0].message).toContain(
        'Import from src/kit. MUI is used only inside the kit (design/guide).',
      );
    });

    it('allows it inside the kit', async () => {
      expect(await lint(BOX_IMPORT, 'src/kit/NewThing.tsx')).toEqual([]);
    });

    it('allows it for an allow-listed file', async () => {
      expect(await lint(BOX_IMPORT, allowList[0])).toEqual([]);
    });
  });
});
