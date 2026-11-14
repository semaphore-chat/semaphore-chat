import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { interactiveStates } from '../../kit/theme/states';
import { mix } from '../../kit/theme/mix';
import { derivePalette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('interactiveStates', () => {
  const palette = derivePalette('#8E75FF', 'dark', 'minimal');
  const states = interactiveStates({
    palette,
    under: palette.fill,
    hover: tokens.state.hover,
    pressed: tokens.state.pressed,
  });

  it('tints hover over the surface underneath, inside a hover media query', () => {
    expect(states['@media (hover: hover)']['&:hover'].background).toBe(
      mix(palette.text, palette.fill, tokens.state.hover),
    );
    expect(states['@media (hover: hover)']['&:hover'].background).not.toBe(
      mix(palette.text, palette.fill, tokens.state.pressed),
    );
  });

  it('keeps pressed outside the hover media query, so a touch press still shows', () => {
    expect(states['&:active'].background).toBe(
      mix(palette.text, palette.fill, tokens.state.pressed),
    );
    expect(Object.keys(states)).toEqual(['@media (hover: hover)', '&:active', '&:focus-visible']);
  });

  it('outlines focus with the focus role and the border tokens', () => {
    expect(states['&:focus-visible']).toEqual({
      outline: `${tokens.border.focus}px solid ${palette.focus}`,
      outlineOffset: `${tokens.border.focusOffset}px`,
    });
  });

  it('mixes with the alphas it is given', () => {
    const tinted = interactiveStates({
      palette,
      under: palette.accent,
      hover: tokens.state.hoverOnFill,
      pressed: tokens.state.pressedOnFill,
    });
    expect(tinted['@media (hover: hover)']['&:hover'].background).toBe(
      mix(palette.text, palette.accent, tokens.state.hoverOnFill),
    );
    expect(tinted['&:active'].background).toBe(
      mix(palette.text, palette.accent, tokens.state.pressedOnFill),
    );
  });
});
