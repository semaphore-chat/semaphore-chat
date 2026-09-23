// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderBlock, rawGithubUrl, publishFolder, type ReviewReport } from '../../../../scripts/ui-review/lib/block.ts';
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
    expect(capped).toMatch(/representative sample of 4 of 221/);
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
});
