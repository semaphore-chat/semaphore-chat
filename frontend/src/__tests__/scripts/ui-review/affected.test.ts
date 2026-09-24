// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  computeAffected,
  globToRegExp,
  planProbe,
  applyProbe,
  capStories,
  probeImporters,
  suggestStoryIds,
  type ModuleGraph,
  type StoryRef,
} from '../../../../scripts/ui-review/lib/affected.ts';

/**
 * Fixture graph shaped like the real sandbox: every story reaches the harness
 * shell (SandboxShell -> StoryRoutes -> Layout, lazy pages), component stories
 * also import their component directly, and the Ladle global provider pulls in
 * the theme.
 */
function node(imports: string[] = [], dynamicImports: string[] = []) {
  return { imports, dynamicImports };
}

const F = 'frontend/src';
const graph: ModuleGraph = {
  'frontend/.ladle/components.tsx': node([`${F}/contexts/ThemeContext.tsx`]),
  [`${F}/contexts/ThemeContext.tsx`]: node([`${F}/theme/themeConfig.ts`]),
  [`${F}/theme/themeConfig.ts`]: node([`${F}/theme/tokens.ts`]),
  [`${F}/theme/tokens.ts`]: node(),

  // harness
  [`${F}/stories/fixtures/componentStory.tsx`]: node([`${F}/stories/fixtures/SandboxShell.tsx`, `${F}/stories/fixtures/handlers.ts`]),
  [`${F}/stories/fixtures/screenStory.tsx`]: node([`${F}/stories/fixtures/SandboxShell.tsx`, `${F}/stories/fixtures/handlers.ts`]),
  [`${F}/stories/fixtures/SandboxShell.tsx`]: node([`${F}/stories/fixtures/AuthenticatedShell.tsx`, `${F}/stories/fixtures/StoryRoutes.tsx`]),
  [`${F}/stories/fixtures/AuthenticatedShell.tsx`]: node([`${F}/contexts/VoiceContext.tsx`]),
  [`${F}/stories/fixtures/StoryRoutes.tsx`]: node([`${F}/Layout.tsx`], [`${F}/pages/CommunityPage.tsx`, `${F}/pages/SettingsPage.tsx`]),
  [`${F}/stories/fixtures/handlers.ts`]: node([`${F}/stories/fixtures/builder.ts`]),
  [`${F}/stories/fixtures/builder.ts`]: node(),
  [`${F}/stories/fixtures/edge/chat.ts`]: node([`${F}/utils/messageCacheUpdaters.ts`]),
  [`${F}/contexts/VoiceContext.tsx`]: node([`${F}/hooks/useVoice.ts`]),
  [`${F}/hooks/useVoice.ts`]: node(),
  [`${F}/utils/messageCacheUpdaters.ts`]: node(),

  // app
  [`${F}/Layout.tsx`]: node([`${F}/components/Desktop/DesktopLayout.tsx`]),
  [`${F}/components/Desktop/DesktopLayout.tsx`]: node([`${F}/components/Channel/ChannelList.tsx`]),
  [`${F}/components/Channel/ChannelList.tsx`]: node([`${F}/components/Channel/ChannelList.css`]),
  [`${F}/components/Channel/ChannelList.css`]: node(),
  [`${F}/pages/CommunityPage.tsx`]: node([`${F}/components/Message/MessageComponent.tsx`]),
  [`${F}/pages/SettingsPage.tsx`]: node(),
  [`${F}/components/Message/MessageComponent.tsx`]: node([`${F}/components/Message/MessageReactions.tsx`]),
  [`${F}/components/Message/MessageReactions.tsx`]: node([`${F}/components/Common/Chip.tsx`]),
  [`${F}/components/Common/Chip.tsx`]: node(),
  'shared/src/index.ts': node(),

  // stories
  [`${F}/stories/components/MessageReactions.stories.tsx`]: node([
    `${F}/components/Message/MessageReactions.tsx`,
    `${F}/stories/fixtures/componentStory.tsx`,
  ]),
  [`${F}/stories/components/EmptyState.stories.tsx`]: node([`${F}/stories/fixtures/componentStory.tsx`]),
  [`${F}/stories/screens/ChannelChat.stories.tsx`]: node([`${F}/stories/fixtures/screenStory.tsx`, 'shared/src/index.ts']),
  [`${F}/stories/screens/Settings.stories.tsx`]: node([`${F}/stories/fixtures/screenStory.tsx`]),
  [`${F}/stories/edge/chat/EdgeChat.stories.tsx`]: node([`${F}/stories/fixtures/screenStory.tsx`, `${F}/stories/fixtures/edge/chat.ts`]),
};

