/**
 * Module graph of everything Ladle can render, from an esbuild metafile: one
 * build with every story file (+ the Ladle global provider) as entry points.
 * esbuild does the resolving — tsconfig `paths` aliases, index barrels,
 * `import()`/React.lazy, CSS `@import` — and records every edge with its kind.
 * Packages stay external (they're covered by the lockfile being a global
 * change); unresolvable relative imports (e.g. the generated api-client before
 * the first container start) are externalised instead of failing the build.
 */
import { globSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';
import type { ModuleGraph } from './affected.ts';

export interface BuildGraphOptions {
  /** Absolute path of the frontend package (the Ladle project root). */
  frontendDir: string;
  /** Repo-relative prefix of `frontendDir` (default `frontend/`). */
  repoPrefix?: string;
}

const ASSET_LOADERS = Object.fromEntries(
  ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.woff', '.woff2', '.ttf'].map(
    (ext) => [ext, 'empty' as const],
  ),
);

const PROJECT_ALIASES = ['@semaphore-chat/shared'];

function isProjectSpecifier(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/') || PROJECT_ALIASES.some((a) => spec === a || spec.startsWith(`${a}/`));
}

const externalizePackages: Plugin = {
  name: 'ui-review-externals',
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData?.uiReviewResolving) return undefined;
      if (args.kind === 'entry-point') return undefined;
      if (!isProjectSpecifier(args.path)) return { path: args.path, external: true };
      // Vite-style suffixes (`?url`, `?raw`, `?worker`) still point at a file.
      const spec = args.path.replace(/\?.*$/, '');
      const resolved = await build.resolve(spec, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: { uiReviewResolving: true },
      });
      if (resolved.errors.length > 0 || resolved.external) return { path: args.path, external: true };
      return { path: resolved.path };
    });
  },
};

async function storyGlobs(frontendDir: string): Promise<string[]> {
  try {
    const config = await import(pathToFileURL(path.join(frontendDir, '.ladle/config.mjs')).href);
    const stories = config.default?.stories;
    if (typeof stories === 'string') return [stories];
    if (Array.isArray(stories)) return stories;
  } catch {
    // fall through to Ladle's default
  }
  return ['src/**/*.stories.{js,jsx,ts,tsx,mdx}'];
}

export async function buildGraph({ frontendDir, repoPrefix = 'frontend/' }: BuildGraphOptions): Promise<ModuleGraph> {
  const esbuild = await import('esbuild');
  const globs = await storyGlobs(frontendDir);
  const entries = [...new Set(globs.flatMap((g) => globSync(g, { cwd: frontendDir })))].filter((f) => !f.endsWith('.mdx'));
  const provider = ['.ladle/components.tsx', '.ladle/components.jsx', '.ladle/components.ts'].find(
    (f) => globSync(f, { cwd: frontendDir }).length > 0,
  );
  if (provider) entries.push(provider);

  const result = await esbuild.build({
    absWorkingDir: frontendDir,
    entryPoints: entries.sort(),
    bundle: true,
    write: false,
    metafile: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    outdir: path.join(frontendDir, '.ui-review-graph-out'),
    tsconfig: path.join(frontendDir, 'tsconfig.app.json'),
    jsx: 'automatic',
    loader: ASSET_LOADERS,
    logLevel: 'silent',
    plugins: [externalizePackages],
  });

  const toRepo = (p: string): string => {
    const abs = path.resolve(frontendDir, p);
    const repoRoot = path.resolve(frontendDir, path.relative(repoPrefix, '.'));
    return path.relative(repoRoot, abs).split(path.sep).join('/');
  };

  const graph: ModuleGraph = {};
  for (const [input, info] of Object.entries(result.metafile.inputs)) {
    const node = { imports: [] as string[], dynamicImports: [] as string[] };
    for (const imp of info.imports) {
      if (imp.external) continue;
      (imp.kind === 'dynamic-import' ? node.dynamicImports : node.imports).push(toRepo(imp.path));
    }
    node.imports = [...new Set(node.imports)].sort();
    node.dynamicImports = [...new Set(node.dynamicImports)].sort();
    graph[toRepo(input)] = node;
  }
  return graph;
}
