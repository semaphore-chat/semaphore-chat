import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Text } from '../../kit';
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

describe('Text', () => {
  it('renders the default element per variant', () => {
    renderWithKit(
      <>
        <Text variant="title">T</Text>
        <Text variant="section">S</Text>
        <Text>B</Text>
        <Text variant="meta">M</Text>
      </>,
    );
    expect(screen.getByText('T').tagName).toBe('H2');
    expect(screen.getByText('S').tagName).toBe('H3');
    expect(screen.getByText('B').tagName).toBe('SPAN');
    expect(screen.getByText('M').tagName).toBe('SPAN');
  });

  it('lets `as` win', () => {
    renderWithKit(
      <Text variant="title" as="p">
        Para
      </Text>,
    );
    expect(screen.getByText('Para').tagName).toBe('P');
  });

  it('paints the variant font, size, weight and line height', () => {
    renderWithKit(
      <>
        <Text variant="meta">Meta</Text>
        <Text variant="title">Title</Text>
      </>,
    );
    const meta = getComputedStyle(screen.getByText('Meta'));
    expect(meta.fontSize).toBe('13px');
    expect(meta.lineHeight).toBe('18px');
    const title = getComputedStyle(screen.getByText('Title'));
    expect(title.fontSize).toBe('20px');
    expect(title.fontWeight).toBe('700');
    expect(title.fontFamily).toContain('Bricolage Grotesque');
    expect(title.margin).toBe('0px');
  });

  it('maps tones to palette colours', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    renderWithKit(
      <>
        <Text>Default</Text>
        <Text tone="secondary">Secondary</Text>
        <Text tone="dim">Dim</Text>
        <Text tone="accent">Accent</Text>
        <Text tone="danger">Danger</Text>
      </>,
    );
    const colour = (name: string) => getComputedStyle(screen.getByText(name)).color;
    expect(colour('Default')).toBe(computed(palette.text));
    expect(colour('Secondary')).toBe(computed(palette.textSecondary));
    expect(colour('Dim')).toBe(computed(palette.textDim));
    expect(colour('Accent')).toBe(computed(palette.accentText));
    expect(colour('Danger')).toBe(computed(palette.danger));
  });

  it('truncates to one line with an ellipsis', () => {
    renderWithKit(<Text truncate>Long</Text>);
    const style = getComputedStyle(screen.getByText('Long'));
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
  });
});
