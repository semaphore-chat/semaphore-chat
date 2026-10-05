import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Every hard-coded action list that lets a role join voice must also let it
 * speak. SPEAK (with VIDEO and SCREEN_SHARE) arrived after JOIN_CHANNEL (#570),
 * and the migration only backfilled the roles that existed when it ran, so a
 * list written before then still creates roles that join voice and can't use
 * the microphone (the LiveKit token gets canPublish: false). The e2e seed's
 * Member role did exactly that and broke the real-LiveKit voice E2E.
 *
 * Scans the backend's source and its prisma seed scripts (not specs: tests
 * build such roles on purpose).
 */

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src', 'prisma'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'migrations'
        ? []
        : sourceFiles(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

/** Array literals whose elements include `RbacActions.<action>`. */
function arraysNaming(
  file: string,
  action: string,
): ts.ArrayLiteralExpression[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: ts.ArrayLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isArrayLiteralExpression(node) &&
      node.elements.some((e) => e.getText(source) === `RbacActions.${action}`)
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('hard-coded role action lists', () => {
  const files = SCANNED_DIRS.flatMap((dir) =>
    sourceFiles(path.join(BACKEND_ROOT, dir)),
  );

  it('scans the role configs and the seeds', () => {
    const names = files.map((f) => path.relative(BACKEND_ROOT, f));
    expect(names).toEqual(
      expect.arrayContaining([
        path.join('src', 'roles', 'default-roles.config.ts'),
        path.join('prisma', 'seed.ts'),
        path.join('prisma', 'seed-e2e.ts'),
      ]),
    );
  });

  it('include SPEAK wherever they include JOIN_CHANNEL', () => {
    const offenders = files.flatMap((file) =>
      arraysNaming(file, 'JOIN_CHANNEL')
        .filter(
          (array) =>
            !array.elements.some((e) => e.getText() === 'RbacActions.SPEAK'),
        )
        .map((array) => {
          const { line } = array
            .getSourceFile()
            .getLineAndCharacterOfPosition(array.getStart());
          return `${path.relative(BACKEND_ROOT, file)}:${line + 1}`;
        }),
    );
    expect(offenders).toEqual([]);
  });

  it('catches a pre-SPEAK list', () => {
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'role-actions-')),
      'stale.ts',
    );
    fs.writeFileSync(
      tmp,
      'const a = [RbacActions.READ_CHANNEL, RbacActions.JOIN_CHANNEL];\n' +
        'const b = [RbacActions.JOIN_CHANNEL, RbacActions.SPEAK];\n',
    );
    const lists = arraysNaming(tmp, 'JOIN_CHANNEL');
    expect(lists).toHaveLength(2);
    expect(
      lists.filter(
        (l) => !l.elements.some((e) => e.getText() === 'RbacActions.SPEAK'),
      ),
    ).toHaveLength(1);
  });
});