const headStories: StoryRef[] = [
  { id: 'message-reactions--few', file: `${F}/stories/components/MessageReactions.stories.tsx` },
  { id: 'message-reactions--many', file: `${F}/stories/components/MessageReactions.stories.tsx` },
  { id: 'empty-state--messages', file: `${F}/stories/components/EmptyState.stories.tsx` },
  { id: 'channel-chat--busy', file: `${F}/stories/screens/ChannelChat.stories.tsx` },
  { id: 'settings--settings', file: `${F}/stories/screens/Settings.stories.tsx` },
  { id: 'edge-chat--reactions', file: `${F}/stories/edge/chat/EdgeChat.stories.tsx` },
  { id: 'edge-chat--wall-of-text', file: `${F}/stories/edge/chat/EdgeChat.stories.tsx` },
];

const ids = (stories: { id: string }[]) => stories.map((s) => s.id).sort();

describe('globToRegExp', () => {
  it('matches ** across directories and * within one segment', () => {
    expect(globToRegExp('frontend/.ladle/**').test('frontend/.ladle/components.tsx')).toBe(true);
    expect(globToRegExp('frontend/.ladle/**').test('frontend/.ladle/sub/x.ts')).toBe(true);
    expect(globToRegExp('frontend/src/theme/**').test('frontend/src/themes/x.ts')).toBe(false);
    expect(globToRegExp('frontend/tsconfig*.json').test('frontend/tsconfig.app.json')).toBe(true);
    expect(globToRegExp('frontend/tsconfig*.json').test('frontend/sub/tsconfig.json')).toBe(false);
    expect(globToRegExp('pnpm-lock.yaml').test('pnpm-lock.yaml')).toBe(true);
    expect(globToRegExp('pnpm-lock.yaml').test('frontend/pnpm-lock.yaml')).toBe(false);
  });
});

