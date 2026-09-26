#!/usr/bin/env node
/**
 * Merge per-shard Vitest v8 coverage into the report a single, unsharded
 * `vitest run --coverage` produces. CI (frontend-tests.yml) runs the unit
 * tests as `vitest run --shard=k/N --coverage --coverage.reporter=json`, then
 * runs this script on the N `coverage-final.json` files.
 *
 * Usage (from frontend/):
 *   node scripts/merge-coverage-shards.mjs <coverage-final.json>...
 *
 * Output: the reporters from vitest.config.ts (`test.coverage.reporter`, i.e.
 * the `text` table + `coverage-summary.json` the badge step reads), written to
 * `test.coverage.reportsDirectory`, the same as an unsharded run.
 *
 * Why not `vitest --merge-reports --coverage`: that unions the shards'
 * coverage maps, which inflates the totals. Each shard adds a zero-hit
 * placeholder for every `coverage.include` file that shard did not load. In an
 * unsharded run a file that some test loads only as a `vi.mock()` factory stub
 * shows up with no statements (0/0) and gets no placeholder. After a union,
 * the shards that did not load it bring its placeholder back, so its lines
 * count as uncovered. On 2026-09-23 that gave 50.44% lines where the unsharded
 * run gave 60.23% (72 files affected).
 *
 * Merge rule: a file's entries from the shards that actually loaded it win.
 * Placeholders (statements/functions/branches present, zero hits everywhere)
 * are used only when no shard loaded the file, which is exactly when the
 * unsharded run adds one. Checked against an unsharded run: identical
 * covered/total for every file and metric (525 files).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { coverageConfigDefaults } from 'vitest/config';

const require = createRequire(import.meta.url);
// Use the same istanbul packages @vitest/coverage-v8 builds its reports with:
// since Vitest 5 these are Vitest's ESM-only forks (@vitest/istanbul-lib-*,
// with the reporters that istanbul-reports used to provide built into
// istanbul-lib-report), resolved from coverage-v8's own location.
const coverageV8Require = createRequire(require.resolve('@vitest/coverage-v8'));
const importFromCoverageV8 = (name) => import(pathToFileURL(coverageV8Require.resolve(name)).href);
const libCoverage = await importFromCoverageV8('@vitest/istanbul-lib-coverage');
const libReport = await importFromCoverageV8('@vitest/istanbul-lib-report');

const frontendRoot = path.resolve(import.meta.dirname, '..');

async function loadCoverageOptions() {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'test' },
    path.join(frontendRoot, 'vitest.config.ts'),
    frontendRoot,
    'silent',
  );
  const options = { ...coverageConfigDefaults, ...(loaded?.config.test?.coverage ?? {}) };
  if (options.thresholds) {
    // An unsharded run enforces these; this script does not yet. Fail loudly
    // rather than silently dropping the gate.
    throw new Error('coverage.thresholds is set in vitest.config.ts; teach merge-coverage-shards.mjs to enforce it');
  }
  const reporters = [options.reporter].flat().map((r) => (Array.isArray(r) ? r : [r, {}]));
  return {
    reporters,
    reportsDirectory: path.resolve(frontendRoot, options.reportsDirectory),
    watermarks: options.watermarks,
    skipFull: options.skipFull,
  };
}

const hasCounters = (fc) =>
  Object.keys(fc.statementMap).length + Object.keys(fc.fnMap).length + Object.keys(fc.branchMap).length > 0;
const hasHits = (fc) =>
  Object.values(fc.s).some((n) => n > 0) ||
  Object.values(fc.f).some((n) => n > 0) ||
  Object.values(fc.b).some((counts) => counts.some((n) => n > 0));
const isUntestedPlaceholder = (fc) => hasCounters(fc) && !hasHits(fc);

function mergeShards(shardMaps) {
  const byFile = new Map();
  for (const shard of shardMaps) {
    for (const [file, fc] of Object.entries(shard)) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(fc);
    }
  }
  const merged = libCoverage.createCoverageMap({});
  for (const [file, entries] of byFile) {
    const loaded = entries.filter((fc) => !isUntestedPlaceholder(fc));
    for (const fc of loaded.length > 0 ? loaded : entries) merged.merge({ [file]: fc });
  }
  return merged;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  throw new Error('usage: node scripts/merge-coverage-shards.mjs <coverage-final.json>...');
}
const options = await loadCoverageOptions();
const coverageMap = mergeShards(files.map((f) => JSON.parse(readFileSync(f, 'utf8'))));

console.log(`Merged coverage from ${files.length} shard(s): ${files.join(', ')}`);
const context = libReport.createContext({
  dir: options.reportsDirectory,
  coverageMap,
  watermarks: options.watermarks,
});
for (const [name, reporterOptions] of options.reporters) {
  // createAsync, as coverage-v8 does: it also loads custom reporters.
  const report = await libReport.createAsync(name, {
    skipFull: options.skipFull,
    projectRoot: frontendRoot,
    ...reporterOptions,
  });
  report.execute(context);
}
