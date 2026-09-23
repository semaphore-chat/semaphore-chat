/**
 * V8 function coverage (CDP `Profiler.takePreciseCoverage` with
 * `callCount: true, detailed: false`) → the project files whose code actually
 * ran while a story rendered. Pure; `probe.ts` collects the coverage.
 *
 * "Ran" means one of the module's own functions was called — a component
 * rendered, a hook ran, a style callback fired — not merely that the module was
 * loaded (static imports load far more than a story renders). Two exclusions:
 *   - the module's top-level function (runs on import);
 *   - Vite's react-refresh trailer, whose `.then(...)` callback runs once on
 *     import in every component module.
 * A module with no functions at all (constants, data) counts when loaded.
 *
 * NB: use `detailed: false`. With block coverage (`detailed: true`, what
 * Playwright's `page.coverage` asks for) V8 reported call counts of 0 for
 * components that had visibly rendered.
 */

import { lineStarts, originalLineSpan, readInlineSourceMap } from './sourcemap.ts';

export interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}
export interface CoverageFunction {
  functionName: string;
  ranges: CoverageRange[];
}
export interface CoverageScript {
  url: string;
  functions: CoverageFunction[];
}

/** How the dev server exposes project dirs, e.g. `/@fs/app/frontend/` → `frontend/`. */
export interface UrlMount {
  urlPrefix: string;
  repoPrefix: string;
}

export const DEFAULT_MOUNTS: UrlMount[] = [
  { urlPrefix: '/@fs/app/frontend/', repoPrefix: 'frontend/' },
  { urlPrefix: '/@fs/app/shared/', repoPrefix: 'shared/' },
];

export function fileFromModuleUrl(url: string, mounts: UrlMount[] = DEFAULT_MOUNTS): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
  if (pathname.includes('/node_modules/')) return null;
  for (const { urlPrefix, repoPrefix } of mounts) {
    if (pathname.startsWith(urlPrefix)) return repoPrefix + decodeURIComponent(pathname.slice(urlPrefix.length));
  }
  return null;
}

const TRAILER = /\nif \(import\.meta\.hot && !inWebWorker\) \{\s*window\.\$RefreshReg\$ = prevRefreshReg/;

/** Offset where the react-refresh trailer starts (source length if none). */
function codeEnd(source: string | undefined): number {
  if (!source) return Number.POSITIVE_INFINITY;
  const match = TRAILER.exec(source);
  return match ? match.index : source.length;
}

export function exercisedFiles(
  scripts: CoverageScript[],
  sources: Map<string, string>,
  mounts: UrlMount[] = DEFAULT_MOUNTS,
): Set<string> {
  const out = new Set<string>();
  for (const script of scripts) {
    const file = fileFromModuleUrl(script.url, mounts);
    if (!file) continue;
    const end = codeEnd(sources.get(script.url));
    const own = script.functions.filter((f, index) => {
      const start = f.ranges[0]?.startOffset ?? 0;
      const isTopLevel = index === 0 && start === 0 && f.functionName === '';
      return !isTopLevel && start < end;
    });
    if (own.length === 0 || own.some((f) => (f.ranges[0]?.count ?? 0) > 0)) out.add(file);
  }
  return out;
}

/** Changed 1-based head lines of a target file, or 'all' (new file / unknown). */
export type TargetLines = number[] | 'all';

/**
 * Like `exercisedFiles`, but line-precise for the changed modules: a target
 * counts only when a function *containing a changed line* ran (mapped through
 * the module's inline source map) — "the component I edited rendered", not
 * "some component in that file rendered". Changes outside every function
 * (imports, top-level styled()/constants, types) and files without a usable
 * map fall back to the module-level rule of `exercisedFiles`.
 */
export function exercisedTargets(
  scripts: CoverageScript[],
  sources: Map<string, string>,
  targets: Map<string, TargetLines>,
  mounts: UrlMount[] = DEFAULT_MOUNTS,
): Set<string> {
  const out = new Set<string>();
  for (const script of scripts) {
    const file = fileFromModuleUrl(script.url, mounts);
    if (!file || !targets.has(file)) continue;
    const lines = targets.get(file)!;
    const source = sources.get(script.url);
    const end = codeEnd(source);
    const own = script.functions.filter((f, index) => {
      const start = f.ranges[0]?.startOffset ?? 0;
      const isTopLevel = index === 0 && start === 0 && f.functionName === '';
      return !isTopLevel && start < end;
    });
    const moduleLevel = own.length === 0 || own.some((f) => (f.ranges[0]?.count ?? 0) > 0);

    const map = lines !== 'all' && source ? readInlineSourceMap(source) : null;
    if (lines === 'all' || !map || !source) {
      if (moduleLevel) out.add(file);
      continue;
    }
    const starts = lineStarts(source);
    const containing = own.filter((f) => {
      const range = f.ranges[0];
      if (!range) return false;
      const span = originalLineSpan(map.segments, starts, range.startOffset, range.endOffset);
      return span !== null && lines.some((line) => line >= span.from && line <= span.to);
    });
    if (containing.length === 0 ? moduleLevel : containing.some((f) => (f.ranges[0]?.count ?? 0) > 0)) out.add(file);
  }
  return out;
}
