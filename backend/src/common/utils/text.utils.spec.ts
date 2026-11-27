import { flattenSpansToDisplayText } from './text.utils';

describe('flattenSpansToDisplayText', () => {
  it('joins span text with spaces', () => {
    expect(flattenSpansToDisplayText([{ text: 'a' }, { text: 'b' }])).toBe(
      'a b',
    );
  });

  it('drops bidi embeddings, overrides, isolates and marks', () => {
    expect(
      flattenSpansToDisplayText([{ text: 'a‮b‬' }, { text: '⁦c⁩‎‏؜d' }]),
    ).toBe('ab cd');
  });

  it('returns undefined when no text remains', () => {
    expect(flattenSpansToDisplayText([{ text: null }])).toBeUndefined();
  });
});
