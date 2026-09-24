// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderBlock, rawGithubUrl, publishFolder, summarizeFiles, treeUrl, type ReviewReport } from '../../../../scripts/ui-review/lib/block.ts';
import { START_MARKER, END_MARKER } from '../../../../scripts/ui-review/lib/body.ts';

describe('rawGithubUrl', () => {
  it('builds raw.githubusercontent.com URLs, encoding each path segment', () => {
    expect(rawGithubUrl('semaphore-chat/semaphore-chat', 'pr-screenshots', 'pr-12/run 1/a--b--phone.webp')).toBe(
      'https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/pr-screenshots/pr-12/run%201/a--b--phone.webp',
    );
  });

  it('rejects malformed repos', () => {
    expect(() => rawGithubUrl('nope', 'b', 'p')).toThrow(/owner\/name/);
  });
});

describe('publishFolder', () => {
  it('is pr-<n>/<utc timestamp>-<short sha> so re-publishes never hit a stale CDN cache', () => {
    expect(publishFolder(42, 'abcdef1234567', new Date('2026-09-23T19:05:07Z'))).toBe('pr-42/20260923-190507-abcdef1');
  });
});

const F = 'frontend/src/stories';
function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    base: { ref: 'origin/main', sha: 'aaaaaaa1111111' },
    head: { ref: 'feat/x', sha: 'bbbbbbb2222222', dirty: false },
    viewports: ['phone', 'tablet', 'desktop'],
    selection: { global: null, candidates: 40, probed: { stories: 38, kept: 5, durationMs: 60000 }, capped: false, maxStories: 40, dropped: [] },
    stories: [
      {
        id: 'message-reactions--default',
        file: `${F}/components/MessageReactions.stories.tsx`,
        direct: false,
        reasons: ['frontend/src/components/Message/MessageReactions.tsx'],
        status: 'changed',
        shots: [
          { viewport: 'phone', status: 'changed', diffPercent: 1.25, composite: 'message-reactions--default--phone.webp' },
          { viewport: 'tablet', status: 'unchanged' },
          { viewport: 'desktop', status: 'changed', diffPercent: 0.004, composite: 'message-reactions--default--desktop.webp' },
        ],
      },
      {
        id: 'chip--brand-new',
        file: `${F}/components/Chip.stories.tsx`,
        direct: true,
        reasons: [`${F}/components/Chip.stories.tsx`],
        status: 'new',
        shots: [
          { viewport: 'phone', status: 'new', composite: 'chip--brand-new--phone.webp' },
          { viewport: 'desktop', status: 'new', composite: 'chip--brand-new--desktop.webp' },
        ],
      },
      {
        id: 'chip--gone',
        file: `${F}/components/Chip.stories.tsx`,
        direct: true,
        reasons: [],
        status: 'removed',
        shots: [{ viewport: 'phone', status: 'removed', composite: 'chip--gone--phone.webp' }],
      },
      { id: 'settings--settings', file: `${F}/screens/Settings.stories.tsx`, direct: false, reasons: [], status: 'unchanged', shots: [{ viewport: 'phone', status: 'unchanged' }] },
      {
        id: 'menu--flaky',
        file: `${F}/edge/Menu.stories.tsx`,
        direct: false,
        reasons: [],
        status: 'unstable',
        shots: [
          { viewport: 'phone', status: 'unchanged' },
          { viewport: 'desktop', status: 'unstable', diffPercent: 3.5, composite: 'menu--flaky--desktop.webp' },
        ],
      },
    ],
    uncovered: ['frontend/src/components/Admin/Orphan.tsx'],
    issues: [
      { side: 'head', storyId: 'settings--settings', viewport: 'phone', ok: true, errorMessage: null, pageErrors: ['TypeError: boom'], renderErrors: [], unhandledRequests: ['[MSW] unhandled GET /api/x'] },
    ],
    thresholds: { minPixels: 24, pixelmatchThreshold: 0.1 },
    ...overrides,
  };
}

