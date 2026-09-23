// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spliceBlock, extractBlock, START_MARKER, END_MARKER } from '../../../../scripts/ui-review/lib/body.ts';

const block = (text: string) => `${START_MARKER}\n${text}\n${END_MARKER}`;

describe('spliceBlock', () => {
  it('appends the block when the body has none, separated by a blank line', () => {
    expect(spliceBlock('## Summary\n\nDoes a thing.', block('A'))).toBe(`## Summary\n\nDoes a thing.\n\n${block('A')}\n`);
    expect(spliceBlock('Body ending in newline\n', block('A'))).toBe(`Body ending in newline\n\n${block('A')}\n`);
  });

  it('uses the block alone for an empty body', () => {
    expect(spliceBlock('', block('A'))).toBe(`${block('A')}\n`);
    expect(spliceBlock('   \n', block('A'))).toBe(`${block('A')}\n`);
  });

  it('replaces an existing block in place, preserving the surrounding bytes exactly', () => {
    const before = 'Intro\r\nwith CRLF\r\n\r\n';
    const after = '\r\n\r\n## Test plan\r\n- [x] it works\r\n🤖 footer';
    const body = `${before}${block('OLD\nstuff')}${after}`;
    expect(spliceBlock(body, block('NEW'))).toBe(`${before}${block('NEW')}${after}`);
  });

  it('is idempotent', () => {
    const once = spliceBlock('Body', block('X'));
    expect(spliceBlock(once, block('X'))).toBe(once);
    const twice = spliceBlock(spliceBlock(once, block('Y')), block('Y'));
    expect(twice).toBe(spliceBlock(once, block('Y')));
  });

  it('treats a start marker without an end marker as a truncated block running to the end', () => {
    expect(spliceBlock(`Keep me\n${START_MARKER}\nhalf a blo`, block('NEW'))).toBe(`Keep me\n${block('NEW')}`);
  });

  it('ignores a stray end marker before the start marker', () => {
    const body = `a ${END_MARKER} b\n${block('OLD')}\nc`;
    expect(spliceBlock(body, block('NEW'))).toBe(`a ${END_MARKER} b\n${block('NEW')}\nc`);
  });

  it('rejects a block without markers', () => {
    expect(() => spliceBlock('x', 'no markers')).toThrow(/markers/);
  });
});

describe('extractBlock', () => {
  it('returns the current block or null', () => {
    expect(extractBlock(`x\n${block('A')}\ny`)).toBe(block('A'));
    expect(extractBlock('nothing')).toBeNull();
  });
});