describe('computeAffected — graph mapping', () => {
  it('maps a leaf component to every story that transitively imports it (static and lazy)', () => {
    const result = computeAffected({
      changed: [{ path: `${F}/components/Common/Chip.tsx`, status: 'M' }],
      graph,
      headStories,
      baseStories: headStories,
    });
    expect(result.global).toBeNull();
    // Component story imports it directly; every SandboxShell story reaches it
    // through StoryRoutes' lazy CommunityPage.
    expect(ids(result.stories)).toEqual(ids(headStories));
    expect(result.stories.every((s) => !s.direct)).toBe(true);
    expect(result.stories.find((s) => s.id === 'message-reactions--few')?.reasons).toEqual([`${F}/components/Common/Chip.tsx`]);
    expect(result.probeTargets).toEqual([`${F}/components/Common/Chip.tsx`]);
    expect(result.uncovered).toEqual([]);
  });

  it('only selects the stories that can reach a narrowly used module', () => {
    const result = computeAffected({
      changed: [{ path: `${F}/utils/messageCacheUpdaters.ts`, status: 'M' }],
      graph,
      headStories,
      baseStories: headStories,
    });
    expect(ids(result.stories)).toEqual(['edge-chat--reactions', 'edge-chat--wall-of-text']);
  });

  it('resolves CSS (non-JS) changes to their JS importers for the probe', () => {
    const result = computeAffected({
      changed: [{ path: `${F}/components/Channel/ChannelList.css`, status: 'M' }],
      graph,
      headStories,
      baseStories: headStories,
    });
    expect(result.global).toBeNull();
    expect(result.probeTargets).toEqual([`${F}/components/Channel/ChannelList.tsx`]);
    expect(result.stories.length).toBeGreaterThan(0);
  });

  it('treats a changed story file as direct and reports its removed exports', () => {
    const base: StoryRef[] = [...headStories, { id: 'message-reactions--old-name', file: `${F}/stories/components/MessageReactions.stories.tsx` }];
    const result = computeAffected({
      changed: [{ path: `${F}/stories/components/MessageReactions.stories.tsx`, status: 'M' }],
      graph,
      headStories,
      baseStories: base,
    });
    expect(ids(result.stories)).toEqual(['message-reactions--few', 'message-reactions--many']);
    expect(result.stories.every((s) => s.direct)).toBe(true);
    expect(result.removed).toEqual([{ id: 'message-reactions--old-name', file: `${F}/stories/components/MessageReactions.stories.tsx` }]);
  });

  it('reports every story of a deleted story file as removed', () => {
    const base: StoryRef[] = [...headStories, { id: 'gone--a', file: `${F}/stories/components/Gone.stories.tsx` }];
    const result = computeAffected({
      changed: [{ path: `${F}/stories/components/Gone.stories.tsx`, status: 'D' }],
      graph,
      headStories,
      baseStories: base,
    });
    expect(result.stories).toEqual([]);
    expect(result.removed).toEqual([{ id: 'gone--a', file: `${F}/stories/components/Gone.stories.tsx` }]);
  });

  it('includes shared/ sources in the graph', () => {
    const result = computeAffected({
      changed: [{ path: 'shared/src/index.ts', status: 'M' }],
      graph,
      headStories,
      baseStories: headStories,
    });
    expect(ids(result.stories)).toEqual(['channel-chat--busy']);
  });

  it('lists changed UI files that no story reaches as uncovered, and ignores non-UI files', () => {
    const result = computeAffected({
      changed: [
        { path: `${F}/components/Admin/Orphan.tsx`, status: 'A' },
        { path: `${F}/main.tsx`, status: 'M' },
        { path: `${F}/__tests__/components/Foo.test.tsx`, status: 'M' },
        { path: 'frontend/e2e/login.spec.ts', status: 'M' },
        { path: 'backend/src/app.module.ts', status: 'M' },
        { path: `${F}/components/Old.tsx`, status: 'D' },
        { path: 'docs-site/docs/index.md', status: 'M' },
      ],
      graph,
      headStories,
      baseStories: headStories,
    });
    expect(result.stories).toEqual([]);
    expect(result.uncovered).toEqual([`${F}/components/Admin/Orphan.tsx`]);
    expect(result.appOnly).toEqual([`${F}/main.tsx`]);
    expect(result.ignored).toEqual([
      'backend/src/app.module.ts',
      'docs-site/docs/index.md',
      'frontend/e2e/login.spec.ts',
      `${F}/__tests__/components/Foo.test.tsx`,
      `${F}/components/Old.tsx`,
    ]);
  });
});

