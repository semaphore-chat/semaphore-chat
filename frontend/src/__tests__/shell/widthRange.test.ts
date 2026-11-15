/**
 * The eager shell's width reader agrees with the kit's: the same breakpoint
 * numbers as the tokens, and the same range at every width either side of them.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { tokens } from '../../theme/generated/tokens';
import { useWidthRange } from '../../kit/layout/breakpoints';
import { SHELL_BREAKPOINTS, useShellWidthRange } from '../../shell/widthRange';

/** matchMedia for plain `(min-width: Npx)` queries and the kit's `not all and (...)` forms. */
function stubWidth(width: number) {
  const evaluate = (query: string): boolean =>
    query
      .split(' and ')
      .map((part) => part.trim())
      .reduce((acc, part, index, parts) => {
        if (part === 'not all') return acc;
        const negated = parts[index - 1] === 'not all' || part.startsWith('(not ');
        const min = /min-width:\s*(\d+)px/.exec(part);
        const result = min ? width >= Number(min[1]) : false;
        return acc && (negated ? !result : result);
      }, true);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: evaluate(query),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('useShellWidthRange', () => {
  it('uses the breakpoint tokens', () => {
    expect(SHELL_BREAKPOINTS).toEqual({ phone: tokens.breakpoint.phone, docked: tokens.breakpoint.docked });
  });

  it.each([320, 599, 600, 768, 1199, 1200, 1440])('agrees with the kit at %d px', (width) => {
    stubWidth(width);
    const shell = renderHook(() => useShellWidthRange()).result.current;
    const kit = renderHook(() => useWidthRange()).result.current;
    expect(shell).toBe(kit);
    expect(shell).toBe(width < 600 ? 'phone' : width < 1200 ? 'compact' : 'wide');
  });
});
