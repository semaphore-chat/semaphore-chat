// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fileFromModuleUrl, exercisedFiles, exercisedTargets, type CoverageScript } from '../../../../scripts/ui-review/lib/coverage.ts';

const MOUNTS = [
  { urlPrefix: '/@fs/app/frontend/', repoPrefix: 'frontend/' },
  { urlPrefix: '/@fs/app/shared/', repoPrefix: 'shared/' },
];

describe('fileFromModuleUrl', () => {
  it('maps Vite /@fs URLs to repo paths and drops query strings', () => {
    expect(fileFromModuleUrl('http://localhost:61000/@fs/app/frontend/src/components/X.tsx?t=123', MOUNTS)).toBe('frontend/src/components/X.tsx');
    expect(fileFromModuleUrl('http://localhost:61000/@fs/app/shared/src/index.ts', MOUNTS)).toBe('shared/src/index.ts');
  });

  it('ignores Ladle internals and pre-bundled deps', () => {
    expect(fileFromModuleUrl('http://localhost:61000/src/app.jsx', MOUNTS)).toBeNull();
    expect(fileFromModuleUrl('http://localhost:61000/@fs/app/frontend/node_modules/.vite/deps/react.js?v=1', MOUNTS)).toBeNull();
    expect(fileFromModuleUrl('', MOUNTS)).toBeNull();
  });
});

/** A Vite + react-refresh transformed module: code, then the HMR trailer. */
function refreshModule(code: string): string {
  return (
    'import * as RefreshRuntime from "/@react-refresh";\n' +
    'const inWebWorker = false;\nlet prevRefreshReg;\nif (import.meta.hot && !inWebWorker) {\n  prevRefreshReg = window.$RefreshReg$;\n}\n' +
    code +
    '\nif (import.meta.hot && !inWebWorker) {\n  window.$RefreshReg$ = prevRefreshReg;\n}\n' +
    'if (import.meta.hot && !inWebWorker) {\n  RefreshRuntime.__hmr_import(import.meta.url).then((currentExports) => {\n    import.meta.hot.accept((nextExports) => {});\n  });\n}\n'
  );
}

function fn(name: string, start: number, end: number, count: number) {
  return { functionName: name, ranges: [{ startOffset: start, endOffset: end, count }] };
}

describe('exercisedFiles', () => {
  const url = (f: string) => `http://localhost:61000/@fs/app/frontend/${f}`;

  it('counts a module whose own functions ran, ignoring the top level and the HMR trailer', () => {
    const src = refreshModule('function Chip() { return 1; }\nexport default Chip;');
    const componentStart = src.indexOf('function Chip');
    const trailerThen = src.indexOf('(currentExports)');
    const scripts: CoverageScript[] = [
      {
        url: url('src/Chip.tsx'),
        functions: [fn('', 0, src.length, 1), fn('Chip', componentStart, componentStart + 30, 3), fn('', trailerThen, trailerThen + 40, 1)],
      },
    ];
    expect([...exercisedFiles(scripts, new Map([[url('src/Chip.tsx'), src]]), MOUNTS)]).toEqual(['frontend/src/Chip.tsx']);
  });

  it('does not count a module that was only loaded (component never rendered)', () => {
    const src = refreshModule('function Chip() { return 1; }\nexport default Chip;');
    const componentStart = src.indexOf('function Chip');
    const trailerThen = src.indexOf('(currentExports)');
    const scripts: CoverageScript[] = [
      {
        url: url('src/Chip.tsx'),
        functions: [fn('', 0, src.length, 1), fn('Chip', componentStart, componentStart + 30, 0), fn('', trailerThen, trailerThen + 40, 1)],
      },
    ];
    expect(exercisedFiles(scripts, new Map([[url('src/Chip.tsx'), src]]), MOUNTS).size).toBe(0);
  });

  it('counts anonymous functions in the module body (e.g. styled() style callbacks)', () => {
    const src = refreshModule('export const Box = styled("div")(({ theme }) => ({ padding: 1 }));');
    const arrow = src.indexOf('({ theme })');
    const scripts: CoverageScript[] = [{ url: url('src/styles.ts'), functions: [fn('', 0, src.length, 1), fn('', arrow, arrow + 30, 2)] }];
    expect([...exercisedFiles(scripts, new Map([[url('src/styles.ts'), src]]), MOUNTS)]).toEqual(['frontend/src/styles.ts']);
  });

  it('counts a function-free (data-only) module as exercised when it is loaded', () => {
    const src = 'export const COLORS = { a: 1 };\n';
    const scripts: CoverageScript[] = [{ url: url('src/constants.ts'), functions: [fn('', 0, src.length, 1)] }];
    expect([...exercisedFiles(scripts, new Map([[url('src/constants.ts'), src]]), MOUNTS)]).toEqual(['frontend/src/constants.ts']);
  });

  it('works without a source (no trailer detection) and skips unknown URLs', () => {
    const scripts: CoverageScript[] = [
      { url: url('src/a.ts'), functions: [fn('', 0, 100, 1), fn('helper', 10, 20, 1)] },
      { url: 'http://localhost:61000/src/ladle-internal.js', functions: [fn('', 0, 10, 1), fn('x', 1, 5, 1)] },
    ];
    expect([...exercisedFiles(scripts, new Map(), MOUNTS)]).toEqual(['frontend/src/a.ts']);
  });
});