describe('computeAffected — global changes', () => {
  const run = (path: string) =>
    computeAffected({ changed: [{ path, status: 'M' }], graph, headStories, baseStories: headStories });

  it.each([
    'frontend/.ladle/config.mjs',
    'frontend/src/theme/tokens.ts',
    'frontend/package.json',
    'pnpm-lock.yaml',
  ])('%s → every story', (path) => {
    const result = run(path);
    expect(result.global?.files).toEqual([path]);
    expect(ids(result.stories)).toEqual(ids(headStories));
  });

  it('anything the Ladle global provider imports is global', () => {
    expect(run(`${F}/contexts/ThemeContext.tsx`).global?.files).toEqual([`${F}/contexts/ThemeContext.tsx`]);
  });

  it('harness modules used by (nearly) every story are global', () => {
    expect(run(`${F}/stories/fixtures/SandboxShell.tsx`).global).not.toBeNull();
    expect(run(`${F}/stories/fixtures/builder.ts`).global).not.toBeNull();
  });

  it('app modules the shared harness imports directly (Layout, providers) are global, lazy pages are not', () => {
    expect(run(`${F}/Layout.tsx`).global).not.toBeNull();
    expect(run(`${F}/contexts/VoiceContext.tsx`).global).not.toBeNull();
    expect(run(`${F}/pages/SettingsPage.tsx`).global).toBeNull();
    // deeper provider dependencies go through the normal (probe-able) path
    expect(run(`${F}/hooks/useVoice.ts`).global).toBeNull();
  });

  it('harness modules used by a subset of stories are not global', () => {
    const result = run(`${F}/stories/fixtures/edge/chat.ts`);
    expect(result.global).toBeNull();
    expect(ids(result.stories)).toEqual(['edge-chat--reactions', 'edge-chat--wall-of-text']);
  });

  it('keeps direct flags for changed story files inside a global change', () => {
    const result = computeAffected({
      changed: [
        { path: 'frontend/src/theme/tokens.ts', status: 'M' },
        { path: `${F}/stories/screens/Settings.stories.tsx`, status: 'M' },
      ],
      graph,
      headStories,
      baseStories: headStories,
    });
    expect(result.stories.filter((s) => s.direct).map((s) => s.id)).toEqual(['settings--settings']);
  });

  it.each(['frontend/src/index.css', 'frontend/index.html', 'frontend/vite.config.ts', 'frontend/src/main.tsx'])(
    '%s is app-only: Ladle never loads it, so it is reported, not sampled',
    (path) => {
      // Regression: these were "global", so an index.css change got a 40-story
      // sample reported as "0 changed" for a change Ladle cannot render.
      const result = run(path);
      expect(result.global).toBeNull();
      expect(result.stories).toEqual([]);
      expect(result.appOnly).toEqual([path]);
      expect(result.uncovered).toEqual([]);
    },
  );

  it('an app-only file that a story does reach is handled like any other file', () => {
    const reached: ModuleGraph = { ...graph, [`${F}/stories/fixtures/edge/chat.ts`]: node([`${F}/utils/messageCacheUpdaters.ts`, `${F}/index.css`]), [`${F}/index.css`]: node() };
    const result = computeAffected({ changed: [{ path: `${F}/index.css`, status: 'M' }], graph: reached, headStories, baseStories: headStories });
    expect(result.appOnly).toEqual([]);
    expect(ids(result.stories)).toEqual(['edge-chat--reactions', 'edge-chat--wall-of-text']);
  });
});

describe('computeAffected — a global change mixed with other changes', () => {
  // Regression: package.json + a leaf component → every story got reasons
  // [package.json], the leaf file vanished from the report and the stories
  // that render it could be dropped by the relevance-blind sample.
  const result = computeAffected({
    changed: [
      { path: 'frontend/package.json', status: 'M' },
      { path: `${F}/utils/messageCacheUpdaters.ts`, status: 'M' },
    ],
    graph,
    headStories,
    baseStories: headStories,
  });

  it('keeps every story a candidate, but marks the ones the other changed files reach as targeted', () => {
    expect(result.global?.files).toEqual(['frontend/package.json']);
    expect(ids(result.stories)).toEqual(ids(headStories));
    expect(ids(result.stories.filter((s) => s.targeted))).toEqual(['edge-chat--reactions', 'edge-chat--wall-of-text']);
    expect(result.stories.find((s) => s.id === 'edge-chat--reactions')?.reasons).toEqual([`${F}/utils/messageCacheUpdaters.ts`, 'frontend/package.json']);
    expect(result.stories.find((s) => s.id === 'settings--settings')?.reasons).toEqual(['frontend/package.json']);
    expect(result.leafTargets).toEqual({ [`${F}/utils/messageCacheUpdaters.ts`]: [`${F}/utils/messageCacheUpdaters.ts`] });
  });

  it('captures the targeted stories before the sample', () => {
    const { selected } = capStories(result.stories, { max: 3 });
    expect(selected.slice(0, 2).map((s) => s.id)).toEqual(['edge-chat--reactions', 'edge-chat--wall-of-text']);
  });

  it('probes the targeted stories (when there are enough), and keeps the rest as sample candidates', () => {
    expect(planProbe(result, { threshold: 1 })).toEqual({ probe: true, stories: ['edge-chat--reactions', 'edge-chat--wall-of-text'] });
    expect(planProbe(result, { threshold: 5 }).probe).toBe(false);
    const probed = applyProbe(result.stories, { 'edge-chat--reactions': { desktop: [`${F}/utils/messageCacheUpdaters.ts`] }, 'edge-chat--wall-of-text': { desktop: [] } }, {
      globalFiles: ['frontend/package.json'],
    });
    expect(ids(probed)).toEqual(ids(headStories));
    expect(ids(probed.filter((s) => s.targeted))).toEqual(['edge-chat--reactions']);
    expect(probed.find((s) => s.id === 'edge-chat--wall-of-text')?.reasons).toEqual(['frontend/package.json']);
  });
});

