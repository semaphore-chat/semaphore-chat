/**
 * Node side of the UI review tool — run by ui-review.sh inside the `tool`
 * container (frontend image: esbuild, sharp, pixelmatch). Every step reads and
 * writes files under the work dir (`/ui-review`, i.e. `<repo>/.ui-review`):
 *
 *   affected  changed files → candidate stories (+ probe plan)     work/affected.json, work/probe-plan.json
 *   select    apply probe hits, cap                                 work/selection.json, work/{head,base}-ids.txt
 *   diff      pixel-diff head vs base shots, plan composites        work/diff-report.json, work/composite-jobs.json,
 *             (run again after each re-capture of work/recheck-     work/recheck-tasks.txt
 *             tasks.txt into shots/{head,base}-recheck-<n>)
 *   finalize  composite PNGs → WebP, final report                   out/composites/*.webp, out/report.json
 *   block     PR-description section (local paths or published URLs);
 *             with --body-json also the whole new PR body, kept under GitHub's size limit
 *   splice    put the section into a PR body (gh pr view --json body)
 *   folder    publish folder name for a PR (pr-<n>/<stamp>-<sha7>)
 *
 * Usage: node scripts/ui-review/cli.ts <step> [--flag value ...]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildGraph } from './lib/graph.ts';
import {
  computeAffected,
  planProbe,
  applyProbe,
  capStories,
  probeImporters,
  type AffectedResult,
  type AffectedStory,
  type ProbeHits,
  type StoryRef,
} from './lib/affected.ts';
import { parseChangedLines, parseNameStatusZ } from './lib/gitdiff.ts';
import { IMPORTER_DEPTH, type TargetLines } from './lib/coverage.ts';
import {
  classifyShot,
  confirmChange,
  diffBoxes,
  growBoxes,
  pixelsInBoxes,
  summarizeStory,
  DEFAULT_PIXEL_THRESHOLD,
  DEFAULT_THRESHOLDS,
  type Box,
  type ShotStatus,
} from './lib/classify.ts';
import { compositeHtml, type CompositeInput } from './lib/layout.ts';
import {
  renderBlock,
  rawGithubUrl,
  publishFolder,
  treeUrl,
  summarizeFiles,
  GITHUB_BODY_LIMIT,
  type ReviewReport,
  type ShotIssue,
  type StoryResult,
} from './lib/block.ts';
import { spliceBlock, START_MARKER, END_MARKER } from './lib/body.ts';
import { REVIEW_VIEWPORTS, viewportsForStory } from './lib/viewports.ts';

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

const str = (flags: Flags, key: string, fallback?: string): string => {
  const v = flags[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`--${key} is required`);
};
const num = (flags: Flags, key: string, fallback: number): number => {
  const v = flags[key];
  return typeof v === 'string' ? Number(v) : fallback;
};

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const writeJson = (file: string, data: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

interface LadleMeta {
  stories: Record<string, { filePath: string }>;
}

function storiesFromMeta(file: string): StoryRef[] | null {
  if (!existsSync(file)) return null;
  const meta = readJson<LadleMeta>(file);
  return Object.entries(meta.stories)
    .map(([id, s]) => ({ id, file: `frontend/${s.filePath.replace(/^\.\//, '')}` }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- affected

interface AffectedFile extends AffectedResult {
  headStoryCount: number;
  baseAvailable: boolean;
  changedCount: number;
}

async function stepAffected(flags: Flags) {
  const work = str(flags, 'work');
  const threshold = num(flags, 'probe-threshold', 12);
  const headStories = storiesFromMeta(path.join(work, 'head-meta.json'));
  if (!headStories) throw new Error('head-meta.json missing (is the head Ladle up?)');
  const baseStories = storiesFromMeta(path.join(work, 'base-meta.json'));

  const changed = parseNameStatusZ(readFileSync(path.join(work, 'changed.z'), 'utf8'));
  const untracked = readFileSync(path.join(work, 'untracked.z'), 'utf8').split('\0').filter(Boolean);
  const known = new Set(changed.map((c) => c.path));
  for (const file of untracked) if (!known.has(file)) changed.push({ path: file, status: 'A' });

  const lines = parseChangedLines(readFileSync(path.join(work, 'changes.diff'), 'utf8'));
  for (const file of untracked) lines.set(file, 'all');

  const started = Date.now();
  const graph = await buildGraph({ frontendDir: '/app/frontend' });
  console.log(`[ui-review] module graph: ${Object.keys(graph).length} modules (${Date.now() - started} ms)`);

  const affected = computeAffected({ changed, graph, headStories, baseStories: baseStories ?? [] });
  const out: AffectedFile = {
    ...affected,
    headStoryCount: headStories.length,
    baseAvailable: baseStories !== null,
    changedCount: changed.length,
  };
  writeJson(path.join(work, 'affected.json'), out);

  const plan = planProbe(affected, { threshold });
  const planFile = path.join(work, 'probe-plan.json');
  rmSync(planFile, { force: true });
  rmSync(path.join(work, 'probe-out.json'), { force: true });
  if (plan.probe) {
    const targets: Record<string, TargetLines> = {};
    for (const file of affected.probeTargets) targets[file] = lines.get(file) ?? 'all';
    writeJson(planFile, {
      baseUrl: 'http://localhost:61000',
      stories: plan.stories,
      targets,
      importers: probeImporters(graph, affected.probeTargets, IMPORTER_DEPTH),
      ...(typeof flags.concurrency === 'string' ? { concurrency: Number(flags.concurrency) } : {}),
      freezeTime: str(flags, 'freeze-time', ''),
    });
  }

  const direct = affected.stories.filter((s) => s.direct).length;
  const targeted = affected.stories.filter((s) => !s.direct && s.targeted).length;
  console.log(
    `[ui-review] ${changed.length} changed file(s): ` +
      (affected.global
        ? `GLOBAL (${affected.global.files.join(', ')}) → all ${affected.stories.length} stories` +
          (targeted ? `, ${targeted} reached by the other changed files` : '')
        : `${affected.stories.length} candidate stor${affected.stories.length === 1 ? 'y' : 'ies'} (${direct} direct)`) +
      `, ${affected.removed.length} removed, ${affected.uncovered.length} uncovered file(s)` +
      (affected.appOnly.length ? `, ${affected.appOnly.length} app-only file(s) Ladle never loads` : '') +
      (plan.probe ? ` → probing ${plan.stories.length} stories` : ''),
  );
}

// ---------------------------------------------------------------- select

interface Selection {
  global: AffectedResult['global'];
  candidates: number;
  probed: ReviewReport['selection']['probed'];
  capped: boolean;
  maxStories: number;
  selected: AffectedStory[];
  dropped: string[];
  droppedStories: AffectedStory[];
  targeted?: { total: number; captured: number };
  storyFiles: { total: number; sampled: number };
  removed: StoryRef[];
  uncovered: string[];
  appOnly: string[];
  leafTargets: Record<string, string[]>;
}

function stepSelect(flags: Flags) {
  const work = str(flags, 'work');
  const max = num(flags, 'max', 40);
  const all = flags.all === true;
  const affected = readJson<AffectedFile>(path.join(work, 'affected.json'));
  const globalFiles = affected.global?.files ?? [];

  let stories = affected.stories;
  let probed: Selection['probed'] = null;
  const probeOut = path.join(work, 'probe-out.json');
  const explicit = typeof flags.ids === 'string';
  if (typeof flags.ids === 'string') {
    // --stories override: exactly these (head) stories, no probe, no cap.
    const wanted = new Set(flags.ids.split(/[\s,]+/).filter(Boolean));
    const head = storiesFromMeta(path.join(work, 'head-meta.json')) ?? [];
    const unknown = [...wanted].filter((id) => !head.some((s) => s.id === id));
    if (unknown.length) throw new Error(`unknown story id(s): ${unknown.join(', ')}`);
    stories = head.filter((s) => wanted.has(s.id)).map((s) => ({ ...s, direct: true, targeted: true, reasons: ['--stories'] }));
  } else if (existsSync(probeOut)) {
    const { hits, durationMs } = readJson<{ hits: ProbeHits; durationMs: number }>(probeOut);
    const isCandidate = (s: AffectedStory) => !s.direct && s.targeted !== false;
    const before = stories.filter(isCandidate).length;
    stories = applyProbe(stories, hits, { globalFiles });
    probed = { stories: before, kept: stories.filter(isCandidate).length, durationMs, ...(flags['probe-cached'] === true ? { cached: true } : {}) };
  }
  const { selected, dropped, capped } = capStories(stories, { max, all: all || explicit });

  const targetedOf = (list: AffectedStory[]) => list.filter((s) => !s.direct && s.targeted !== false).length;
  const selection: Selection = {
    global: affected.global,
    candidates: explicit ? stories.length : affected.stories.length,
    probed,
    capped,
    maxStories: max,
    selected,
    dropped: dropped.map((s) => s.id),
    droppedStories: dropped,
    ...(affected.global && !explicit ? { targeted: { total: targetedOf(stories), captured: targetedOf(selected) } } : {}),
    storyFiles: { total: new Set(stories.map((s) => s.file)).size, sampled: new Set(selected.map((s) => s.file)).size },
    removed: explicit ? [] : affected.removed,
    uncovered: affected.uncovered,
    appOnly: affected.appOnly ?? [],
    leafTargets: explicit ? {} : (affected.leafTargets ?? {}),
  };
  writeJson(path.join(work, 'selection.json'), selection);

  const baseStories = storiesFromMeta(path.join(work, 'base-meta.json')) ?? [];
  const baseIds = new Set(baseStories.map((s) => s.id));
  const selectedIds = new Set(selected.map((s) => s.id));
  writeFileSync(path.join(work, 'head-ids.txt'), `${[...selectedIds].join('\n')}\n`);
  const baseWanted = [...new Set([...[...selectedIds].filter((id) => baseIds.has(id)), ...selection.removed.map((s) => s.id)])];
  writeFileSync(path.join(work, 'base-ids.txt'), `${baseWanted.join('\n')}\n`);
  console.log(
    `[ui-review] selected ${selected.length} stor${selected.length === 1 ? 'y' : 'ies'}` +
      (capped ? ` (capped at ${max}; ${dropped.length} not captured)` : '') +
      (selection.targeted ? `, ${selection.targeted.captured}/${selection.targeted.total} of them render the non-global changes` : '') +
      `; head shots: ${selected.length}, base shots: ${baseWanted.length}`,
  );
}

// ---------------------------------------------------------------- diff

interface ShotsReport {
  results: { storyId: string; viewport: string; ok: boolean; errorMessage: string | null; pageErrors: string[]; renderErrors: string[]; unhandledRequests: string[] }[];
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function loadRaw(file: string): Promise<Raw> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function pad(img: Raw, width: number, height: number): Buffer {
  if (img.width === width && img.height === height) return img.data;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255;
    out[i + 1] = 0;
    out[i + 2] = 255;
    out[i + 3] = 255;
  }
  for (let y = 0; y < img.height; y++) img.data.copy(out, y * width * 4, y * img.width * 4, (y + 1) * img.width * 4);
  return out;
}

const DIFF_COLOR: [number, number, number] = [255, 0, 60];
/** Slack around the first diff's boxes when checking that a re-capture reproduces it. */
const RECHECK_MARGIN = 16;

