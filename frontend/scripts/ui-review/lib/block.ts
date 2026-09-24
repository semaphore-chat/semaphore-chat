/**
 * The PR-description section (between the ui-review markers) and the URLs of
 * published images. Pure.
 */
import { START_MARKER, END_MARKER } from './body.ts';
import type { ShotStatus, StoryStatus } from './classify.ts';

/** GitHub rejects PR descriptions longer than this (characters). */
export const GITHUB_BODY_LIMIT = 65_536;

export interface ShotResult {
  viewport: string;
  status: ShotStatus;
  diffPixels?: number;
  diffPercent?: number;
  /** Differing pixels inside the change region on each stability re-check (see `confirmChange`). */
  rechecks?: number[];
  /** Composite image, relative to the image root (published folder / local out dir). */
  composite?: string;
}

export interface StoryResult {
  id: string;
  file: string;
  direct: boolean;
  reasons: string[];
  status: StoryStatus;
  shots: ShotResult[];
}

export interface ShotIssue {
  side: 'base' | 'head';
  storyId: string;
  viewport: string;
  ok: boolean;
  errorMessage?: string | null;
  pageErrors: string[];
  renderErrors: string[];
  unhandledRequests: string[];
}

/** Per changed (non-global) file: what the captured stories that run it showed. */
export interface FileSummary {
  file: string;
  /** Captured stories that run it (by the probe, or statically without one). */
  captured: number;
  changed: number;
  unstable: number;
  /** Stories that run it but were not captured (over the cap). */
  dropped: number;
}

export interface ReviewReport {
  base: { ref: string; sha: string };
  head: { ref: string; sha: string; dirty: boolean };
  viewports: string[];
  selection: {
    global: { files: string[] } | null;
    /** Stories statically reachable from the change (all stories for a global change). */
    candidates: number;
    probed: { stories: number; kept: number; durationMs: number; cached?: boolean } | null;
    capped: boolean;
    maxStories: number;
    /** Selected but not captured because of the cap. */
    dropped: string[];
    /** Global mode: stories that render the diff's non-global files (captured before the sample). */
    targeted?: { total: number; captured: number };
    /** Story files with at least one captured story / all story files among the candidates. */
    storyFiles?: { total: number; sampled: number };
  };
  stories: StoryResult[];
  uncovered: string[];
  /** Changed files only the real app loads (not Ladle). */
  appOnly?: string[];
  files?: FileSummary[];
  issues: ShotIssue[];
  thresholds: { minPixels: number; pixelmatchThreshold: number; rechecks?: number };
}

export interface BlockOptions {
  imageUrl: (composite: string) => string;
  /** Command that regenerates this section. */
  command: string;
  /** Max entries in long lists (unchanged, dropped, issues). */
  maxListed?: number;
  /**
   * Character budget for the whole section (GitHub caps PR descriptions): the
   * section is shortened step by step (shorter lists, images as links, ...)
   * until it fits; throws when even the shortest form doesn't.
   */
  maxChars?: number;
  /** Where every image of the run can be browsed (shown when the section had to be shortened). */
  imagesUrl?: string;
}

/**
 * Per changed non-global file (`leafTargets`, see `computeAffected`): how the
 * captured stories that run it came out, and how many were not captured. A
 * story runs a file when it is its story file, or the file (or a probe target
 * standing for it, e.g. a CSS file's importer) is among its reasons.
 */
