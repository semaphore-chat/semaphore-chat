/**
 * The new shell's chunk and the shared data layer stay headless
 * (design report §2, enforcement 2).
 *
 * The ESLint block for `src/data/**`, `src/features/chat/**` and `src/shell/lounge/**` (eslint.config.js)
 * stops direct imports; it cannot see transitive ones, such as a headless-looking
 * hook that imports a component type or the old snackbar (design F6). This test
 * walks every static import (regex over the source, `import type` and
 * all-`type` specifier lists skipped, dynamic `import()` not followed: a lazy
 * chunk is its own boundary) from those three trees and fails on any path into:
 *
 * - `src/components/` or `src/pages/` (the classic UI),
 * - `@mui/icons-material` (the kit uses Lucide),
 * - `src/contexts/NotificationContext` (its module renders an MUI Snackbar),
 * - `@mui/*` or `@emotion/*` imported by any module that is not in `src/kit/` (MUI is the kit's own),
 * - a `livekit-client` value import outside `src/shell/lounge/call/surface/`
 *   (the lazy call-surface chunk),
 * - the raw socket (`src/utils/SocketContext`, `SocketProvider`, `socketSingleton`, and `src/hooks/useSocket`)
 *   from anywhere but the named emitters in `SOCKET_EMITTERS`: the hooks that own one kind of socket traffic each.
 *   The new shell reads server state from the query cache (kept live by socket-hub) or `useServerEvent`; what it
 *   sends goes through one of these hooks. A new kind of socket use from these trees is a new, reviewed entry.
 */
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/** The directory this test file sits in, as a `src/...` path. */
const TEST_DIR = 'src/__tests__/shell';

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

