import { it, expect } from 'vitest';
import { tokens, type TextStyleName } from '../../theme/generated/tokens';

it('carries the Lounge shape and layout values', () => {
  expect(tokens.radius).toEqual({ sm: 6, md: 10, field: 14, card: 18, island: 24, full: 9999 });
  expect(tokens.space['2xs']).toBe(2);
  expect(tokens.layout.leftColumn).toBe(288);
  expect(tokens.layout.dialogSm).toBe(400);
  expect(tokens.layout.dialogMd).toBe(560);
  expect(tokens.control.md).toBe(40);
});

it('carries the kit token groups', () => {
  expect(tokens.radius.sm).toBe(6);
  expect(tokens.icon).toEqual({ xs: 14, sm: 16, md: 18, lg: 20, xl: 24 });
  expect(tokens.avatar).toEqual({ xs: 20, sm: 28, md: 36, lg: 44, xl: 64 });
  expect(tokens.border).toEqual({ hairline: 1, selected: 2, focus: 2, focusOffset: 2 });
  expect(tokens.state).toEqual({ hover: 0.04, pressed: 0.08, hoverOnFill: 0.16, pressedOnFill: 0.24, disabled: 0.5 });
  expect(tokens.state.hover).toBe(0.04);
});

it('resolves text styles to real font families', () => {
  const names: TextStyleName[] = ['title', 'section', 'name', 'body', 'bodyStrong', 'meta', 'small', 'tag'];
  expect(Object.keys(tokens.text)).toEqual(names);
  expect(tokens.text.title).toEqual({ family: 'Bricolage Grotesque', size: 20, line: 26, weight: 700 });
  expect(tokens.shadow.overlay.css).toBe('0 24px 64px rgba(0, 0, 0, 0.6)');
  expect(tokens.shadow.overlay.alphaLight).toBe(0.18);
  expect(tokens.shadow.overlay.cssLight).toBe('0 24px 64px rgba(0, 0, 0, 0.18)');
  expect(tokens.shadow.island.cssLight).toBe('0 6px 24px rgba(0, 0, 0, 0.08)');
});
