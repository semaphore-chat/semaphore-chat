// @vitest-environment node
import { describe, it, expect } from 'vitest';
import settle from '../../../../scripts/ui-review/lib/settle.ts?raw';
import uxShots from '../../../../scripts/ux-shots.mjs?raw';

// scripts/ux-shots.mjs keeps its own copy of the settle heuristic in
// lib/settle.ts (it stays self-contained); its defaults must not drift.
// Both are read as text: importing settle.ts would pull playwright-core's
// types (and with them Node's timer typings) into the app's type-check.
const num = (s: string) => Number(s.replace(/_/g, ''));

describe('settle defaults', () => {
  const maxMs = settle.match(/export const SETTLE_MAX_MS = ([\d_]+);/);

  it('settle.ts defines SETTLE_MAX_MS and uses it as both defaults', () => {
    expect(maxMs).not.toBeNull();
    expect(settle).toMatch(/function waitForDomQuiet\([^)]*maxMs = SETTLE_MAX_MS\)/);
    expect(settle).toMatch(/function waitForSettled\([^)]*maxMs = SETTLE_MAX_MS\)/);
  });

  it.each(['waitForDomQuiet', 'waitForSettled'])('ux-shots.mjs %s caps at SETTLE_MAX_MS', (fn) => {
    const match = uxShots.match(new RegExp(`function ${fn}\\([^)]*maxMs = ([\\d_]+)\\)`));
    expect(match, `${fn} signature not found in ux-shots.mjs`).not.toBeNull();
    expect(num(match![1])).toBe(num(maxMs![1]));
  });
});
