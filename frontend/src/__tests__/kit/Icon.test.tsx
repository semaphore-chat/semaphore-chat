import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Icon, iconNames, type IconTone } from '../../kit';
import { iconNodes } from '../../kit/icons/generated';
import { renderWithKit } from '../test-utils/renderWithKit';
import { derivePalette } from '../../theme/derive/derivePalette';

/** A colour the browser has normalised, so a hex and its painted rgb() compare equal. */
function computed(value: string): string {
  const probe = document.createElement('div');
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Icon', () => {
  it('sizes from tokens.icon: 18 at md, 24 at xl', () => {
    const { container } = renderWithKit(
      <>
        <Icon name="Mic" />
        <Icon name="Mic" size="xl" />
      </>,
    );
    const [md, xl] = Array.from(container.querySelectorAll('svg'));

    expect(md).toHaveAttribute('width', '18');
    expect(md).toHaveAttribute('height', '18');
    expect(xl).toHaveAttribute('width', '24');
    expect(xl).toHaveAttribute('height', '24');
  });

  it('draws the generated nodes for the name', () => {
    const { container } = renderWithKit(<Icon name="Mic" />);
    expect(container.querySelector('svg')?.children).toHaveLength(iconNodes.Mic.length);
  });

  it('strokes one 24-unit grid', () => {
    const { container } = renderWithKit(<Icon name="Mic" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('stroke-linecap', 'round');
    expect(svg).toHaveAttribute('stroke-linejoin', 'round');
  });

  it('is decoration when it has no label', () => {
    const { container } = renderWithKit(<Icon name="Mic" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('treats an empty or whitespace-only label as no label', () => {
    const { container } = renderWithKit(
      <>
        <Icon name="Mic" label="" />
        <Icon name="Mic" label="   " />
      </>,
    );

    for (const svg of Array.from(container.querySelectorAll('svg'))) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).not.toHaveAttribute('role');
      expect(svg).not.toHaveAttribute('aria-label');
    }
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('takes its accessible name from label', () => {
    renderWithKit(<Icon name="MicOff" label="Muted" />);
    const img = screen.getByRole('img', { name: 'Muted' });

    expect(img).toHaveAttribute('aria-label', 'Muted');
    expect(img).not.toHaveAttribute('aria-hidden');
  });

  it('maps tones to palette colours, and inherits the text colour by default', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    const tones: Record<Exclude<IconTone, 'inherit'>, string> = {
      default: palette.text,
      secondary: palette.textSecondary,
      dim: palette.textDim,
      accent: palette.accentText,
      danger: palette.danger,
      positive: palette.positive,
      warning: palette.warning,
    };
    renderWithKit(
      <>
        {(Object.keys(tones) as Array<keyof typeof tones>).map((tone) => (
          <Icon key={tone} name="Check" tone={tone} label={tone} />
        ))}
        <span style={{ color: computed(palette.accent) }}>
          <Icon name="Check" label="inherit" />
        </span>
      </>,
    );

    for (const [tone, colour] of Object.entries(tones)) {
      expect(getComputedStyle(screen.getByRole('img', { name: tone })).color).toBe(computed(colour));
    }
    expect(getComputedStyle(screen.getByRole('img', { name: 'inherit' })).color).toBe(
      computed(palette.accent),
    );
  });

  it('rejects names outside the generated set', () => {
    // The directive is the assertion: type-check fails if Icon ever accepts an
    // arbitrary string. Not rendered, so no unknown shape reaches the DOM.
    const unknown = (
      // @ts-expect-error -- IconProps.name is IconName, the generated set; "Nope" is not in it.
      <Icon name="Nope" />
    );

    expect(unknown.props.name).toBe('Nope');
    expect(iconNames).not.toContain('Nope');
  });

  it('renders every icon in the generated set', () => {
    const { container } = renderWithKit(
      <>
        {iconNames.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </>,
    );

    expect(container.querySelectorAll('svg')).toHaveLength(iconNames.length);
  });
});
