import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Pill } from '../../kit';
import { derivePalette } from '../../theme/derive/derivePalette';
import { parseHex } from '../../theme/derive/oklch';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

/** The pill itself: the text sits in a span inside it. */
const pillOf = (text: string) => screen.getByText(text).parentElement as HTMLElement;
const rgb = (hex: string) => `rgb(${parseHex(hex).join(', ')})`;

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Pill', () => {
  it('renders its text', () => {
    renderWithKit(<Pill>Live</Pill>);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('only takes a string', () => {
    renderWithKit(
      // @ts-expect-error -- children is a string.
      <Pill>{42}</Pill>,
    );
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('paints accent as the selected pill', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    renderWithKit(<Pill tone="accent">You are here</Pill>);
    const pill = pillOf('You are here');
    expect(pill).toHaveStyle({ background: rgb(palette.accent), color: rgb(palette.onAccent) });
  });

  it('paints neutral on fill with secondary text, and status tones as text colour', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    renderWithKit(
      <>
        <Pill>n</Pill>
        <Pill tone="danger">d</Pill>
        <Pill tone="positive">p</Pill>
        <Pill tone="warning">w</Pill>
      </>,
    );
    expect(pillOf('n')).toHaveStyle({ background: rgb(palette.fill), color: rgb(palette.textSecondary) });
    expect(pillOf('d')).toHaveStyle({ background: rgb(palette.fill), color: rgb(palette.danger) });
    expect(pillOf('p')).toHaveStyle({ color: rgb(palette.positive) });
    expect(pillOf('w')).toHaveStyle({ color: rgb(palette.warning) });
  });

  it('is 24 tall at md and 20 at sm', () => {
    renderWithKit(
      <>
        <Pill>md</Pill>
        <Pill size="sm">sm</Pill>
      </>,
    );
    expect(pillOf('md')).toHaveStyle({ height: `${tokens.icon.xl}px` });
    expect(pillOf('sm')).toHaveStyle({ height: `${tokens.icon.lg}px` });
  });

  it('adds one decorative element for a dot and one for an icon', () => {
    const { container } = renderWithKit(
      <>
        <Pill>plain</Pill>
        <Pill dot>dot</Pill>
        <Pill icon="Bell">icon</Pill>
      </>,
    );
    const [plain, dot, icon] = ['plain', 'dot', 'icon'].map(
      (text) => screen.getByText(text).parentElement as HTMLElement,
    );
    expect(plain.children).toHaveLength(1);
    expect(dot.children).toHaveLength(2);
    expect(icon.children).toHaveLength(2);
    expect(icon.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(dot.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
