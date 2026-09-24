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

import { lineStarts, originalLineSpan, readInlineSourceMap, type Segment } from './sourcemap.ts';

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

/** A React component module (Vite's react-refresh wrapper registers its components). */
function isComponentModule(source: string | undefined): boolean {
  return !!source && TRAILER.test(source);
}

/** The module's own functions: not its top-level function, not the react-refresh trailer. */
function ownFunctions(script: CoverageScript, source: string | undefined): CoverageFunction[] {
  const end = codeEnd(source);
  return script.functions.filter((f, index) => {
    const start = f.ranges[0]?.startOffset ?? 0;
    const isTopLevel = index === 0 && start === 0 && f.functionName === '';
    return !isTopLevel && start < end;
  });
}

const called = (f: CoverageFunction) => (f.ranges[0]?.count ?? 0) > 0;

/** Loaded, and function-free or one of its own functions ran. */
function moduleRan(own: CoverageFunction[]): boolean {
  return own.length === 0 || own.some(called);
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
    if (moduleRan(ownFunctions(script, sources.get(script.url)))) out.add(file);
  }
  return out;
}

/** Changed 1-based head lines of a target file, or 'all' (new file / unknown). */
export type TargetLines = number[] | 'all';

/** Repo file → the repo files that import it (statically or dynamically), from the module graph. */
export type ImporterMap = Map<string, string[]>;

/** How far `importerRan` walks up through function-free modules (barrels, re-exports). */
export const IMPORTER_DEPTH = 4;

/**
 * Whether a changed original line produced runtime code: it maps to generated
 * code (types and comments don't) that isn't an import/re-export statement.
 */
function liveLine(segments: Segment[], generatedLines: string[], line: number): boolean {
  for (const seg of segments) {
    if (seg.sourceIndex !== 0 || seg.origLine + 1 !== line) continue;
    const text = (generatedLines[seg.genLine] ?? '').trimStart();
    if (/^import[\s{*"']/.test(text) || /^export\s.*\sfrom\s/.test(text)) continue;
    return true;
  }
  return false;
}

/**
 * Like `exercisedFiles`, but line-precise for the changed modules: a changed
 * line inside a function counts only when that function ran (mapped through the
 * module's inline source map) — "the component I edited rendered", not "some
 * component in that file rendered".
 *
 * A changed line outside every function (a top-level constant, a static
 * `styled()` object) takes effect wherever the module's values are used:
 *   - in a component module: by its own components → one of its functions ran;
 *   - in any other module (constants, utils, style helpers): also by the code
 *     that imports it → one of its functions ran, or a function of a module that
 *     imports it ran (walking up through function-free barrels; needs
 *     `importers`). So a constants file whose helpers never run still counts
 *     where the components that read its constants render.
 * Changed lines that produce no code (types, comments, imports) on their own,
 * whole-file targets (new files) and modules without a usable source map use
 * the module-level rule (with the importer walk for non-component modules).
 */
export function exercisedTargets(
  scripts: CoverageScript[],
  sources: Map<string, string>,
  targets: Map<string, TargetLines>,
  mounts: UrlMount[] = DEFAULT_MOUNTS,
  importers: ImporterMap = new Map(),
): Set<string> {
  // Project modules loaded on this page (one module can show up under several URLs).
  const loaded = new Map<string, { own: CoverageFunction[]; source: string | undefined }[]>();
  for (const script of scripts) {
    const file = fileFromModuleUrl(script.url, mounts);
    if (!file) continue;
    const source = sources.get(script.url);
    if (!loaded.has(file)) loaded.set(file, []);
    loaded.get(file)!.push({ own: ownFunctions(script, source), source });
  }

  /** A module importing `file` (directly, or through function-free modules) ran one of its functions. */
  const importerRan = (file: string): boolean => {
    const seen = new Set<string>([file]);
    let frontier = [file];
    for (let depth = 0; depth < IMPORTER_DEPTH && frontier.length; depth++) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const importer of importers.get(f) ?? []) {
          if (seen.has(importer)) continue;
          seen.add(importer);
          const entries = loaded.get(importer);
          if (!entries) continue; // not loaded on this page
          if (entries.some((e) => e.own.some(called))) return true;
          if (entries.every((e) => e.own.length === 0)) next.push(importer); // barrel/data: keep walking
        }
      }
      frontier = next;
    }
    return false;
  };

  const out = new Set<string>();
  for (const [file, entries] of loaded) {
    const lines = targets.get(file);
    if (lines === undefined) continue;
    const source = entries.find((e) => e.source)?.source;
    const own = entries.flatMap((e) => e.own);
    const moduleLevel = moduleRan(own);
    const topLevel = () => moduleLevel || (!isComponentModule(source) && importerRan(file));

    const map = lines !== 'all' && source ? readInlineSourceMap(source) : null;
    if (lines === 'all' || !map || !source) {
      if (topLevel()) out.add(file);
      continue;
    }
    const starts = lineStarts(source);
    const spans = own.map((f) => {
      const range = f.ranges[0];
      return range ? originalLineSpan(map.segments, starts, range.startOffset, range.endOffset) : null;
    });
    const inFunction = (line: number) => spans.some((s) => s !== null && line >= s.from && line <= s.to);
    const containing = own.filter((_, i) => {
      const span = spans[i];
      return span !== null && lines.some((line) => line >= span.from && line <= span.to);
    });
    const generated = source.split('\n');
    const topLines = lines.filter((line) => !inFunction(line) && liveLine(map.segments, generated, line));

    const hit =
      containing.length === 0 && topLines.length === 0
        ? topLevel() // nothing to pin down: types, comments or imports only
        : containing.some(called) || (topLines.length > 0 && topLevel());
    if (hit) out.add(file);
  }
  return out;
}
