/**
 * Changed files → affected Ladle stories. Pure (no I/O): the module graph is
 * built by `graph.ts` (esbuild metafile) and story ids come from Ladle's
 * `meta.json`. All paths are repo-relative (`frontend/src/...`, `shared/src/...`).
 *
 * The static graph over-approximates badly for this sandbox: every story
 * mounts `SandboxShell`, which statically reaches `StoryRoutes` → `Layout` and
 * (lazily) every page, so nearly any app module is "imported" by nearly every
 * story. Hence three tiers:
 *   1. global — changes that restyle everything (theme, Ladle config, the
 *      harness every story shares and what it imports directly, deps): all
 *      stories, then a representative sample (`capStories`);
 *   2. direct — changed story files: always captured;
 *   3. graph — everything else: stories that can reach the file, narrowed by
 *      the runtime probe (`planProbe`/`applyProbe`, see `probe.ts`) to the ones
 *      that actually execute it when they render.
 */

export interface ModuleNode {
  /** Static imports (incl. CSS `@import`), repo-relative. */
  imports: string[];
  /** `import()` targets (React.lazy routes etc.), repo-relative. */
  dynamicImports: string[];
}
export type ModuleGraph = Record<string, ModuleNode>;

export interface StoryRef {
  id: string;
  /** Repo-relative story file. */
  file: string;
}

export interface ChangedFile {
  path: string;
  /** git name-status letter (A/M/D/R/C/T...). */
  status: string;
}

export interface AffectedStory extends StoryRef {
  /** The story file itself changed. */
  direct: boolean;
  /** Changed files that led here (for the report). */
  reasons: string[];
  /** Viewports on which the probe saw a changed module execute (after `applyProbe`). */
  exercisedOn?: string[];
}

export interface AffectedResult {
  /** Non-null when the change is global; lists the files that made it so. */
  global: { files: string[] } | null;
  /** Head stories to consider, sorted by id. */
  stories: AffectedStory[];
  /** Base-only stories of changed/deleted story files. */
  removed: StoryRef[];
  /** Changed app files no story can reach — a hint to write stories. */
  uncovered: string[];
  /** Changed files that don't affect Ladle rendering. */
  ignored: string[];
  /** JS/TS modules the render probe should look for. */
  probeTargets: string[];
}

export interface AffectedInput {
  changed: ChangedFile[];
  graph: ModuleGraph;
  headStories: StoryRef[];
  baseStories: StoryRef[];
  globalPatterns?: string[];
  /** Ladle global provider(s): everything they import renders in every story. */
  providerEntries?: string[];
  harnessPrefix?: string;
  /** A harness module reached by at least this share of story files is global. */
  harnessShare?: number;
}

export const DEFAULT_GLOBAL_PATTERNS = [
  'frontend/.ladle/**',
  'frontend/src/theme/**',
  'frontend/src/index.css',
  'frontend/index.html',
  'frontend/vite.config.ts',
  'frontend/package.json',
  'frontend/tsconfig*.json',
  'shared/package.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  'patches/**',
  'frontend/Dockerfile',
];

export const DEFAULT_PROVIDER_ENTRIES = ['frontend/.ladle/components.tsx'];
export const DEFAULT_HARNESS_PREFIX = 'frontend/src/stories/fixtures/';
const STORY_FILE = /^frontend\/src\/stories\/.+\.stories\.[jt]sx?$/;
const JS_MODULE = /\.(m?[jt]sx?)$/;
/** Changed files under these are never "uncovered UI": tests, generated code. */
const NOT_UI = [/^frontend\/src\/__tests__\//, /^frontend\/src\/api-client\//, /\.d\.ts$/, /\.(test|spec)\.[jt]sx?$/];

/** Minimal glob: `**` spans directories, `*` stays inside one segment. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function closure(graph: ModuleGraph, starts: string[], { dynamic = true } = {}): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const mod = graph[file];
    if (!mod) continue;
    stack.push(...mod.imports);
    if (dynamic) stack.push(...mod.dynamicImports);
  }
  return seen;
}

function reverseGraph(graph: ModuleGraph): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();
  for (const [from, mod] of Object.entries(graph)) {
    for (const to of [...mod.imports, ...mod.dynamicImports]) {
      if (!reverse.has(to)) reverse.set(to, new Set());
      reverse.get(to)!.add(from);
    }
  }
  return reverse;
}

/** Every module that (transitively) imports `file`, incl. itself. */
function importersOf(reverse: Map<string, Set<string>>, file: string): Set<string> {
  const seen = new Set<string>();
  const stack = [file];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const importer of reverse.get(f) ?? []) stack.push(importer);
  }
  return seen;
}