export function summarizeFiles(
  leafTargets: Record<string, string[]>,
  captured: { file: string; reasons: string[]; status: string }[],
  dropped: { file: string; reasons: string[] }[],
): FileSummary[] {
  const runs = (file: string, targets: string[]) => (s: { file: string; reasons: string[] }) =>
    s.file === file || s.reasons.includes(file) || targets.some((t) => s.reasons.includes(t));
  return Object.entries(leafTargets)
    .map(([file, targets]) => {
      const mine = captured.filter(runs(file, targets));
      return {
        file,
        captured: mine.length,
        changed: mine.filter((s) => s.status === 'changed' || s.status === 'new' || s.status === 'removed').length,
        unstable: mine.filter((s) => s.status === 'unstable').length,
        dropped: dropped.filter(runs(file, targets)).length,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function rawGithubUrl(repo: string, branch: string, path: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`repo must be "owner/name", got "${repo}"`);
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${encoded}`;
}

/** `https://github.com/<repo>/tree/<branch>/<folder>` — the published images of one run. */
export function treeUrl(repo: string, branch: string, folder: string): string {
  return `https://github.com/${repo}/tree/${encodeURIComponent(branch)}/${folder.split('/').map(encodeURIComponent).join('/')}`;
}

/** `pr-<n>/<UTC yyyymmdd-hhmmss>-<sha7>` — a fresh path per publish sidesteps raw/camo caching. */
export function publishFolder(pr: number, headSha: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `pr-${pr}/${stamp}-${headSha.slice(0, 7)}`;
}

const short = (sha: string) => sha.slice(0, 7);
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;
const html = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rel = (file: string) => file.replace(/^frontend\//, '');

/** How much detail a rendering keeps; `renderBlock` steps down until the section fits its budget. */
interface Detail {
  maxListed: number;
  /** Composites inline, or as links. */
  images: 'inline' | 'links';
  /** Console-issue messages per shot, and their length. */
  issueBits: number;
  issueChars: number;
  /** Per-file table, unchanged / not-captured lists. */
  lists: boolean;
  /** Collapsible per-story sections (else one line per story). */
  storyDetails: boolean;
  /** Stories shown per section (changed / new / removed / unstable); the rest are counted. */
  maxStories: number;
  /** One-line stories link their composites. */
  links: boolean;
}

const ALL = Number.POSITIVE_INFINITY;
const LEVELS: Detail[] = [
  { maxListed: 60, images: 'inline', issueBits: 3, issueChars: 300, lists: true, storyDetails: true, maxStories: ALL, links: true },
  { maxListed: 25, images: 'inline', issueBits: 1, issueChars: 160, lists: true, storyDetails: true, maxStories: ALL, links: true },
  { maxListed: 25, images: 'links', issueBits: 1, issueChars: 160, lists: true, storyDetails: true, maxStories: ALL, links: true },
  { maxListed: 10, images: 'links', issueBits: 1, issueChars: 120, lists: false, storyDetails: true, maxStories: ALL, links: true },
  { maxListed: 10, images: 'links', issueBits: 1, issueChars: 120, lists: false, storyDetails: false, maxStories: ALL, links: true },
  { maxListed: 10, images: 'links', issueBits: 1, issueChars: 120, lists: false, storyDetails: false, maxStories: 60, links: true },
  { maxListed: 5, images: 'links', issueBits: 1, issueChars: 80, lists: false, storyDetails: false, maxStories: 25, links: false },
];

function listWithLimit<T>(items: T[], max: number, render: (item: T) => string): string[] {
  const shown = items.slice(0, max).map(render);
  if (items.length > max) shown.push(`- ... and ${items.length - max} more`);
  return shown;
}

function oneLine(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function percent(p: number | undefined): string {
  if (p === undefined) return '';
  return p < 0.01 ? '<0.01%' : `${p.toFixed(2)}%`;
}

function shotLabel(shot: ShotResult): string {
  if (shot.status === 'changed') return `${shot.viewport} — ${percent(shot.diffPercent)} of pixels changed`;
  if (shot.status === 'unstable') {
    return `${shot.viewport} — unstable: ${percent(shot.diffPercent)} differs, but a re-capture of the same code did not reproduce the difference`;
  }
  return `${shot.viewport} — ${shot.status}`;
}

function storyDetails(story: StoryResult, opts: BlockOptions, detail: Detail, open: boolean, globals: Set<string>): string[] {
  const changedOn = story.shots.filter((s) => s.status !== 'unchanged').map((s) => s.viewport);
  const what = story.status === 'changed' || story.status === 'unstable' ? `${story.status} on ${changedOn.join(', ')}` : story.status;
  const withImages = story.shots.filter((s) => s.composite);
  if (!detail.storyDetails) {
    const links = detail.links ? withImages.map((s) => `[${s.viewport}](${opts.imageUrl(s.composite!)})`).join(' · ') : '';
    return [`- ${code(story.id)} — ${what}${links ? ` · ${links}` : ''}`];
  }
  // Markdown isn't rendered inside <summary>: HTML only.
  const lines = [`<details${open ? ' open' : ''}><summary><b>${html(story.id)}</b> — ${what} · <code>${html(rel(story.file))}</code></summary>`, ''];
  // Global files are named once at the top; list only what else this story renders.
  const reasons = story.reasons.filter((r) => !globals.has(r));
  if (reasons.length > 0 && !story.direct) {
    lines.push(`Renders: ${reasons.slice(0, 5).map((r) => code(rel(r))).join(', ')}`, '');
  }
  if (detail.images === 'links') {
    const links = story.shots.map((s) =>
      s.composite ? `[**${shotLabel(s)}**](${opts.imageUrl(s.composite)})` : s.status === 'missing' ? `${s.viewport} — no screenshot` : `${s.viewport} — unchanged`,
    );
    lines.push(links.join('<br>'), '');
  } else {
    for (const shot of story.shots) {
      if (shot.status === 'unchanged') {
        lines.push(`**${shot.viewport}** — unchanged`, '');
      } else if (shot.status === 'missing') {
        lines.push(`**${shot.viewport}** — no screenshot (capture failed, see issues)`, '');
      } else if (shot.composite) {
        lines.push(`**${shotLabel(shot)}**`, '', `![${story.id} ${shot.viewport}: ${shot.status}](${opts.imageUrl(shot.composite)})`, '');
      }
    }
  }
  lines.push('</details>', '');
  return lines;
}

function render(report: ReviewReport, opts: BlockOptions, detail: Detail, shortened: boolean): string {
  const max = Math.min(opts.maxListed ?? detail.maxListed, detail.maxListed);
  const by = (status: StoryStatus) => report.stories.filter((s) => s.status === status);
  const changed = by('changed');
  const added = by('new');
  const removed = by('removed');
  const unchanged = by('unchanged');
  const unstable = by('unstable');
  const errored = by('error');
  const { selection } = report;
  const globals = new Set(selection.global?.files ?? []);

  const out: string[] = [START_MARKER, '## UI review', ''];
  const counts = [
    `**${changed.length} changed**`,
    `${added.length} new`,
    `${removed.length} removed`,
    `${unchanged.length} unchanged`,
    ...(unstable.length ? [`${unstable.length} unstable`] : []),
    ...(errored.length ? [`${errored.length} failed`] : []),
  ].join(' · ');
  out.push(
    `${counts} — base ${code(short(report.base.sha))} (${code(report.base.ref)}) → head ${code(short(report.head.sha))}${report.head.dirty ? ' plus uncommitted changes' : ''} · ${report.viewports.join(' / ')}`,
    '',
  );

  const notes: string[] = [];
  if (shortened) {
    notes.push(
      `Shortened to fit GitHub's PR description limit${opts.imagesUrl ? `: [all images of this run](${opts.imagesUrl})` : ''}; the full results are in \`.ui-review/out/report.json\` of the run.`,
    );
  }
  if (selection.global) {
    const files = `${selection.global.files.slice(0, 6).map(code).join(', ')}${selection.global.files.length > 6 ? ', ...' : ''}`;
    let note = `**Global change** (${files}) — it can restyle every story.`;
    if (selection.capped) {
      const parts: string[] = [];
      if (selection.targeted && selection.targeted.total > 0) {
        parts.push(`first the ${selection.targeted.captured} of ${selection.targeted.total} that render the other changed files`);
      }
      const spread = selection.storyFiles ? `, covering ${selection.storyFiles.sampled} of ${selection.storyFiles.total} story files` : '';
      parts.push(`${parts.length ? 'then ' : ''}a sample spread across areas${spread}`);
      note += ` Captured ${report.stories.length - removed.length} of ${selection.candidates} stories: ${parts.join(', ')}; run with \`--all\` for the full sweep.`;
    } else {
      note += ` Captured all ${selection.candidates} stories.`;
    }
    notes.push(note);
  } else if (selection.capped) {
    notes.push(
      `Capped at ${selection.maxStories} stories: ${selection.dropped.length} more render the change but were not captured (listed below); run with \`--all\` to capture them.`,
    );
  }
  if (selection.probed) {
    notes.push(
      `${selection.probed.stories} candidate stories statically reach the changed code; a render probe kept the ${selection.probed.kept} that actually execute it${selection.probed.cached ? ' (probe result reused from an earlier run of the same code)' : ''}.`,
    );
  }
  for (const note of notes) out.push(`> ${note}`, '>');
  if (notes.length) out.splice(out.length - 1, 1, '');

  if (report.stories.length === 0) {
    out.push('No story renders the changed files, so there is nothing to compare.', '');
  }

  const section = (title: string, stories: StoryResult[], intro: string | null, openFirst: number) => {
    if (!stories.length) return;
    out.push(`### ${title} (${stories.length})`, '');
    if (intro) out.push(intro, '');
    stories.slice(0, detail.maxStories).forEach((s, i) => out.push(...storyDetails(s, opts, detail, i < openFirst, globals)));
    if (stories.length > detail.maxStories) {
      out.push(`- ... and ${stories.length - detail.maxStories} more${opts.imagesUrl ? ` ([all images](${opts.imagesUrl}))` : ''}`);
    }
    if (!detail.storyDetails || stories.length > detail.maxStories) out.push('');
  };
  section('Changed', changed, null, 3);
  section('New stories', added, null, 0);
  section('Removed stories', removed, null, 0);
  section(
    'Unstable',
    unstable,
    'These differ between base and head, but capturing both sides again did not reproduce the difference (a race in the story or the app — e.g. a menu opened before media finished sizing, or a page caught mid-load), so it may not come from this change. Check them by eye.',
    0,
  );
  if (errored.length) {
    out.push(`### Failed to capture (${errored.length})`, '');
    out.push(...listWithLimit(errored.map((s) => s.id), max, (id) => `- ${code(id)}`), '');
  }

  const files = report.files ?? [];
  const notRun = files.filter((f) => f.captured === 0 && f.dropped === 0);
  const noVisible = files.filter((f) => f.captured > 0 && f.changed === 0 && f.unstable === 0);
  if (notRun.length) {
    out.push(
      '**Changed files no probed story executes** — the render probe found no story running the changed lines (they may only run after an interaction, or in a state no story sets up):',
      '',
      ...listWithLimit(notRun.map((f) => f.file), max, (f) => `- ${code(rel(f))}`),
      '',
    );
  }
  if (noVisible.length) {
    out.push(
      '**Changed files with no visible change in any captured story** — stories run this code but none looks different (e.g. it renders a closed dialog or menu, or off-screen); check that a story shows it:',
      '',
      ...listWithLimit(noVisible, max, (f) => `- ${code(rel(f.file))} (${plural(f.captured, 'captured story', 'captured stories')})`),
      '',
    );
  }

  if (detail.lists && unchanged.length) {
    out.push(
      `<details><summary>Unchanged (${unchanged.length}) — rendered on both sides, identical within tolerance</summary>`,
      '',
      ...listWithLimit(unchanged.map((s) => s.id), max, (id) => `- ${code(id)}`),
      '',
      '</details>',
      '',
    );
  }
  if (detail.lists && selection.dropped.length) {
    out.push(
      `<details><summary>Not captured (${selection.dropped.length}, over the cap)</summary>`,
      '',
      ...listWithLimit(selection.dropped, max, (id) => `- ${code(id)}`),
      '',
      '</details>',
      '',
    );
  }
  if (detail.lists && files.length) {
    out.push(
      `<details><summary>Changed files → captured stories (${files.length})</summary>`,
      '',
      '| File | Captured | Changed | Unstable | Not captured |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...files.slice(0, max).map((f) => `| ${code(rel(f.file))} | ${f.captured} | ${f.changed} | ${f.unstable} | ${f.dropped} |`),
      ...(files.length > max ? [`| ... and ${files.length - max} more | | | | |`] : []),
      '',
      '</details>',
      '',
    );
  }

  const issues = report.issues.filter((i) => !i.ok || i.pageErrors.length || i.renderErrors.length || i.unhandledRequests.length);
  if (issues.length) {
    out.push(`<details><summary>Console issues in ${plural(issues.length, 'shot')} (page errors, render errors, unhandled requests)</summary>`, '');
    const rendered = issues.map((i) => {
      const bits = [
        ...(i.ok ? [] : [`capture failed: ${oneLine(i.errorMessage ?? 'unknown error', detail.issueChars)}`]),
        ...i.pageErrors.map((e) => `page error: ${oneLine(e, detail.issueChars)}`),
        ...i.renderErrors.map((e) => `render error: ${oneLine(e, detail.issueChars)}`),
        ...i.unhandledRequests.map((e) => `unhandled request: ${oneLine(e, detail.issueChars)}`),
      ];
      const extra = bits.length > detail.issueBits ? ` (+${bits.length - detail.issueBits})` : '';
      return `- ${code(i.storyId)} @ ${i.viewport} (${i.side}): ${bits.slice(0, detail.issueBits).map(code).join('; ')}${extra}`;
    });
    out.push(...rendered.slice(0, max), ...(rendered.length > max ? [`- ... and ${rendered.length - max} more`] : []), '', '</details>', '');
  }

  if (report.uncovered.length) {
    out.push(
      '**Changed files no story renders** — consider adding a story (`frontend/src/stories/`):',
      '',
      ...listWithLimit(report.uncovered, max, (f) => `- ${code(f)}`),
      '',
    );
  }
  if (report.appOnly?.length) {
    out.push(
      '**Not visible in Ladle** — only the real app loads these (Ladle serves its own HTML with its own Vite config, and no story imports the app entry or `index.css`), so no screenshot can show this change:',
      '',
      ...listWithLimit(report.appOnly, max, (f) => `- ${code(f)}`),
      '',
    );
  }

  const t = report.thresholds;
  out.push(
    `<sub>Before = base, after = head; red outlines mark changed regions. Pixel tolerance: ${t.minPixels} px (pixelmatch threshold ${t.pixelmatchThreshold}, anti-aliasing ignored)${t.rechecks ? `; changes confirmed by ${plural(t.rechecks, 're-capture')} of both sides` : ''}. Regenerate: ${code(opts.command)}</sub>`,
    END_MARKER,
  );
  return `${out.join('\n')}\n`;
}

export function renderBlock(report: ReviewReport, opts: BlockOptions): string {
  const budget = opts.maxChars ?? Number.POSITIVE_INFINITY;
  for (const [level, detail] of LEVELS.entries()) {
    const md = render(report, opts, detail, level > 0);
    if (md.length <= budget) return md;
  }
  throw new Error(`the UI review section does not fit in ${budget} characters even in its shortest form`);
}