describe('computeAffected — moved story files and probe importers', () => {
  it('a story file moved to another directory keeps its ids: nothing is reported removed', () => {
    const moved = `${F}/stories/edge/states/EmptyState.stories.tsx`;
    const head = headStories.map((s) => (s.id === 'empty-state--messages' ? { ...s, file: moved } : s));
    const result = computeAffected({
      changed: [
        { path: `${F}/stories/components/EmptyState.stories.tsx`, status: 'D' },
        { path: moved, status: 'A' },
      ],
      graph: { ...graph, [moved]: node([`${F}/stories/fixtures/componentStory.tsx`]) },
      headStories: head,
      baseStories: headStories,
    });
    expect(result.removed).toEqual([]);
    expect(ids(result.stories)).toEqual(['empty-state--messages']);
  });

  it('probeImporters lists the importers of each target, a few levels up', () => {
    const importers = probeImporters(graph, [`${F}/components/Common/Chip.tsx`], 2);
    expect(importers[`${F}/components/Common/Chip.tsx`]).toEqual([`${F}/components/Message/MessageReactions.tsx`]);
    expect(importers[`${F}/components/Message/MessageReactions.tsx`]).toEqual([
      `${F}/components/Message/MessageComponent.tsx`,
      `${F}/stories/components/MessageReactions.stories.tsx`,
    ]);
    expect(importers[`${F}/components/Message/MessageComponent.tsx`]).toBeUndefined();
  });
});

describe('planProbe / applyProbe', () => {
  const affected = computeAffected({
    changed: [
      { path: `${F}/components/Common/Chip.tsx`, status: 'M' },
      { path: `${F}/stories/screens/Settings.stories.tsx`, status: 'M' },
    ],
    graph,
    headStories,
    baseStories: headStories,
  });

  it('probes only above the threshold of non-direct candidates, and then takes the direct stories along', () => {
    // 6 non-direct candidates (every story but the changed Settings one).
    expect(planProbe(affected, { threshold: 6 }).probe).toBe(false);
    const plan = planProbe(affected, { threshold: 5 });
    expect(plan.probe).toBe(true);
    expect(plan.stories).toContain('channel-chat--busy');
    // Captured anyway, but probed to learn which changed files it renders.
    expect(plan.stories).toContain('settings--settings');
    expect(plan.stories).toEqual([...plan.stories].sort());
  });

  it('never probes a global change', () => {
    const global = computeAffected({ changed: [{ path: 'pnpm-lock.yaml', status: 'M' }], graph, headStories, baseStories: headStories });
    expect(planProbe(global, { threshold: 0 }).probe).toBe(false);
  });

  it('keeps direct stories and stories that exercised a target; drops the rest', () => {
    const narrowed = applyProbe(affected.stories, {
      'message-reactions--few': { phone: [`${F}/components/Common/Chip.tsx`], desktop: [] },
      'edge-chat--reactions': { desktop: [`${F}/components/Common/Chip.tsx`] },
      'channel-chat--busy': { phone: [], tablet: [], desktop: [] },
    });
    expect(ids(narrowed)).toEqual(['edge-chat--reactions', 'message-reactions--few', 'settings--settings']);
    expect(narrowed.find((s) => s.id === 'edge-chat--reactions')?.exercisedOn).toEqual(['desktop']);
  });

  it('narrows the reasons of a probed direct story to its own file plus what it ran', () => {
    const settings = `${F}/stories/screens/Settings.stories.tsx`;
    const chip = `${F}/components/Common/Chip.tsx`;
    // Statically, the changed story file reaches the changed Chip (through the lazy pages).
    expect(affected.stories.find((s) => s.id === 'settings--settings')?.reasons).toEqual([chip, settings]);

    const didNotRun = applyProbe(affected.stories, { 'settings--settings': { desktop: [], tablet: [], phone: [] } });
    expect(didNotRun.find((s) => s.id === 'settings--settings')).toMatchObject({ direct: true, reasons: [settings] });

    const ran = applyProbe(affected.stories, { 'settings--settings': { desktop: [chip] } });
    expect(ran.find((s) => s.id === 'settings--settings')).toMatchObject({ direct: true, reasons: [settings, chip], exercisedOn: ['desktop'] });

    // Not probed (no probe ran): the static reasons stay.
    expect(applyProbe(affected.stories, {}).find((s) => s.id === 'settings--settings')?.reasons).toEqual([chip, settings]);
  });
});