/** Nearest JS modules importing a non-JS file (CSS etc.). */
function jsImporters(reverse: Map<string, Set<string>>, file: string): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [...(reverse.get(file) ?? [])];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (JS_MODULE.test(f)) out.add(f);
    else stack.push(...(reverse.get(f) ?? []));
  }
  return [...out].sort();
}

/**
 * Files that behave as global for this graph: the Ladle provider's closure,
 * harness modules nearly every story shares, and the app modules those shared
 * harness modules import directly (Layout, context providers). Lazy (dynamic)
 * imports are excluded from the latter — a route page is not global.
 */
function derivedGlobals(
  graph: ModuleGraph,
  storyFiles: string[],
  reverse: Map<string, Set<string>>,
  providerEntries: string[],
  harnessPrefix: string,
  harnessShare: number,
): Set<string> {
  const globals = closure(graph, providerEntries.filter((e) => graph[e]));
  if (storyFiles.length === 0) return globals;
  const storySet = new Set(storyFiles);
  for (const file of Object.keys(graph)) {
    if (!file.startsWith(harnessPrefix)) continue;
    let reached = 0;
    for (const importer of importersOf(reverse, file)) if (storySet.has(importer)) reached++;
    if (reached / storyFiles.length >= harnessShare) {
      globals.add(file);
      for (const dep of graph[file].imports) globals.add(dep);
    }
  }
  return globals;
}

export function computeAffected(input: AffectedInput): AffectedResult {
  const {
    changed,
    graph,
    headStories,
    baseStories,
    globalPatterns = DEFAULT_GLOBAL_PATTERNS,
    providerEntries = DEFAULT_PROVIDER_ENTRIES,
    harnessPrefix = DEFAULT_HARNESS_PREFIX,
    harnessShare = 0.9,
  } = input;

  const patterns = globalPatterns.map(globToRegExp);
  const reverse = reverseGraph(graph);
  const headByFile = groupByFile(headStories);
  const baseByFile = groupByFile(baseStories);
  const storyFiles = [...headByFile.keys()].filter((f) => graph[f]);
  const derived = derivedGlobals(graph, storyFiles, reverse, providerEntries, harnessPrefix, harnessShare);

  const globalFiles: string[] = [];
  const direct = new Set<string>();
  const reasons = new Map<string, Set<string>>();
  const removed: StoryRef[] = [];
  const uncovered: string[] = [];
  const ignored: string[] = [];
  const probeTargets = new Set<string>();

  const addReason = (storyFile: string, reason: string) => {
    if (!reasons.has(storyFile)) reasons.set(storyFile, new Set());
    reasons.get(storyFile)!.add(reason);
  };

  for (const { path, status } of changed) {
    const deleted = status.startsWith('D');

    if (STORY_FILE.test(path)) {
      const headIds = new Set((headByFile.get(path) ?? []).map((s) => s.id));
      for (const story of baseByFile.get(path) ?? []) if (!headIds.has(story.id)) removed.push(story);
      if (!deleted && headByFile.has(path)) {
        direct.add(path);
        addReason(path, path);
      }
      continue;
    }

    if (patterns.some((re) => re.test(path)) || derived.has(path)) {
      globalFiles.push(path);
      continue;
    }

    if (deleted) {
      // Its importers changed too (to drop the import) and are handled on their own.
      ignored.push(path);
      continue;
    }

    const storiesReached = graph[path]
      ? [...importersOf(reverse, path)].filter((f) => headByFile.has(f))
      : [];
    if (storiesReached.length > 0) {
      for (const storyFile of storiesReached) addReason(storyFile, path);
      if (JS_MODULE.test(path)) probeTargets.add(path);
      else for (const importer of jsImporters(reverse, path)) probeTargets.add(importer);
      continue;
    }

    if (path.startsWith('frontend/src/') && !NOT_UI.some((re) => re.test(path))) uncovered.push(path);
    else ignored.push(path);
  }

  let stories: AffectedStory[];
  if (globalFiles.length > 0) {
    stories = headStories.map((s) => ({
      ...s,
      direct: direct.has(s.file),
      reasons: direct.has(s.file) ? [s.file] : globalFiles,
    }));
  } else {
    stories = [];
    for (const [file, why] of reasons) {
      for (const story of headByFile.get(file) ?? []) {
        stories.push({ ...story, direct: direct.has(file), reasons: [...why].sort() });
      }
    }
  }

  return {
    global: globalFiles.length > 0 ? { files: [...globalFiles].sort() } : null,
    stories: sortById(stories),
    removed: sortById(removed),
    uncovered: [...uncovered].sort(),
    ignored: [...ignored].sort(),
    probeTargets: [...probeTargets].sort(),
  };
}

