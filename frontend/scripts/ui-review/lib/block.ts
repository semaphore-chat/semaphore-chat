/**
 * The PR-description section (between the ui-review markers) and the URLs of
 * published images. Pure.
 */
import { START_MARKER, END_MARKER } from './body.ts';
import type { ShotStatus, StoryStatus } from './classify.ts';

export interface ShotResult {
  viewport: string;
  status: ShotStatus;
  diffPixels?: number;
  diffPercent?: number;
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

export interface ReviewReport {
  base: { ref: string; sha: string };
  head: { ref: string; sha: string; dirty: boolean };
  viewports: string[];
  selection: {
    global: { files: string[] } | null;
    /** Stories statically reachable from the change (all stories for a global change). */
    candidates: number;
    probed: { stories: number; kept: number; durationMs: number } | null;
    capped: boolean;
    maxStories: number;
    /** Selected but not captured because of the cap. */
    dropped: string[];
  };
  stories: StoryResult[];
  uncovered: string[];
  issues: ShotIssue[];
  thresholds: { minPixels: number; pixelmatchThreshold: number };
}

export interface BlockOptions {
  imageUrl: (composite: string) => string;
  /** Command that regenerates this section. */
  command: string;
  /** Max entries in long lists (unchanged, dropped, issues). */
  maxListed?: number;
}

export function rawGithubUrl(repo: string, branch: string, path: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`repo must be "owner/name", got "${repo}"`);
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${encoded}`;
}

/** `pr-<n>/<UTC yyyymmdd-hhmmss>-<sha7>` — a fresh path per publish sidesteps raw/camo caching. */
export function publishFolder(pr: number, headSha: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `pr-${pr}/${stamp}-${headSha.slice(0, 7)}`;
}

const short = (sha: string) => sha.slice(0, 7);
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listWithLimit(items: string[], max: number, render: (item: string) => string): string[] {
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

function storyDetails(story: StoryResult, opts: BlockOptions, open: boolean): string[] {
  const rel = story.file.replace(/^frontend\//, '');
  const changedOn = story.shots.filter((s) => s.status !== 'unchanged').map((s) => s.viewport);
  const summaryBits = [story.status === 'changed' ? `changed on ${changedOn.join(', ')}` : story.status, code(rel)];
  const lines = [`<details${open ? ' open' : ''}><summary><b>${story.id}</b> — ${summaryBits.join(' · ')}</summary>`, ''];
  if (story.reasons.length > 0 && !story.direct) {
    lines.push(`Renders: ${story.reasons.slice(0, 5).map((r) => code(r.replace(/^frontend\//, ''))).join(', ')}`, '');
  }
  for (const shot of story.shots) {
    if (shot.status === 'unchanged') {
      lines.push(`**${shot.viewport}** — unchanged`, '');
    } else if (shot.status === 'missing') {
      lines.push(`**${shot.viewport}** — no screenshot (capture failed, see issues)`, '');
    } else if (shot.composite) {
      const label = shot.status === 'changed' ? `${shot.viewport} — ${percent(shot.diffPercent)} of pixels changed` : `${shot.viewport} — ${shot.status}`;
      lines.push(`**${label}**`, '', `![${story.id} ${shot.viewport}: ${shot.status}](${opts.imageUrl(shot.composite)})`, '');
    }
  }
  lines.push('</details>', '');
  return lines;
}

export function renderBlock(report: ReviewReport, opts: BlockOptions): string {
  const max = opts.maxListed ?? 60;
  const by = (status: StoryStatus) => report.stories.filter((s) => s.status === status);
  const changed = by('changed');
  const added = by('new');
  const removed = by('removed');
  const unchanged = by('unchanged');
  const errored = by('error');
  const { selection } = report;

  const out: string[] = [START_MARKER, '## UI review', ''];
  const counts = [
    `**${changed.length} changed**`,
    `${added.length} new`,
    `${removed.length} removed`,
    `${unchanged.length} unchanged`,
    ...(errored.length ? [`${errored.length} failed`] : []),
  ].join(' · ');
  out.push(
    `${counts} — base ${code(short(report.base.sha))} (${code(report.base.ref)}) → head ${code(short(report.head.sha))}${report.head.dirty ? ' plus uncommitted changes' : ''} · ${report.viewports.join(' / ')}`,
    '',
  );

  const notes: string[] = [];
  if (selection.global) {
    notes.push(
      `**Global change** (${selection.global.files.slice(0, 6).map(code).join(', ')}${selection.global.files.length > 6 ? ', ...' : ''}) — it can restyle every story.` +
        (selection.capped
          ? ` Captured a representative sample of ${report.stories.length} of ${selection.candidates} stories (one per story file, spread across areas); run with \`--all\` for the full sweep.`
          : ` Captured all ${selection.candidates} stories.`),
    );
  } else if (selection.capped) {
    notes.push(
      `Capped at ${selection.maxStories} stories: ${selection.dropped.length} more render the change but were not captured (listed below); run with \`--all\` to capture them.`,
    );
  }
  if (selection.probed) {
    notes.push(
      `${selection.probed.stories} candidate stories statically import the change; a render probe kept the ${selection.probed.kept} that actually execute the changed code.`,
    );
  }
  for (const note of notes) out.push(`> ${note}`, '>');
  if (notes.length) out.splice(out.length - 1, 1, '');

  if (report.stories.length === 0) {
    out.push('No story renders the changed files, so there is nothing to compare.', '');
  }

  if (changed.length) {
    out.push(`### Changed (${changed.length})`, '');
    changed.forEach((s, i) => out.push(...storyDetails(s, opts, i < 3)));
  }
  if (added.length) {
    out.push(`### New stories (${added.length})`, '');
    added.forEach((s) => out.push(...storyDetails(s, opts, false)));
  }
  if (removed.length) {
    out.push(`### Removed stories (${removed.length})`, '');
    removed.forEach((s) => out.push(...storyDetails(s, opts, false)));
  }
  if (errored.length) {
    out.push(`### Failed to capture (${errored.length})`, '');
    out.push(...listWithLimit(errored.map((s) => s.id), max, (id) => `- ${code(id)}`), '');
  }
  if (unchanged.length) {
    out.push(
      `<details><summary>Unchanged (${unchanged.length}) — rendered on both sides, identical within tolerance</summary>`,
      '',
      ...listWithLimit(unchanged.map((s) => s.id), max, (id) => `- ${code(id)}`),
      '',
      '</details>',
      '',
    );
  }
  if (selection.dropped.length) {
    out.push(
      `<details><summary>Not captured (${selection.dropped.length}, over the cap)</summary>`,
      '',
      ...listWithLimit(selection.dropped, max, (id) => `- ${code(id)}`),
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
        ...(i.ok ? [] : [`capture failed: ${oneLine(i.errorMessage ?? 'unknown error')}`]),
        ...i.pageErrors.map((e) => `page error: ${oneLine(e)}`),
        ...i.renderErrors.map((e) => `render error: ${oneLine(e)}`),
        ...i.unhandledRequests.map((e) => `unhandled request: ${oneLine(e)}`),
      ];
      return `- ${code(i.storyId)} @ ${i.viewport} (${i.side}): ${bits.slice(0, 3).map(code).join('; ')}${bits.length > 3 ? ` (+${bits.length - 3})` : ''}`;
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

  out.push(
    `<sub>Before = base, after = head; red outlines mark changed regions. Pixel tolerance: ${report.thresholds.minPixels} px (pixelmatch threshold ${report.thresholds.pixelmatchThreshold}, anti-aliasing ignored). Regenerate: ${code(opts.command)}</sub>`,
    END_MARKER,
  );
  return `${out.join('\n')}\n`;
}