async function stepDiff(flags: Flags) {
  const work = str(flags, 'work');
  const root = path.dirname(work); // /ui-review
  const minPixels = num(flags, 'min-pixels', DEFAULT_THRESHOLDS.minPixels);
  const threshold = num(flags, 'pixel-threshold', DEFAULT_PIXEL_THRESHOLD);
  const rechecks = num(flags, 'rechecks', 0);
  const baseRef = str(flags, 'base-ref');
  const baseSha = str(flags, 'base-sha');
  const headRef = str(flags, 'head-ref');
  const headSha = str(flags, 'head-sha');
  const dirty = str(flags, 'dirty', '0') === '1';

  const sharp = (await import('sharp')).default;
  const pixelmatch = (await import('pixelmatch')).default;
  const selection = readJson<Selection>(path.join(work, 'selection.json'));
  const headIds = new Set((storiesFromMeta(path.join(work, 'head-meta.json')) ?? []).map((s) => s.id));
  const baseIds = new Set((storiesFromMeta(path.join(work, 'base-meta.json')) ?? []).map((s) => s.id));

  for (const dir of ['diff', 'html', 'png']) rmSync(path.join(work, dir), { recursive: true, force: true });

  const shotPath = (side: string, viewport: string, id: string) => path.join(root, 'shots', side, viewport, `${id}.png`);
  const shotDirs = existsSync(path.join(root, 'shots')) ? readdirSync(path.join(root, 'shots')) : [];
  const passes = shotDirs
    .map((d) => /^head-recheck-(\d+)$/.exec(d)?.[1])
    .filter((n): n is string => n !== undefined && shotDirs.includes(`base-recheck-${n}`))
    .map(Number)
    .sort((a, b) => a - b);

  /** Diff two captures; returns the mask of differing pixels (and the pixelmatch output image). */
  const compare = (base: Raw, head: Raw) => {
    const width = Math.max(head.width, base.width);
    const height = Math.max(head.height, base.height);
    const output = Buffer.alloc(width * height * 4);
    const pixels = pixelmatch(pad(base, width, height), pad(head, width, height), output, width, height, {
      threshold,
      includeAA: false,
      alpha: 0.15,
      diffColor: DIFF_COLOR,
      aaColor: [190, 190, 190],
    });
    const mask = new Uint8Array(width * height);
    for (let p = 0; p < mask.length; p++) {
      const o = p * 4;
      if (output[o] === DIFF_COLOR[0] && output[o + 1] === DIFF_COLOR[1] && output[o + 2] === DIFF_COLOR[2]) mask[p] = 1;
    }
    return { pixels, width, height, output, mask };
  };

  /** Base-vs-head differing pixels inside `region`, for every re-capture pass of this shot. */
  const recheckPixels = async (viewport: string, id: string, region: Box[]): Promise<number[]> => {
    const out: number[] = [];
    for (const n of passes) {
      const headFile = shotPath(`head-recheck-${n}`, viewport, id);
      const baseFile = shotPath(`base-recheck-${n}`, viewport, id);
      if (!existsSync(headFile) || !existsSync(baseFile)) continue; // not re-captured in this pass
      const again = compare(await loadRaw(baseFile), await loadRaw(headFile));
      out.push(pixelsInBoxes(again.mask, again.width, again.height, region));
    }
    return out;
  };

  const jobs: { html: string; out: string }[] = [];
  const stories: StoryResult[] = [];
  const recheckTasks: string[] = [];
  const all: (AffectedStory | (StoryRef & { direct: boolean; reasons: string[] }))[] = [
    ...selection.selected,
    ...selection.removed.map((s) => ({ ...s, direct: true, reasons: [] as string[] })),
  ];

  for (const story of all) {
    const shots: StoryResult['shots'] = [];
    for (const viewport of viewportsForStory(story.id, REVIEW_VIEWPORTS)) {
      const headFile = shotPath('head', viewport, story.id);
      const baseFile = shotPath('base', viewport, story.id);
      const inHead = headIds.has(story.id);
      const inBase = baseIds.has(story.id);
      const hasHead = existsSync(headFile);
      const hasBase = existsSync(baseFile);
      if ((inHead && !hasHead) || (inBase && !hasBase)) {
        shots.push({ viewport, status: 'missing' });
        continue;
      }

      let status: ShotStatus;
      let diffPixels = 0;
      let boxes: Box[] = [];
      let diffFile: string | undefined;
      let size: { width: number; height: number } | undefined;
      let recheckCounts: number[] | undefined;
      const head = hasHead ? await loadRaw(headFile) : null;
      const base = hasBase ? await loadRaw(baseFile) : null;
      if (head && base) {
        const first = compare(base, head);
        const { width, height } = first;
        diffPixels = first.pixels;
        const sameSize = head.width === base.width && head.height === base.height;
        status = classifyShot({ hasBase: true, hasHead: true, sameSize, diffPixels, totalPixels: width * height }, { minPixels });
        size = { width, height };
        if (status === 'changed') {
          boxes = diffBoxes(first.mask, width, height);
          recheckCounts = await recheckPixels(viewport, story.id, growBoxes(boxes, RECHECK_MARGIN, width, height));
          status = confirmChange(status, recheckCounts, { minPixels });
          if (status === 'changed' && recheckCounts.length < rechecks) recheckTasks.push(`${story.id} ${viewport}`);
          diffFile = path.join(work, 'diff', viewport, `${story.id}.png`);
          mkdirSync(path.dirname(diffFile), { recursive: true });
          await sharp(first.output, { raw: { width, height, channels: 4 } }).png().toFile(diffFile);
        }
      } else {
        status = classifyShot({ hasBase: !!base, hasHead: !!head, sameSize: false, diffPixels: 0, totalPixels: 0 });
        size = head ? { width: head.width, height: head.height } : base ? { width: base.width, height: base.height } : undefined;
      }

      const shot: StoryResult['shots'][number] = { viewport, status };
      if (head && base) {
        shot.diffPixels = diffPixels;
        shot.diffPercent = size ? (100 * diffPixels) / (size.width * size.height) : 0;
      }
      if (recheckCounts?.length) shot.rechecks = recheckCounts;
      if (status === 'changed' || status === 'unstable' || status === 'new' || status === 'removed') {
        const name = `${story.id}--${viewport}`;
        const htmlFile = path.join(work, 'html', `${name}.html`);
        const rel = (f: string) => path.relative(path.dirname(htmlFile), f).split(path.sep).join('/');
        const input: CompositeInput = {
          storyId: story.id,
          viewport,
          status,
          before: base ? { src: rel(baseFile), width: base.width, height: base.height } : undefined,
          after: head ? { src: rel(headFile), width: head.width, height: head.height } : undefined,
          diff: diffFile && size ? { src: rel(diffFile), width: size.width, height: size.height } : undefined,
          boxes,
          labels: { before: `before · base ${baseSha.slice(0, 7)}`, after: `after · head ${headSha.slice(0, 7)}${dirty ? '+' : ''}` },
          diffPercent: shot.diffPercent,
        };
        mkdirSync(path.dirname(htmlFile), { recursive: true });
        writeFileSync(htmlFile, compositeHtml(input));
        jobs.push({ html: htmlFile, out: path.join(work, 'png', `${name}.png`) });
        shot.composite = `${name}.webp`;
      }
      shots.push(shot);
    }
    stories.push({
      id: story.id,
      file: story.file,
      direct: story.direct,
      reasons: story.reasons,
      status: summarizeStory(shots.map((s) => s.status)),
      shots,
    });
  }

  const issues: ShotIssue[] = [];
  for (const side of ['head', 'base'] as const) {
    const file = path.join(root, 'shots', side, 'report.json');
    if (!existsSync(file)) continue;
    for (const r of readJson<ShotsReport>(file).results) {
      if (!r.ok || r.pageErrors.length || r.renderErrors.length || r.unhandledRequests.length) {
        issues.push({ side, storyId: r.storyId, viewport: r.viewport, ok: r.ok, errorMessage: r.errorMessage, pageErrors: r.pageErrors, renderErrors: r.renderErrors, unhandledRequests: r.unhandledRequests });
      }
    }
  }

  // Changed shots still to confirm: re-captured (only that viewport) on both sides.
  writeFileSync(path.join(work, 'recheck-tasks.txt'), recheckTasks.length ? `${recheckTasks.join('\n')}\n` : '');

  const order: Record<string, number> = { changed: 0, new: 1, removed: 2, unstable: 3, error: 4, unchanged: 5 };
  stories.sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id));
  const report: ReviewReport = {
    base: { ref: baseRef, sha: baseSha },
    head: { ref: headRef, sha: headSha, dirty },
    viewports: ['phone', 'tablet', 'desktop'],
    selection: {
      global: selection.global,
      candidates: selection.candidates,
      probed: selection.probed,
      capped: selection.capped,
      maxStories: selection.maxStories,
      dropped: selection.dropped,
      ...(selection.targeted ? { targeted: selection.targeted } : {}),
      storyFiles: selection.storyFiles,
    },
    stories,
    uncovered: selection.uncovered,
    appOnly: selection.appOnly ?? [],
    files: summarizeFiles(selection.leafTargets ?? {}, stories, selection.droppedStories ?? []),
    issues,
    thresholds: { minPixels, pixelmatchThreshold: threshold, rechecks },
  };
  writeJson(path.join(work, 'diff-report.json'), report);
  writeJson(path.join(work, 'composite-jobs.json'), jobs);
  const count = (s: string) => stories.filter((x) => x.status === s).length;
  console.log(
    `[ui-review] diff: ${count('changed')} changed, ${count('new')} new, ${count('removed')} removed, ${count('unstable')} unstable, ${count('unchanged')} unchanged, ${count('error')} failed; ${jobs.length} composite(s) to render` +
      (recheckTasks.length ? `; ${recheckTasks.length} changed shot(s) to re-check` : ''),
  );
}