describe('exercisedTargets (line-precise)', () => {
  const url = 'http://localhost:61000/@fs/app/frontend/src/Reactions.tsx';
  const file = 'frontend/src/Reactions.tsx';
  // Generated lines 1-3 map to original lines 1, 5, 10, 15.
  const map = btoa(JSON.stringify({ version: 3, sources: ['Reactions.tsx'], mappings: 'AAAA;AAIA;AAKA;AAKA' }));
  const src = [
    'import x from "y";',
    'function Reactions() { return 1; }',
    'function Chip() { return 2; }',
    'export { Reactions, Chip };',
    `//# sourceMappingURL=data:application/json;base64,${map}`,
  ].join('\n');
  const at = (needle: string) => src.indexOf(needle);
  const script = (reactions: number, chip: number): CoverageScript => ({
    url,
    functions: [
      fn('', 0, src.length, 1),
      fn('Reactions', at('function Reactions'), at('function Chip') - 1, reactions),
      fn('Chip', at('function Chip'), at('export') - 1, chip),
    ],
  });
  const run = (s: CoverageScript, lines: number[] | 'all') =>
    [...exercisedTargets([s], new Map([[url, src]]), new Map([[file, lines]]), MOUNTS)];

  it('hits when the function containing the changed line ran', () => {
    expect(run(script(1, 3), [10])).toEqual([file]);
  });

  it('misses when only another function of the same module ran', () => {
    expect(run(script(1, 0), [10])).toEqual([]);
  });

  it('counts a change outside every function when some function of the module ran', () => {
    expect(run(script(1, 0), [15])).toEqual([file]);
    expect(run(script(0, 0), [15])).toEqual([]);
  });

  it('uses the module-level rule for whole-file targets and when there is no source map', () => {
    expect(run(script(0, 1), 'all')).toEqual([file]);
    expect([...exercisedTargets([script(1, 0)], new Map([[url, 'no map here']]), new Map([[file, [10]]]), MOUNTS)]).toEqual([file]);
  });

  it('ignores scripts that are not targets', () => {
    expect([...exercisedTargets([script(1, 1)], new Map([[url, src]]), new Map([['frontend/src/Other.tsx', [1]]]), MOUNTS)]).toEqual([]);
  });
});

