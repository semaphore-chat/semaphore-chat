// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SETTLE_MAX_MS } from '../../../../scripts/ui-review/lib/settle.ts';

// scripts/ux-shots.mjs keeps its own copy of the settle heuristic (it stays
// self-contained); its defaults must not drift from lib/settle.ts.
const uxShots = readFileSync(fileURLToPath(new URL('../../../../scripts/ux-shots.mjs', import.meta.url)), 'utf8');

describe('settle defaults', () => {
  it.each(['waitForDomQuiet', 'waitForSettled'])('ux-shots.mjs %s caps at SETTLE_MAX_MS', (fn) => {
    const match = uxShots.match(new RegExp(`function ${fn}\\([^)]*maxMs = ([\\d_]+)\\)`));
    expect(match, `${fn} signature not found in ux-shots.mjs`).not.toBeNull();
    expect(Number(match![1].replace(/_/g, ''))).toBe(SETTLE_MAX_MS);
  });
});