// ---------------------------------------------------------------- finalize

async function stepFinalize(flags: Flags) {
  const work = str(flags, 'work');
  const out = str(flags, 'out');
  const sharp = (await import('sharp')).default;
  const report = readJson<ReviewReport>(path.join(work, 'diff-report.json'));
  const jobs = readJson<{ html: string; out: string }[]>(path.join(work, 'composite-jobs.json'));
  rmSync(path.join(out, 'composites'), { recursive: true, force: true });
  mkdirSync(path.join(out, 'composites'), { recursive: true });
  let bytes = 0;
  for (const job of jobs) {
    if (!existsSync(job.out)) {
      console.warn(`[ui-review] composite missing: ${job.out}`);
      continue;
    }
    const target = path.join(out, 'composites', `${path.basename(job.out, '.png')}.webp`);
    const info = await sharp(job.out).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toFile(target);
    bytes += info.size;
  }
  for (const story of report.stories) {
    for (const shot of story.shots) {
      if (shot.composite && !existsSync(path.join(out, 'composites', shot.composite))) delete shot.composite;
    }
  }
  writeJson(path.join(out, 'report.json'), report);
  console.log(`[ui-review] ${jobs.length} composite(s), ${(bytes / 1024).toFixed(0)} KiB → ${path.join(out, 'composites')}`);
}

