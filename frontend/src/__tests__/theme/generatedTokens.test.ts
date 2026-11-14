import { it, expect } from 'vitest';
import { tokens, type TextStyleName } from '../../theme/generated/tokens';

it('carries the Lounge shape and layout values', () => {
  expect(tokens.radius).toEqual({ field: 14, card: 18, island: 24, full: 9999 });
  expect(tokens.space['2xs']).toBe(2);
  expect(tokens.layout.leftColumn).toBe(288);
  expect(tokens.control.md).toBe(40);
});

it('resolves text styles to real font families', () => {
  const names: TextStyleName[] = ['title', 'section', 'name', 'body', 'bodyStrong', 'meta', 'small', 'tag'];
  expect(Object.keys(tokens.text)).toEqual(names);
  expect(tokens.text.title).toEqual({ family: 'Bricolage Grotesque', size: 20, line: 26, weight: 700 });
  expect(tokens.shadow.overlay.css).toBe('0 24px 64px rgba(0, 0, 0, 0.6)');
});
