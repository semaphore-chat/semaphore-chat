import { stripBidiControls } from './bidi.utils';

describe('stripBidiControls', () => {
  it('drops embeddings, overrides, isolates and marks', () => {
    expect(stripBidiControls('a‮b‬c⁦d⁩e‎f‏g؜h')).toBe('abcdefgh');
  });

  it('leaves other text, right-to-left letters included, alone', () => {
    expect(stripBidiControls('مرحبا report.pdf')).toBe('مرحبا report.pdf');
  });
});
