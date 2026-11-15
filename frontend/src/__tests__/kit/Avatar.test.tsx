import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Avatar } from '../../kit';
import { contrastRatio, parseHex } from '../../theme/derive/oklch';
import { derivePalette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

/** `rgb(r, g, b)` as it is painted, to channels. */
function channels(value: string): [number, number, number] {
  const match = /rgb\((\d+), (\d+), (\d+)\)/.exec(value);
  if (match === null) {
    throw new Error(`not an rgb colour: ${value}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Avatar', () => {
  it('is an image named by the person', () => {
    renderWithKit(<Avatar name="aiko" />);
    expect(screen.getByRole('img', { name: 'aiko' })).toBeInTheDocument();
  });

  it('adds the presence to the accessible name', () => {
    renderWithKit(<Avatar name="aiko" presence="online" />);
    expect(screen.getByRole('img', { name: 'aiko, online' })).toBeInTheDocument();
  });

  it('names speaking too, and every presence is spelled out', () => {
    renderWithKit(
      <>
        <Avatar name="a" presence="away" />
        <Avatar name="b" presence="offline" />
        <Avatar name="c" presence="speaking" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'a, away' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'b, offline' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'c, speaking' })).toBeInTheDocument();
  });

  it('hides itself from assistive technology when decorative', () => {
    renderWithKit(<Avatar name="aiko" presence="online" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it.each([
    ['aiko', 'AI'],
    ['Samira Haddad', 'SH'],
    ['Ünal çelik', 'ÜÇ'],
    ['  mary   jane  watson ', 'MJ'],
    ['x', 'X'],
    ['日本語の名前', '日本'],
    ['🎉', '🎉'],
    ['👩‍👩‍👧 family', '👩‍👩‍👧F'],
  ])('shows the initials of %j as %j', (name, initials) => {
    renderWithKit(<Avatar name={name} />);
    expect(screen.getByText(initials)).toBeInTheDocument();
  });

  it.each([[''], ['   ']])('shows an icon, not letters, for the name %j', (name) => {
    const { container } = renderWithKit(<Avatar name={name} />);
    expect(container.querySelector('svg')).not.toBeNull();
    // Still named, so it is never an unlabelled image.
    expect(screen.getByRole('img', { name: /\S/ })).toBeInTheDocument();
  });

  it('draws an image over the initials and falls back to them when it fails', () => {
    const { container } = renderWithKit(<Avatar name="aiko" src="https://example.test/a.png" />);
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    // The initials are underneath already, so nothing shifts when the image goes.
    expect(screen.getByText('AI')).toBeInTheDocument();
    fireEvent.error(image as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('tries a new src after a failed one', () => {
    const { container, rerender } = renderWithKit(<Avatar name="aiko" src="https://example.test/a.png" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    rerender(<Avatar name="aiko" src="https://example.test/b.png" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.test/b.png');
  });

  it('marks each presence with its own shape, not only a colour', () => {
    const { container } = renderWithKit(
      <>
        <Avatar name="a" presence="online" />
        <Avatar name="b" presence="away" />
        <Avatar name="c" presence="offline" />
        <Avatar name="d" presence="speaking" />
        <Avatar name="e" />
      </>,
    );
    const dots = [...container.querySelectorAll('[data-presence]')];
    expect(dots.map((dot) => dot.getAttribute('data-presence'))).toEqual(['online', 'away', 'offline']);
    for (const dot of dots) {
      expect(dot).toHaveAttribute('aria-hidden', 'true');
    }
    // Only away has the bar across the dot.
    expect(dots.map((dot) => dot.querySelector('[data-presence-bar]') !== null)).toEqual([false, true, false]);
    const [online, , offline] = dots as HTMLElement[];
    // Offline is hollow: a ring in textDim around a ground-coloured centre; online is filled.
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    expect(getComputedStyle(online).backgroundColor).toBe(`rgb(${parseHex(palette.positive).join(', ')})`);
    expect(getComputedStyle(offline).backgroundColor).toBe(`rgb(${parseHex(palette.ground).join(', ')})`);
    expect(getComputedStyle(offline).borderColor).toBe(`rgb(${parseHex(palette.textDim).join(', ')})`);
  });

  it('sizes the away bar from tokens', () => {
    const { container } = renderWithKit(<Avatar name="b" presence="away" />);
    const bar = container.querySelector('[data-presence-bar]') as HTMLElement;
    expect(bar).toHaveStyle({ height: `${tokens.border.selected}px` });
    expect(bar).toHaveStyle({ width: `${tokens.space.md - 2 * tokens.border.selected}px` });
  });

  it('hides the initials once the image has loaded, and shows them before and after an error', () => {
    const { container } = renderWithKit(<Avatar name="aiko" src="https://example.test/a.png" />);
    const face = screen.getByText('AI');
    expect(getComputedStyle(face).color).not.toBe('rgba(0, 0, 0, 0)');
    const image = container.querySelector('img') as HTMLImageElement;
    fireEvent.load(image);
    expect(getComputedStyle(face).color).toBe('rgba(0, 0, 0, 0)');
  });

  it('shows the initials again when a loaded src is replaced by one that fails', () => {
    const { container, rerender } = renderWithKit(<Avatar name="aiko" src="https://example.test/a.png" />);
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    rerender(<Avatar name="aiko" src="https://example.test/b.png" />);
    expect(getComputedStyle(screen.getByText('AI')).color).not.toBe('rgba(0, 0, 0, 0)');
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(getComputedStyle(screen.getByText('AI')).color).not.toBe('rgba(0, 0, 0, 0)');
  });

  it('keeps the same box when the image fails', () => {
    const { container } = renderWithKit(<Avatar name="aiko" size="lg" src="https://example.test/a.png" />);
    const root = screen.getByRole('img', { name: 'aiko' });
    const box = () => ({ width: getComputedStyle(root).width, height: getComputedStyle(root).height });
    const before = box();
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(box()).toEqual(before);
    expect(before.width).toBe(`${tokens.avatar.lg}px`);
  });

  it.each([
    ['(mike)', 'MI'],
    ['@x', 'X'],
    ['ßa', 'ßA'],
    ['- Ana -', 'AN'],
    ['- Ana Bo', 'AB'],
  ])('skips leading symbols and keeps one grapheme per letter: %j gives %j', (name, initials) => {
    renderWithKit(<Avatar name={name} />);
    expect(screen.getByText(initials)).toBeInTheDocument();
  });

  it('keeps the neutral look when a Tinted palette cannot make the colour readable', () => {
    renderWithKit(<Avatar name="Zed" colour="#777777" />, { base: '#0d9488', intensity: 'vibrant' });
    const face = getComputedStyle(screen.getByText('ZE'));
    expect(contrastRatio(channels(face.color), channels(face.backgroundColor))).toBeGreaterThanOrEqual(4.5);
  });

  it('is sized from tokens.avatar', () => {
    renderWithKit(
      <>
        <Avatar name="a" size="xs" />
        <Avatar name="b" />
        <Avatar name="c" size="xl" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'a' })).toHaveStyle({ width: `${tokens.avatar.xs}px` });
    expect(screen.getByRole('img', { name: 'b' })).toHaveStyle({ width: `${tokens.avatar.md}px` });
    expect(screen.getByRole('img', { name: 'c' })).toHaveStyle({ height: `${tokens.avatar.xl}px` });
  });

  it('is round for people and rounded for communities', () => {
    renderWithKit(
      <>
        <Avatar name="a" />
        <Avatar name="b" shape="rounded" />
        <Avatar name="c" shape="rounded" size="xl" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'a' })).toHaveStyle({ borderRadius: `${tokens.radius.full}px` });
    expect(screen.getByRole('img', { name: 'b' })).toHaveStyle({ borderRadius: `${tokens.radius.md}px` });
    expect(screen.getByRole('img', { name: 'c' })).toHaveStyle({ borderRadius: `${tokens.radius.card}px` });
  });

  it('paints the person colour and the fill without one', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    renderWithKit(
      <>
        <Avatar name="aiko" colour="#FF8FB8" />
        <Avatar name="dropbear" />
      </>,
    );
    const [coloured] = channels(
      getComputedStyle(screen.getByText('AI')).backgroundColor.replace(/^rgba?/, 'rgb'),
    );
    expect(coloured).toBe(0xff);
    expect(getComputedStyle(screen.getByText('DR')).color).toBe(
      `rgb(${parseHex(palette.textSecondary).join(', ')})`,
    );
  });

  it.each([['dark'], ['light']] as const)(
    'keeps its initials readable on the painted colour in %s mode',
    (mode) => {
      const palette = derivePalette('#8E75FF', mode, 'minimal');
      for (const colour of ['#ffffff', '#000000', '#777777', '#808080', '#ff0000', '#FF8FB8', '#5FD49A', '#9AA0FF']) {
        const { unmount } = renderWithKit(<Avatar name="Zed" colour={colour} />, { mode });
        const face = getComputedStyle(screen.getByText('ZE'));
        const ink = channels(face.color);
        expect(contrastRatio(ink, channels(face.backgroundColor)), colour).toBeGreaterThanOrEqual(4.5);
        // Only ever one of the two palette roles, never a hard-coded colour.
        expect([parseHex(palette.ground).join(), parseHex(palette.text).join()]).toContain(ink.join());
        unmount();
      }
    },
  );

  it('paints a mid-grey (#777777) nudged, not as given', () => {
    renderWithKit(<Avatar name="Zed" colour="#777777" />);
    expect(getComputedStyle(screen.getByText('ZE')).backgroundColor).not.toBe('rgb(119, 119, 119)');
  });

  it('chooses opposite inks for white and black', () => {
    renderWithKit(
      <>
        <Avatar name="Wh" colour="#ffffff" />
        <Avatar name="Bl" colour="#000000" />
      </>,
    );
    expect(getComputedStyle(screen.getByText('WH')).color).not.toBe(
      getComputedStyle(screen.getByText('BL')).color,
    );
  });

  it('falls back to the no-colour look for a colour that is not #rrggbb', () => {
    renderWithKit(<Avatar name="aiko" colour="red" />);
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    expect(getComputedStyle(screen.getByText('AI')).color).toBe(
      `rgb(${parseHex(palette.textSecondary).join(', ')})`,
    );
  });

  it('is a closed prop set', () => {
    renderWithKit(
      // @ts-expect-error -- no escape hatches: sx and style are not props.
      <Avatar name="aiko" style={{ margin: 1 }} />,
    );
    expect(screen.getByRole('img', { name: 'aiko' })).toBeInTheDocument();
  });
});