describe('exercisedTargets — top-level changes and importers', () => {
  const u = (f: string) => `http://localhost:61000/@fs/app/frontend/${f}`;
  const CONSTANTS = 'frontend/src/utils/breakpoints.ts';
  const BARREL = 'frontend/src/utils/index.ts';
  const ITEM = 'frontend/src/components/ChannelItem.tsx';
  const OTHER = 'frontend/src/components/Other.tsx';

  // utils/breakpoints.ts as Vite serves it: constants + a helper, no react-refresh.
  // Generated lines 0-4 map to original lines 1, 2, 3, 5 (plus the arrow at col 28), 6.
  const constMap = btoa(JSON.stringify({ version: 3, sources: ['breakpoints.ts'], mappings: 'AAAA;AACA;AACA;AAEA,4BAAA4B;AACA' }));
  const constSrc = [
    'export const TOUCH_TARGETS = {',
    '    MINIMUM: 44',
    '};',
    'export const isStandalone = () => false;',
    'export const EDGE = 20;',
    `//# sourceMappingURL=data:application/json;base64,${constMap}`,
  ].join('\n');
  const helper = constSrc.indexOf('() => false');
  const constants = (helperRuns: number): CoverageScript => ({
    url: u('src/utils/breakpoints.ts'),
    functions: [fn('', 0, constSrc.length, 1), fn('isStandalone', helper, helper + 11, helperRuns)],
  });

  const component = (f: string, runs: number): CoverageScript => {
    const src = refreshModule('function Item() { return 1; }\nexport default Item;');
    const start = src.indexOf('function Item');
    const trailer = src.indexOf('(currentExports)');
    return { url: u(f.replace(/^frontend\//, '')), functions: [fn('', 0, src.length, 1), fn('Item', start, start + 30, runs), fn('', trailer, trailer + 40, 1)] };
  };
  const componentSources = (...files: string[]) =>
    files.map((f) => [u(f.replace(/^frontend\//, '')), refreshModule('function Item() { return 1; }\nexport default Item;')] as [string, string]);
  const barrel: CoverageScript = { url: u('src/utils/index.ts'), functions: [fn('', 0, 50, 1)] };

  const run = (scripts: CoverageScript[], lines: number[] | 'all', importers: Record<string, string[]>) =>
    [
      ...exercisedTargets(
        scripts,
        new Map([[u('src/utils/breakpoints.ts'), constSrc], [u('src/utils/index.ts'), 'export * from "./breakpoints";'], ...componentSources(ITEM, OTHER)]),
        new Map([[CONSTANTS, lines]]),
        MOUNTS,
        new Map(Object.entries(importers)),
      ),
    ];

  it('counts a changed constant where a module importing it rendered, though none of its own helpers ran', () => {
    // Regression: TOUCH_TARGETS.MINIMUM 44 -> 64 dropped every story whose only
    // use of breakpoints.ts was reading the constant (helpers never ran).
    expect(run([constants(0), component(ITEM, 2)], [2], { [CONSTANTS]: [ITEM] })).toEqual([CONSTANTS]);
  });

  it('walks up through function-free barrels to the code that reads the constant', () => {
    expect(run([constants(0), barrel, component(ITEM, 1)], [2], { [CONSTANTS]: [BARREL], [BARREL]: [ITEM] })).toEqual([CONSTANTS]);
  });

  it('does not count importers that are loaded but did not run, or not loaded at all', () => {
    expect(run([constants(0), component(ITEM, 0)], [2], { [CONSTANTS]: [ITEM] })).toEqual([]);
    expect(run([constants(0), component(OTHER, 3)], [2], { [CONSTANTS]: [ITEM] })).toEqual([]);
    expect(run([constants(0), component(ITEM, 2)], [2], {})).toEqual([]);
  });

  it('keeps changes inside a helper function precise: only that function running counts', () => {
    expect(run([constants(0), component(ITEM, 2)], [5], { [CONSTANTS]: [ITEM] })).toEqual([]);
    expect(run([constants(1), component(ITEM, 0)], [5], { [CONSTANTS]: [ITEM] })).toEqual([CONSTANTS]);
  });

  it('a change to both a helper and a constant counts either way', () => {
    expect(run([constants(0), component(ITEM, 1)], [2, 5], { [CONSTANTS]: [ITEM] })).toEqual([CONSTANTS]);
  });

  it('a new file (whole-file target) also counts where an importer ran', () => {
    expect(run([constants(0), component(ITEM, 1)], 'all', { [CONSTANTS]: [ITEM] })).toEqual([CONSTANTS]);
  });

  it('in a component module, a top-level change counts only when the module itself rendered', () => {
    const TARGET = 'frontend/src/components/Reactions.tsx';
    // Generated line 0 (after the refresh preamble) holds `const SIZE = 24;`, mapped to original line 3.
    const body = 'const SIZE = 24;\nfunction Chip() { return SIZE; }\nexport default Chip;';
    const src0 = refreshModule(body);
    const preamble = src0.slice(0, src0.indexOf('const SIZE')).split('\n').length - 1;
    const mapping = `${';'.repeat(preamble)}AAEA;AACA`;
    const src = `${src0}\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify({ version: 3, sources: ['Reactions.tsx'], mappings: mapping }))}`;
    const chip = src.indexOf('function Chip');
    const trailer = src.indexOf('(currentExports)');
    const reactions = (runs: number): CoverageScript => ({
      url: u('src/components/Reactions.tsx'),
      functions: [fn('', 0, src.length, 1), fn('Chip', chip, chip + 32, runs), fn('', trailer, trailer + 40, 1)],
    });
    const probe = (runs: number) =>
      [
        ...exercisedTargets(
          [reactions(runs), component(ITEM, 5)],
          new Map([[u('src/components/Reactions.tsx'), src], ...componentSources(ITEM)]),
          new Map([[TARGET, [3]]]),
          MOUNTS,
          new Map([[TARGET, [ITEM]]]),
        ),
      ];
    expect(probe(0)).toEqual([]); // the message list rendered, the reaction chips didn't
    expect(probe(1)).toEqual([TARGET]);
  });

  it('import lines alone do not widen a line-precise target', () => {
    // Generated line 0 is an import mapped to original line 1; line 1 a function (orig 2).
    const map = btoa(JSON.stringify({ version: 3, sources: ['x.ts'], mappings: 'AAAA;AACA' }));
    const src = ['import { a } from "/src/a.ts";', 'function f() { return a; }', 'export { f };', `//# sourceMappingURL=data:application/json;base64,${map}`].join('\n');
    const f = src.indexOf('function f');
    const target = 'frontend/src/utils/x.ts';
    const probe = (fRuns: number) =>
      [
        ...exercisedTargets(
          [{ url: u('src/utils/x.ts'), functions: [fn('', 0, src.length, 1), fn('f', f, f + 30, fRuns)] }, component(ITEM, 1)],
          new Map([[u('src/utils/x.ts'), src], ...componentSources(ITEM)]),
          new Map([[target, [1, 2]]]),
          MOUNTS,
          new Map([[target, [ITEM]]]),
        ),
      ];
    expect(probe(0)).toEqual([]);
    expect(probe(1)).toEqual([target]);
  });
});