describe('suggestStoryIds', () => {
  const known = [
    'edge-nav-notifications--long-names-narrow320',
    'edge-nav-notifications--one',
    'edge-nav-notifications--hundred-fifty',
    'edge-chat-dm--dm-composer-loaded',
  ];

  it('finds the id spelled with other dashes (digits stay attached to the word before them)', () => {
    expect(suggestStoryIds('edge-nav-notifications--long-names-narrow-320', known)).toEqual(['edge-nav-notifications--long-names-narrow320']);
    expect(suggestStoryIds('edge-chat-dm--d-m-composer-loaded', known)).toEqual(['edge-chat-dm--dm-composer-loaded']);
  });

  it('else lists the ids of the same story file', () => {
    expect(suggestStoryIds('edge-nav-notifications--long-names', known)).toEqual([
      'edge-nav-notifications--long-names-narrow320',
      'edge-nav-notifications--one',
      'edge-nav-notifications--hundred-fifty',
    ]);
    expect(suggestStoryIds('no-such-file--story', known)).toEqual([]);
  });
});

describe('capStories', () => {
  const many: StoryRef[] = [
    ...['a', 'b', 'c'].map((x) => ({ id: `screen-${x}--one`, file: `${F}/stories/screens/S${x}.stories.tsx` })),
    ...['a', 'b', 'c'].map((x) => ({ id: `screen-${x}--two`, file: `${F}/stories/screens/S${x}.stories.tsx` })),
    ...['a', 'b'].map((x) => ({ id: `comp-${x}--one`, file: `${F}/stories/components/C${x}.stories.tsx` })),
    ...['a', 'b'].map((x) => ({ id: `edge-${x}--one`, file: `${F}/stories/edge/chat/E${x}.stories.tsx` })),
  ];
  const stories = many.map((s) => ({ ...s, direct: false, reasons: [] as string[] }));

  it('returns everything when under the cap or when forced', () => {
    expect(capStories(stories, { max: 50 }).capped).toBe(false);
    const forced = capStories(stories, { max: 2, all: true });
    expect(forced.capped).toBe(false);
    expect(forced.selected).toHaveLength(stories.length);
  });

  it('samples one story per file, round-robin across directories (screens, components, then the rest), before second stories', () => {
    const { selected, dropped, capped } = capStories(stories, { max: 5 });
    expect(capped).toBe(true);
    expect(selected.map((s) => s.id)).toEqual(['screen-a--one', 'comp-a--one', 'edge-a--one', 'screen-b--one', 'comp-b--one']);
    expect(dropped).toHaveLength(stories.length - 5);
  });

  it('always keeps direct stories first', () => {
    const withDirect = stories.map((s) => (s.id === 'screen-c--two' ? { ...s, direct: true } : s));
    const { selected } = capStories(withDirect, { max: 2 });
    expect(selected.map((s) => s.id)).toEqual(['screen-c--two', 'screen-a--one']);
  });

  it('puts targeted stories (global mode) after direct ones and before the sample', () => {
    const mixed = stories.map((s) => ({ ...s, targeted: s.id === 'edge-b--one' || s.id === 'comp-b--one' }));
    const { selected } = capStories(mixed, { max: 4 });
    expect(selected.map((s) => s.id)).toEqual(['comp-b--one', 'edge-b--one', 'screen-a--one', 'comp-a--one']);
  });

  it('is deterministic regardless of input order', () => {
    const a = capStories(stories, { max: 4 }).selected.map((s) => s.id);
    const b = capStories([...stories].reverse(), { max: 4 }).selected.map((s) => s.id);
    expect(a).toEqual(b);
  });
});
