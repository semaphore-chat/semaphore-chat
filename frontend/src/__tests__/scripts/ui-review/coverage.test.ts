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

  it('falls back to module level for changes outside every function', () => {
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