const SOURCES = new Map(
  Object.entries(import.meta.glob('../../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }))
    .map(([key, source]) => [normalize(`${TEST_DIR}/${key}`), source as string] as const)
    .filter(([path]) => !path.startsWith('src/__tests__/') && !path.startsWith('src/stories/')),
);

/**
 * Known exceptions: reached, but not walked into. Each names who removes it.
 * Only the listed importer may reach it.
 */
const EXCEPTIONS: Record<string, { from: string; why: string }> = {
  'src/contexts/ThemeContext.tsx': {
    from: 'src/hooks/useAppearance.ts',
    why:
      "the user's appearance settings live in the app's ThemeProvider (App, already in the first load, so the " +
      'chunk pays nothing); it builds the classic MUI theme too. Goes when the settings move to a store of their own',
  },
};

/** The raw socket: reached only by the named emitters below. */
const RAW_SOCKET = ['src/utils/SocketContext.ts', 'src/utils/SocketProvider.tsx', 'src/utils/socketSingleton.ts', 'src/hooks/useSocket.ts'];

/**
 * The named emitters: each file may reach the raw socket target it lists, for the one kind of traffic it owns.
 * Keyed by the importer; the value names the targets it may reach and why.
 */
const SOCKET_EMITTERS: Record<string, { targets: readonly string[]; why: string }> = {
  'src/hooks/useMessageVisibility.ts': {
    targets: ['src/utils/SocketContext.ts'],
    why: 'MARK_AS_READ: the debounced read mark of a conversation (useReadMarks, both shells)',
  },
  'src/hooks/useSendMessage.ts': {
    targets: ['src/utils/SocketContext.ts'],
    why:
      'SEND_MESSAGE: sending a message and retrying a failed one (the composer through useMessageFileUpload and ' +
      'useOptimisticSendMessage, a failed row through useOptimisticMessageRetry; both shells)',
  },
  'src/hooks/useTypingEmitter.ts': {
    targets: ['src/hooks/useSocket.ts'],
    why: 'TYPING_START / TYPING_STOP: the composer saying the reader is typing (both shells)',
  },
  'src/data/connection.ts': {
    targets: ['src/hooks/useSocket.ts'],
    why: 'useSocketConnected only: whether the socket is connected (the offline banner), no traffic',
  },
  'src/utils/signOutSession.ts': {
    targets: ['src/utils/socketSingleton.ts'],
    why: 'disconnectSocket only: signing out closes the socket (the user card, both shells)',
  },
  'src/utils/endLocalSession.ts': {
    targets: ['src/utils/socketSingleton.ts'],
    why: 'disconnectSocket only: ending the local session closes the socket',
  },
  'src/hooks/useSocket.ts': {
    targets: ['src/utils/SocketContext.ts'],
    why: 'the socket context accessor itself; reached only through the emitters above',
  },
};

/**
 * The socket module: the only files that may import `socket.io-client` values (a second `io()` connection anywhere
 * else would bypass the hub). What this cannot see statically: a hook that takes a socket as an argument (as
 * `utils/sendAck.ts` does) imports nothing of the socket itself, so whoever hands it the socket is what is checked.
 */
const SOCKET_MODULE = ['src/utils/socketSingleton.ts', 'src/utils/SocketContext.ts', 'src/utils/SocketProvider.tsx'];

/** Comments out, so an import quoted in a comment is not an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1');
}

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
  /** `import('...')`: a lazy chunk. Checked where it points, not walked into. */
  dynamic?: boolean;
}

const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const FROM_STATEMENT = /\b(import|export)\s+(type\s+)?([^'";]*?)\bfrom\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /\bimport\s+['"]([^'"]+)['"]/g;

/** The static imports and re-exports of `source`. */
export function importsOf(source: string): ImportRef[] {
  const code = stripComments(source);
  const refs: ImportRef[] = [];
  for (const match of code.matchAll(FROM_STATEMENT)) {
    const [, , typeKeyword, clause, specifier] = match;
    const named = /^\s*\{([\s\S]*)\}\s*$/.exec(clause);
    const allTypeSpecifiers =
      named !== null &&
      named[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith('type '));
    refs.push({ specifier, typeOnly: Boolean(typeKeyword) || allTypeSpecifiers });
  }
  for (const match of code.matchAll(SIDE_EFFECT_IMPORT)) refs.push({ specifier: match[1], typeOnly: false });
  for (const match of code.matchAll(DYNAMIC_IMPORT)) refs.push({ specifier: match[1], typeOnly: false, dynamic: true });
  return refs;
}

/** A relative specifier as a source file in the tree, or null (assets, JSON, unknown). */
function resolve(from: string, specifier: string, sources: ReadonlyMap<string, string>): string | null {
  const dir = from.split('/').slice(0, -1).join('/');
  const base = normalize(`${dir}/${specifier.split('?')[0]}`);
  const stem = base.replace(/\.js$/, '');
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/** Why `importer` may not import `target` (the raw socket), or null. */
function socketViolation(target: string, importer: string, typeOnly: boolean): string | null {
  if (!RAW_SOCKET.includes(target) || typeOnly) return null;
  return SOCKET_EMITTERS[importer]?.targets.includes(target) ? null : 'the raw socket outside the named emitters';
}

/** Why `target` (a file or a package) may not be reached from `root`, or null. */
function violation(target: string, importer: string, typeOnly: boolean): string | null {
  if (target === 'socket.io-client' && !typeOnly && !SOCKET_MODULE.includes(importer)) {
    return 'a socket.io-client value outside the socket module';
  }
  if (target.startsWith('src/components/') || target.startsWith('src/pages/')) return 'classic UI';
  if (target.startsWith('src/contexts/NotificationContext')) return 'renders an MUI Snackbar';
  if (target === '@mui/icons-material' || target.startsWith('@mui/icons-material/')) return 'MUI icons (the kit uses Lucide)';
  // MUI is the kit's implementation: reached only through src/kit, never through another module.
  const mui = target.startsWith('@mui/') || target.startsWith('@emotion/');
  if (mui && !typeOnly && !importer.startsWith('src/kit/')) return 'MUI outside the kit';
  const livekit = target === 'livekit-client' || target.startsWith('livekit-client/');
  if (livekit && !typeOnly && !importer.startsWith('src/shell/lounge/call/surface/')) {
    return 'a livekit-client value outside the lazy call surface';
  }
  return null;
}

/** Every forbidden path from the files under `prefix`, as "a -> b -> target (reason)". */
export function forbiddenPaths(prefix: string, sources: ReadonlyMap<string, string> = SOURCES): string[] {
  const roots = [...sources.keys()].filter((path) => path.startsWith(prefix));
  const parent = new Map<string, string | null>(roots.map((root) => [root, null]));
  const queue = [...roots];
  const found: string[] = [];
  const chain = (file: string): string[] => {
    const links: string[] = [];
    for (let at: string | null = file; at !== null; at = parent.get(at) ?? null) links.unshift(at);
    return links;
  };

  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const { specifier, typeOnly, dynamic } of importsOf(sources.get(file)!)) {
      if (!specifier.startsWith('.')) {
        // A lazy livekit chunk is fine anywhere; a lazy classic UI module is not.
        const reason = dynamic && specifier.startsWith('livekit-client') ? null : violation(specifier, file, typeOnly);
        if (reason) found.push(`${[...chain(file), specifier].join(' -> ')} (${reason})`);
        continue;
      }
      if (typeOnly) continue;
      const target = resolve(file, specifier, sources);
      if (target === null) {
        // Assets (CSS, JSON, images, ?raw) are fine; a source module we cannot find would hide its imports.
        if (!/\.(css|json|svg|png|webp|jpe?g|woff2?|wav|mp3)(\?.*)?$|\?/.test(specifier)) {
          found.push(`${[...chain(file), specifier].join(' -> ')} (unresolved import: the walker cannot see past it)`);
        }
        continue;
      }
      // The raw socket is about who imports it, not whether it was reached before: check every importer.
      const socketReason = socketViolation(target, file, typeOnly);
      if (socketReason) {
        found.push(`${[...chain(file), target].join(' -> ')} (${socketReason})`);
        continue;
      }
      if (parent.has(target)) continue;
      const exception = EXCEPTIONS[target];
      if (exception && exception.from === file) continue;
      const reason = violation(target, file, typeOnly);
      if (reason) {
        found.push(`${[...chain(file), target].join(' -> ')} (${reason})`);
        continue;
      }
      // A lazy chunk is its own boundary: checked where it points (above), not walked into.
      if (dynamic) continue;
      parent.set(target, file);
      queue.push(target);
    }
  }
  return found;
}

describe('the new shell and the data layer stay headless', () => {
  it('scans the trees it guards', () => {
    expect([...SOURCES.keys()].some((p) => p.startsWith('src/data/'))).toBe(true);
    expect([...SOURCES.keys()].some((p) => p.startsWith('src/shell/lounge/'))).toBe(true);
    expect([...SOURCES.keys()].some((p) => p.startsWith('src/features/chat/'))).toBe(true);
  });

  it('src/data reaches no classic UI, MUI icons, old snackbar or livekit-client value', () => {
    expect(forbiddenPaths('src/data/')).toEqual([]);
  });

  it('src/features/chat (the shared message list core) reaches none of them either', () => {
    expect(forbiddenPaths('src/features/chat/')).toEqual([]);
  });

  it('src/shell/lounge reaches none of them either (except the listed exceptions)', () => {
    expect(forbiddenPaths('src/shell/lounge/')).toEqual([]);
  });

  it('catches what a direct-import lint cannot: dynamic, subpath, transitive and unresolved', () => {
    const tree = new Map([
      ['src/data/a.ts', "export const load = () => import('../components/Big');\nimport './b';"],
      ['src/data/b.ts', "import { x } from 'livekit-client/dist/x';\nimport { y } from './c.js';\nimport { z } from './missing';"],
      ['src/data/c.ts', "import { Z } from '../hooks/leaky';"],
      ['src/hooks/leaky.ts', "import { Snackbar } from '../contexts/NotificationContext';\nimport { useMediaQuery } from '@mui/material';"],
      ['src/components/Big.tsx', ''],
      ['src/contexts/NotificationContext.tsx', ''],
    ]);
    expect(forbiddenPaths('src/data/', tree)).toEqual([
      'src/data/a.ts -> src/components/Big.tsx (classic UI)',
      'src/data/b.ts -> livekit-client/dist/x (a livekit-client value outside the lazy call surface)',
      'src/data/b.ts -> ./missing (unresolved import: the walker cannot see past it)',
      'src/data/c.ts -> src/hooks/leaky.ts -> src/contexts/NotificationContext.tsx (renders an MUI Snackbar)',
      'src/data/c.ts -> src/hooks/leaky.ts -> @mui/material (MUI outside the kit)',
    ]);
  });

  it('no file under src/shell, src/kit, src/data or src/features imports a socket.io-client value', () => {
    const offenders = [...SOURCES.entries()]
      .filter(([path]) => /^src\/(shell|kit|data|features)\//.test(path))
      .filter(([, source]) => importsOf(source).some((ref) => ref.specifier === 'socket.io-client' && !ref.typeOnly))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    // The rule bites, directly and through a walked hook.
    const tree = new Map([
      ['src/data/a.ts', "import { io } from 'socket.io-client';\nimport { x } from '../hooks/second';"],
      ['src/hooks/second.ts', "import { io } from 'socket.io-client';"],
    ]);
    expect(forbiddenPaths('src/data/', tree)).toEqual([
      'src/data/a.ts -> socket.io-client (a socket.io-client value outside the socket module)',
      'src/data/a.ts -> src/hooks/second.ts -> socket.io-client (a socket.io-client value outside the socket module)',
    ]);
  });

  it('the raw socket is reached only through a named emitter', () => {
    const tree = new Map([
      ['src/data/a.ts', "import { useMessageVisibility } from '../hooks/useMessageVisibility';\nimport { x } from '../hooks/sneaky';"],
      ['src/hooks/useMessageVisibility.ts', "import { SocketContext } from '../utils/SocketContext';"],
      ['src/hooks/sneaky.ts', "import { SocketContext } from '../utils/SocketContext';\nimport { useSocket } from './useSocket';"],
      ['src/hooks/useSocket.ts', "import { SocketContext } from '../utils/SocketContext';"],
      ['src/utils/SocketContext.ts', ''],
    ]);
    expect(forbiddenPaths('src/data/', tree)).toEqual([
      'src/data/a.ts -> src/hooks/sneaky.ts -> src/utils/SocketContext.ts (the raw socket outside the named emitters)',
      'src/data/a.ts -> src/hooks/sneaky.ts -> src/hooks/useSocket.ts (the raw socket outside the named emitters)',
    ]);
  });

  it('reads imports the way the walker needs', () => {
    expect(importsOf("import type { Room } from 'livekit-client';")).toEqual([{ specifier: 'livekit-client', typeOnly: true }]);
    expect(importsOf("import { type Room, type Track } from 'livekit-client';")[0].typeOnly).toBe(true);
    expect(importsOf("import { Room, type Track } from 'livekit-client';")[0].typeOnly).toBe(false);
    expect(importsOf("import Box from '@mui/material/Box';")[0].specifier).toBe('@mui/material/Box');
    expect(importsOf("export { a } from './a';")[0].specifier).toBe('./a');
    expect(importsOf("import './side-effect';")).toEqual([{ specifier: './side-effect', typeOnly: false }]);
    expect(importsOf("// import { Room } from 'livekit-client'\nconst url = 'http://x';")).toEqual([]);
    expect(importsOf("const m = await import('./lazy');")).toEqual([{ specifier: './lazy', typeOnly: false, dynamic: true }]);
  });
});

describe('the lint block for src/data, src/features/chat and src/shell/lounge (eslint.config.js)', () => {
  async function rulesHit(code: string, filePath: string): Promise<string[]> {
    const [result] = await new ESLint().lintText(code, { filePath });
    // The restriction rules only (a one-line sample also trips no-unused-vars), each once
    return [...new Set(result.messages.map((m) => m.ruleId ?? 'parse').filter((id) => /restricted-imports|^parse$/.test(id)))];
  }
  const restricted = ['no-restricted-imports'];

  it.each([
    ["import { Box } from '@mui/material';", 'src/data/x.ts'],
    ["import { ChannelRow } from '../components/Channel/ChannelRow';", 'src/data/x.ts'],
    ["import HomePage from '../pages/HomePage';", 'src/data/x.ts'],
    ["import { useResponsive } from '../hooks/useResponsive';", 'src/data/x.ts'],
    ["import { useScreenShare } from '../hooks/useScreenShare';", 'src/data/x.ts'],
    ["import { useSocket } from '../hooks/useSocket';", 'src/data/x.ts'],
    ["import { SocketContext } from '../utils/SocketContext';", 'src/data/x.ts'],
    ["import { useNotification } from '../contexts/NotificationContext';", 'src/data/x.ts'],
    ["import { darkTheme } from '../theme/theme';", 'src/data/x.ts'],
    ["import { Button } from '../kit/primitives/Button';", 'src/data/x.ts'],
    ["import { stepToastQueue } from '../kit/behaviour/toastQueue';", 'src/data/x.ts'],
    ["import { ErrorBoundary } from '../../components/ErrorBoundary';", 'src/data/sub/x.ts'],
    ["import { ChannelRow } from '../../components/Channel/ChannelRow';", 'src/shell/lounge/x.tsx'],
    ["import { ErrorBoundary } from '../../components/ErrorBoundary';", 'src/shell/lounge/x.tsx'],
    ["import { ErrorBoundary } from '../../components/ErrorBoundary';", 'src/shell/lounge/LoungeRoot.tsx'],
    ["import { getSocketSingleton } from '../utils/socketSingleton';", 'src/data/x.ts'],
    ["import { SocketProvider } from '../../utils/SocketProvider';", 'src/shell/lounge/x.tsx'],
    ["import { Box } from '@mui/material';", 'src/features/chat/x.tsx'],
    ["import MessageComponent from '../../components/Message/MessageComponent';", 'src/features/chat/x.tsx'],
    ["import { useNotification } from '../../contexts/NotificationContext';", 'src/features/chat/x.tsx'],
  ])('rejects %s in %s', async (code, filePath) => {
    expect(await rulesHit(code, filePath)).toEqual(restricted);
  });

  it('rejects a livekit-client value import, allows its types, and allows values in the call surface', async () => {
    expect(await rulesHit("import { Room } from 'livekit-client';\nexport const r = Room;", 'src/data/x.ts')).toEqual([
      '@typescript-eslint/no-restricted-imports',
    ]);
    expect(await rulesHit("import type { Room } from 'livekit-client';\nexport type R = Room;", 'src/data/x.ts')).toEqual([]);
    expect(
      await rulesHit("import { Room } from 'livekit-client';\nexport const r = Room;", 'src/shell/lounge/call/surface/x.ts'),
    ).toEqual([]);
    expect(await rulesHit("import { x } from 'livekit-client/dist/sub';\nexport const r = x;", 'src/data/x.ts')).toEqual([
      '@typescript-eslint/no-restricted-imports',
    ]);
  });

  it('allows the headless layer its own imports', async () => {
    const code = [
      "import { useQuery } from '@tanstack/react-query';",
      "import { useSocketConnected } from '../hooks/useSocket';",
      "import { usePushToTalkStatus } from '../hooks/usePushToTalk';",
      "import { useScreenShareSession } from '../hooks/useScreenShareSession';",
      "import { Button } from '../kit';",
      'export const all = [useQuery, useSocketConnected, usePushToTalkStatus, useScreenShareSession, Button];',
    ].join('\n');
    expect(await rulesHit(code, 'src/data/x.ts')).toEqual([]);
  });

  it('lets a screen module export its descriptor beside its components', async () => {
    const code = "export function Body() { return null; }\nconst screen = { template: 'bare', Body };\nexport default screen;";
    const [result] = await new ESLint().lintText(code, { filePath: 'src/shell/lounge/screens/X.tsx' });
    expect(result.messages.map((m) => m.ruleId)).not.toContain('react-refresh/only-export-components');
  });
});