export interface ProbePlan {
  probe: boolean;
  /** Story ids to probe (non-direct candidates). */
  stories: string[];
}

/** Probe only when the non-direct candidate set is too big to just capture. */
export function planProbe(affected: AffectedResult, { threshold }: { threshold: number }): ProbePlan {
  if (affected.global) return { probe: false, stories: [] };
  const candidates = affected.stories.filter((s) => !s.direct).map((s) => s.id);
  if (candidates.length <= threshold || affected.probeTargets.length === 0) return { probe: false, stories: [] };
  return { probe: true, stories: candidates };
}

/** Probe output: story id → viewport → targets that executed. */
export type ProbeHits = Record<string, Record<string, string[]>>;

/** Keep direct stories, plus probed ones that executed a target on some viewport. */
export function applyProbe(stories: AffectedStory[], hits: ProbeHits): AffectedStory[] {
  const out: AffectedStory[] = [];
  for (const story of stories) {
    if (story.direct) {
      out.push(story);
      continue;
    }
    const byViewport = hits[story.id] ?? {};
    const exercisedOn = Object.keys(byViewport).filter((vp) => byViewport[vp].length > 0).sort();
    if (exercisedOn.length === 0) continue;
    const exercised = [...new Set(Object.values(byViewport).flat())].sort();
    out.push({ ...story, reasons: exercised, exercisedOn });
  }
  return sortById(out);
}

export interface CapResult {
  selected: AffectedStory[];
  dropped: AffectedStory[];
  capped: boolean;
}

const DIR_PRIORITY = ['screens', 'components'];

/**
 * Deterministic representative cap: direct stories first, then the first
 * story of each file, interleaving directories (screens, components, then the
 * rest alphabetically) so no area is starved, then second stories, etc.
 */
export function capStories(stories: AffectedStory[], { max, all = false }: { max: number; all?: boolean }): CapResult {
  const sorted = sortById(stories);
  if (all || sorted.length <= max) return { selected: sorted, dropped: [], capped: false };

  const directStories = sorted.filter((s) => s.direct);
  const rest = sorted.filter((s) => !s.direct);

  // dir → file → stories
  const dirs = new Map<string, Map<string, AffectedStory[]>>();
  for (const story of rest) {
    const dir = storyDir(story.file);
    if (!dirs.has(dir)) dirs.set(dir, new Map());
    const files = dirs.get(dir)!;
    if (!files.has(story.file)) files.set(story.file, []);
    files.get(story.file)!.push(story);
  }
  const dirOrder = [...dirs.keys()].sort((a, b) => dirRank(a) - dirRank(b) || a.localeCompare(b));
  const filesPerDir = dirOrder.map((dir) => [...dirs.get(dir)!.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => s));

  const ordered: AffectedStory[] = [];
  const maxStoriesPerFile = Math.max(0, ...filesPerDir.flat().map((s) => s.length));
  const maxFilesPerDir = Math.max(0, ...filesPerDir.map((f) => f.length));
  for (let storyIndex = 0; storyIndex < maxStoriesPerFile; storyIndex++) {
    for (let fileIndex = 0; fileIndex < maxFilesPerDir; fileIndex++) {
      for (const files of filesPerDir) {
        const story = files[fileIndex]?.[storyIndex];
        if (story) ordered.push(story);
      }
    }
  }

  const prioritized = [...directStories, ...ordered];
  return { selected: prioritized.slice(0, max), dropped: sortById(prioritized.slice(max)), capped: true };
}

function storyDir(file: string): string {
  const rel = file.replace(/^frontend\/src\/stories\//, '');
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
}

function dirRank(dir: string): number {
  const top = dir.split('/')[0];
  const index = DIR_PRIORITY.indexOf(top);
  return index === -1 ? DIR_PRIORITY.length : index;
}

function groupByFile(stories: StoryRef[]): Map<string, StoryRef[]> {
  const map = new Map<string, StoryRef[]>();
  for (const story of stories) {
    if (!map.has(story.file)) map.set(story.file, []);
    map.get(story.file)!.push(story);
  }
  return map;
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
