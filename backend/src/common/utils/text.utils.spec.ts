import { flattenSpansToDisplayText } from './text.utils';

describe('flattenSpansToDisplayText', () => {
  it('joins span text with spaces', () => {
    expect(flattenSpansToDisplayText([{ text: 'a' }, { text: 'b' }])).toBe(
      'a b',
    );
  });

  it('keeps the stored text as is, bidi controls included (link previews read it)', () => {
    expect(flattenSpansToDisplayText([{ text: 'a\u202Eb' }])).toBe('a\u202Eb');
  });

  it('returns undefined when no text remains', () => {
    expect(flattenSpansToDisplayText([{ text: null }])).toBeUndefined();
  });
});
