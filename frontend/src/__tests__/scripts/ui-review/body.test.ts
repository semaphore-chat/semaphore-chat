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

  it('refuses (instead of truncating) when a start marker line has no end marker line after it', () => {
    expect(() => spliceBlock(`Keep me\n${START_MARKER}\nhalf a blo\n\n## Test plan\n- [x] it works`, block('NEW'))).toThrow(/without a matching/);
  });

  it('ignores a stray end marker before the start marker', () => {
    const body = `a\n${END_MARKER}\nb\n${block('OLD')}\nc`;
    expect(spliceBlock(body, block('NEW'))).toBe(`a\n${END_MARKER}\nb\n${block('NEW')}\nc`);
  });

  // Regression: plain indexOf treated any mention of the markers as the block.
  it('ignores markers mentioned inline in the text', () => {
    const body = `Adds the \`${START_MARKER}\` marker handling.\n\n## Test plan\n- [x] manual check\n\n🤖 Generated with Claude Code\n`;
    expect(spliceBlock(body, block('NEW'))).toBe(`${body}\n${block('NEW')}\n`);
    const withBlock = `Mentions ${START_MARKER} here.\n\nUser text\n\n${block('OLD')}\n\nfooter`;
    expect(spliceBlock(withBlock, block('NEW'))).toBe(`Mentions ${START_MARKER} here.\n\nUser text\n\n${block('NEW')}\n\nfooter`);
  });

  it('ignores markers inside fenced code blocks (e.g. the docs snippet quoted in a description)', () => {
    const snippet = `To place it:\n\n\`\`\`markdown\n${START_MARKER}\n${END_MARKER}\n\`\`\`\n\n`;
    expect(spliceBlock(`${snippet}${block('OLD')}\nend`, block('NEW'))).toBe(`${snippet}${block('NEW')}\nend`);
    const tilde = `~~~\n${START_MARKER}\n~~~\n`;
    expect(spliceBlock(tilde, block('NEW'))).toBe(`${tilde}\n${block('NEW')}\n`);
  });

  it('accepts marker lines with CRLF endings or up to three spaces of indentation', () => {
    const body = `x\r\n  ${START_MARKER}\r\nold\r\n${END_MARKER}\r\ny`;
    expect(spliceBlock(body, block('NEW'))).toBe(`x\r\n  ${block('NEW')}\r\ny`);
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
