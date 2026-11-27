import { describe, expect, it } from 'vitest';
import { cleanSegments, stripBidiOverrides, stripUnpairedBidi } from '../../kit/chat/messageSegments';

describe('bidi overrides in segments', () => {
  it('drops embeddings, overrides and isolates and keeps the plain marks', () => {
    const all = '‪‫‬‭‮⁦⁧⁨⁩';
    expect(stripBidiOverrides(`a${all}b‎c‏d؜e`)).toBe('ab‎c‏d؜e');
  });

  it('cleans text, code, code block and mention runs, and leaves links and emoji alone', () => {
    const out = cleanSegments([
      { type: 'text', text: 'x‮y', bold: true },
      { type: 'code', text: 'c‮d' },
      { type: 'codeBlock', text: 'b\u2066k\u2067m\u2069' },
      { type: 'mention', kind: 'user', text: '@a‮b' },
      { type: 'link', href: 'https://example.com/' },
      { type: 'emoji', name: 'e' },
    ]);
    expect(out).toEqual([
      { type: 'text', text: 'xy', bold: true },
      { type: 'code', text: 'cd' },
      { type: 'codeBlock', text: 'bk\u2067m\u2069' },
      { type: 'mention', kind: 'user', text: '@ab' },
      { type: 'link', href: 'https://example.com/' },
      { type: 'emoji', name: 'e' },
    ]);
  });
});

describe('stripUnpairedBidi', () => {
  it.each([
    ['keeps a balanced embedding', 'a‫b‬c', 'a‫b‬c'],
    ['keeps a balanced isolate', 'a⁧b⁩c', 'a⁧b⁩c'],
    ['drops an unclosed embedding', 'a‫b', 'ab'],
    ['drops an unclosed isolate', 'a⁦b', 'ab'],
    ['drops a stray PDF and a stray PDI', 'a‬b⁩c', 'abc'],
    ['always drops overrides, even balanced', 'a\u202Eb\u202Cc\u202Dd', 'abcd'],
    ['an isolate closes the embeddings opened inside it', 'a⁧b‪c⁩d', 'a⁧bc⁩d'],
    ['a PDF cannot close an embedding outside its isolate', 'a‫b⁧c‬d⁩e‬', 'a‫b⁧cd⁩e‬'],
    ['keeps the marks', 'a‎b‏c؜d', 'a‎b‏c؜d'],
  ])('%s', (_name, input, expected) => {
    expect(stripUnpairedBidi(input)).toBe(expected);
  });
});
