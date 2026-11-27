import { describe, expect, it } from 'vitest';
import { cleanSegments, stripBidiOverrides } from '../../kit/chat/messageSegments';

describe('bidi overrides in segments', () => {
  it('drops embeddings, overrides and isolates and keeps the plain marks', () => {
    const all = '‪‫‬‭‮⁦⁧⁨⁩';
    expect(stripBidiOverrides(`a${all}b‎c‏d؜e`)).toBe('ab‎c‏d؜e');
  });

  it('cleans text, code, code block and mention runs, and leaves links and emoji alone', () => {
    const out = cleanSegments([
      { type: 'text', text: 'x‮y', bold: true },
      { type: 'code', text: 'c‮d' },
      { type: 'codeBlock', text: 'b⁦k' },
      { type: 'mention', kind: 'user', text: '@a‮b' },
      { type: 'link', href: 'https://example.com/' },
      { type: 'emoji', name: 'e' },
    ]);
    expect(out).toEqual([
      { type: 'text', text: 'xy', bold: true },
      { type: 'code', text: 'cd' },
      { type: 'codeBlock', text: 'bk' },
      { type: 'mention', kind: 'user', text: '@ab' },
      { type: 'link', href: 'https://example.com/' },
      { type: 'emoji', name: 'e' },
    ]);
  });
});