const opts = {
  imageUrl: (p: string) => `https://img.test/${p}`,
  command: 'frontend/scripts/ui-review/ui-review.sh --base origin/main --pr 7 --publish --update-pr',
};

describe('renderBlock', () => {
  const md = renderBlock(report(), opts);

  it('is wrapped in the markers', () => {
    expect(md.startsWith(START_MARKER)).toBe(true);
    expect(md.trimEnd().endsWith(END_MARKER)).toBe(true);
  });

  it('summarises counts and shas', () => {
    expect(md).toContain('1 changed');
    expect(md).toContain('1 new');
    expect(md).toContain('1 removed');
    expect(md).toContain('1 unchanged');
    expect(md).toContain('`aaaaaaa`');
    expect(md).toContain('`bbbbbbb`');
  });

  it('shows before/after composites for changed viewports and names the unchanged ones', () => {
    expect(md).toContain('<summary><b>message-reactions--default</b>');
    expect(md).toContain('https://img.test/message-reactions--default--phone.webp');
    expect(md).toContain('https://img.test/message-reactions--default--desktop.webp');
    expect(md).toMatch(/tablet[^\n]*unchanged/);
    expect(md).toContain('1.25%');
  });

  it('lists new and removed stories with their images', () => {
    expect(md).toContain('https://img.test/chip--brand-new--phone.webp');
    expect(md).toContain('https://img.test/chip--gone--phone.webp');
  });

  it('keeps unstable stories out of "changed", in their own collapsed section with images', () => {
    expect(md).toContain('1 unstable');
    expect(md).toMatch(/### Unstable \(1\)/);
    expect(md).toMatch(/capturing both sides again did not reproduce the difference/);
    expect(md).toContain('<details><summary><b>menu--flaky</b>');
    expect(md).toContain('https://img.test/menu--flaky--desktop.webp');
    const changedSection = md.slice(md.indexOf('### Changed'), md.indexOf('### New stories'));
    expect(changedSection).not.toContain('menu--flaky');
  });

  it('collapses the unchanged stories that were checked', () => {
    expect(md).toMatch(/<details><summary>Unchanged \(1\)/);
    expect(md).toContain('`settings--settings`');
  });

  it('reports page errors / unhandled requests and uncovered files', () => {
    expect(md).toContain('TypeError: boom');
    expect(md).toContain('[MSW] unhandled GET /api/x');
    expect(md).toContain('`frontend/src/components/Admin/Orphan.tsx`');
  });

  it('includes the regenerate command and the probe summary', () => {
    expect(md).toContain(opts.command);
    expect(md).toMatch(/38 candidate stories/);
  });

  it('says clearly when a global change was sampled / capped', () => {
    const capped = renderBlock(
      report({
        selection: { global: { files: ['frontend/src/theme/tokens.ts'] }, candidates: 221, probed: null, capped: true, maxStories: 40, dropped: ['a--b', 'c--d'] },
      }),
      opts,
    );
    expect(capped).toContain('frontend/src/theme/tokens.ts');
    expect(capped).toMatch(/Captured 4 of 221 stories: a sample spread across areas/);
    expect(capped).toContain('--all');
    expect(capped).toContain('`a--b`');
  });

  it('flags a dirty working tree', () => {
    expect(renderBlock(report({ head: { ref: 'x', sha: 'bbbbbbb2222222', dirty: true } }), opts)).toContain('uncommitted');
  });

  it('explains when nothing renders the change', () => {
    const none = renderBlock(report({ stories: [], issues: [], selection: { global: null, candidates: 0, probed: null, capped: false, maxStories: 40, dropped: [] } }), opts);
    expect(none).toMatch(/No story renders/);
    expect(none).toContain('Orphan.tsx');
  });

  it('never emits emoji', () => {
    expect(md).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('uses HTML, not Markdown backticks, inside <summary> (GitHub shows those literally)', () => {
    const summaries = md.split('\n').filter((l) => l.includes('<summary><b>'));
    expect(summaries.length).toBeGreaterThan(0);
    for (const line of summaries) expect(line).not.toContain('`');
    expect(md).toContain('<code>src/stories/components/MessageReactions.stories.tsx</code></summary>');
  });

  it('names the global files, and says which stories render the other changed files first', () => {
    const md2 = renderBlock(
      report({
        selection: {
          global: { files: ['frontend/package.json'] },
          candidates: 221,
          probed: { stories: 200, kept: 2, durationMs: 1000 },
          capped: true,
          maxStories: 40,
          dropped: ['x--y'],
          targeted: { total: 2, captured: 2 },
          storyFiles: { total: 53, sampled: 38 },
        },
      }),
      opts,
    );
    expect(md2).toMatch(/first the 2 of 2 that render the other changed files, then a sample spread across areas, covering 38 of 53 story files/);
  });

  it('names the global files once at the top, not as what each sampled story "renders"', () => {
    const base = report();
    const md3 = renderBlock(
      report({
        selection: { ...base.selection, global: { files: ['frontend/package.json'] } },
        stories: base.stories.map((s) =>
          s.id === 'message-reactions--default' ? { ...s, reasons: ['frontend/src/components/Message/MessageReactions.tsx', 'frontend/package.json'] } : s.id === 'menu--flaky' ? { ...s, reasons: ['frontend/package.json'] } : s,
        ),
      }),
      opts,
    );
    expect(md3).toContain('Renders: `src/components/Message/MessageReactions.tsx`\n');
    expect(md3).not.toMatch(/Renders:[^\n]*package\.json/);
  });

  it('lists app-only files as not visible in Ladle', () => {
    const appOnly = renderBlock(report({ appOnly: ['frontend/src/index.css'] }), opts);
    expect(appOnly).toMatch(/\*\*Not visible in Ladle\*\*/);
    expect(appOnly).toContain('`frontend/src/index.css`');
  });

  it('flags changed files whose stories show nothing, or that no probed story runs', () => {
    const files = renderBlock(
      report({
        files: [
          { file: 'frontend/src/components/Voice/ScreenSourcePicker.tsx', captured: 25, changed: 0, unstable: 0, dropped: 0 },
          { file: 'frontend/src/pages/AdminDashboard.tsx', captured: 2, changed: 1, unstable: 0, dropped: 0 },
          { file: 'frontend/src/components/Hidden.tsx', captured: 0, changed: 0, unstable: 0, dropped: 0 },
        ],
      }),
      opts,
    );
    expect(files).toMatch(/no visible change in any captured story[^\n]*\n\n- `src\/components\/Voice\/ScreenSourcePicker.tsx` \(25 captured stories\)/);
    expect(files).toMatch(/no probed story executes[^\n]*\n\n- `src\/components\/Hidden.tsx`/);
    expect(files).toContain('| `src/pages/AdminDashboard.tsx` | 2 | 1 | 0 | 0 |');
  });
});

describe("renderBlock — fitting GitHub's PR description limit", () => {
  const many = (n: number, status: 'changed' | 'unstable') =>
    Array.from({ length: n }, (_, i) => ({
      id: `edge-story-number-${i}--some-long-variant-name`,
      file: 'frontend/src/stories/edge/chat/EdgeChatWorstCase.stories.tsx',
      direct: false,
      reasons: ['frontend/src/components/Message/MessageReactions.tsx'],
      status,
      shots: ['phone', 'tablet', 'desktop'].map((viewport) => ({
        viewport,
        status,
        diffPercent: 1.5,
        composite: `edge-story-number-${i}--some-long-variant-name--${viewport}.webp`,
      })),
    }));
  const big = report({
    stories: many(221, 'changed'),
    issues: Array.from({ length: 80 }, (_, i) => ({
      side: 'head' as const,
      storyId: `s${i}`,
      viewport: 'phone',
      ok: true,
      errorMessage: null,
      pageErrors: [],
      renderErrors: ['The above error occurred in the <X> component '.repeat(20)],
      unhandledRequests: ['[MSW] Warning: intercepted a request without a matching request handler: GET /api/x '.repeat(10)],
    })),
  });
  const urlOpts = {
    ...opts,
    imageUrl: (p: string) => `https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/pr-screenshots/pr-450/20260923-190507-abcdef1/${p}`,
    imagesUrl: treeUrl('semaphore-chat/semaphore-chat', 'pr-screenshots', 'pr-450/20260923-190507-abcdef1'),
  };

  it('renders everything when there is no budget', () => {
    expect(renderBlock(big, urlOpts).length).toBeGreaterThan(65_536);
  });

  it('shortens step by step until it fits, and says so', () => {
    // Regression: a 221-story --all run produced a ~214k-character section; gh pr edit then failed.
    const budget = 30_000;
    const md = renderBlock(big, { ...urlOpts, maxChars: budget });
    expect(md.length).toBeLessThanOrEqual(budget);
    expect(md.startsWith('<!-- ui-review:start -->')).toBe(true);
    expect(md.trimEnd().endsWith('<!-- ui-review:end -->')).toBe(true);
    expect(md).toMatch(
      /Shortened to fit GitHub's PR description limit: \[all images of this run\]\(https:\/\/github\.com\/semaphore-chat\/semaphore-chat\/tree\/pr-screenshots\/pr-450\/20260923-190507-abcdef1\)/,
    );
    expect(md).toContain('**221 changed**');
  });

  it('keeps inline images when they fit, links when they do not', () => {
    const small = report({ stories: many(3, 'changed') });
    expect(renderBlock(small, { ...urlOpts, maxChars: 60_000 })).toContain('![edge-story-number-0');
    const md = renderBlock(big, { ...urlOpts, maxChars: 60_000 });
    expect(md.length).toBeLessThanOrEqual(60_000);
    expect(md).not.toContain('![');
    expect(md).toContain('](https://raw.githubusercontent.com/');
  });

  it('throws when even the shortest form does not fit', () => {
    expect(() => renderBlock(big, { ...urlOpts, maxChars: 500 })).toThrow(/does not fit/);
  });
});

describe('summarizeFiles', () => {
  it('counts, per changed file, the captured stories that run it by outcome, and the ones over the cap', () => {
    const leafTargets = {
      'frontend/src/pages/AdminDashboard.tsx': ['frontend/src/pages/AdminDashboard.tsx'],
      'frontend/src/components/Channel/ChannelList.css': ['frontend/src/components/Channel/ChannelList.tsx'],
      'frontend/src/stories/components/Chip.stories.tsx': [],
    };
    const captured = [
      { file: 'a', reasons: ['frontend/src/pages/AdminDashboard.tsx', 'frontend/package.json'], status: 'changed' },
      { file: 'b', reasons: ['frontend/src/pages/AdminDashboard.tsx'], status: 'unchanged' },
      { file: 'c', reasons: ['frontend/src/components/Channel/ChannelList.tsx'], status: 'unstable' },
      { file: 'frontend/src/stories/components/Chip.stories.tsx', reasons: ['frontend/src/stories/components/Chip.stories.tsx'], status: 'new' },
      { file: 'd', reasons: ['frontend/package.json'], status: 'unchanged' },
    ];
    const dropped = [{ file: 'e', reasons: ['frontend/src/pages/AdminDashboard.tsx'] }];
    expect(summarizeFiles(leafTargets, captured, dropped)).toEqual([
      { file: 'frontend/src/components/Channel/ChannelList.css', captured: 1, changed: 0, unstable: 1, dropped: 0 },
      { file: 'frontend/src/pages/AdminDashboard.tsx', captured: 2, changed: 1, unstable: 0, dropped: 1 },
      { file: 'frontend/src/stories/components/Chip.stories.tsx', captured: 1, changed: 1, unstable: 0, dropped: 0 },
    ]);
  });
});