// ---------------------------------------------------------------- block / splice / folder

/** Room left at the end of GitHub's limit (their count may differ slightly from JS string length). */
const BODY_SAFETY = 256;

function stepBlock(flags: Flags) {
  const reportFile = str(flags, 'report');
  const target = str(flags, 'out');
  const report = readJson<ReviewReport>(reportFile);
  const repo = typeof flags.repo === 'string' ? flags.repo : null;
  const folder = typeof flags.folder === 'string' ? flags.folder : null;
  const branch = str(flags, 'branch', 'pr-screenshots');
  const imageUrl =
    repo && folder
      ? (file: string) => rawGithubUrl(repo, branch, `${folder}/${file}`)
      : (file: string) => `composites/${file}`;
  const imagesUrl = repo && folder ? treeUrl(repo, branch, folder) : undefined;
  const command = str(flags, 'command');

  if (typeof flags['body-json'] !== 'string') {
    writeFileSync(target, renderBlock(report, { imageUrl, imagesUrl, command }));
    return;
  }
  // The whole new PR body: the section gets whatever room the rest of the body leaves.
  const { body } = readJson<{ body: string | null }>(flags['body-json']);
  const placeholder = `${START_MARKER}\n${END_MARKER}`;
  const rest = spliceBlock(body ?? '', placeholder).length - placeholder.length;
  const maxChars = GITHUB_BODY_LIMIT - BODY_SAFETY - rest;
  if (maxChars < 2000) throw new Error(`the PR description is ${rest} characters without the UI review section — no room for it under GitHub's ${GITHUB_BODY_LIMIT}-character limit`);
  const block = renderBlock(report, { imageUrl, imagesUrl, command, maxChars });
  const newBody = spliceBlock(body ?? '', block);
  if (newBody.length > GITHUB_BODY_LIMIT - BODY_SAFETY) throw new Error(`new PR description would be ${newBody.length} characters (limit ${GITHUB_BODY_LIMIT})`);
  writeFileSync(target, block);
  writeFileSync(str(flags, 'body-out'), newBody);
  console.log(`[ui-review] PR description: ${newBody.length} characters (section ${block.length})`);
}

function stepSplice(flags: Flags) {
  const { body } = readJson<{ body: string | null }>(str(flags, 'body-json'));
  const block = readFileSync(str(flags, 'block'), 'utf8');
  writeFileSync(str(flags, 'out'), spliceBlock(body ?? '', block));
}

function stepFolder(flags: Flags) {
  process.stdout.write(`${publishFolder(Number(str(flags, 'pr')), str(flags, 'sha'), new Date())}\n`);
}

// ----------------------------------------------------------------

const steps: Record<string, (flags: Flags) => unknown> = {
  affected: stepAffected,
  select: stepSelect,
  diff: stepDiff,
  finalize: stepFinalize,
  block: stepBlock,
  splice: stepSplice,
  folder: stepFolder,
};

const [step, ...rest] = process.argv.slice(2);
if (!step || !steps[step]) {
  console.error(`usage: node scripts/ui-review/cli.ts <${Object.keys(steps).join('|')}> [--flags]`);
  process.exit(2);
}
Promise.resolve()
  .then(() => steps[step](parseFlags(rest)))
  .catch((err) => {
    console.error(`[ui-review] ${step} failed:`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
