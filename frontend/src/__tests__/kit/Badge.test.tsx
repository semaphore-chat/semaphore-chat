import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Badge } from '../../kit';
import { derivePalette } from '../../theme/derive/derivePalette';
import { parseHex } from '../../theme/derive/oklch';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Badge', () => {
  it('shows the count, named by the label', () => {
    renderWithKit(<Badge count={3} label="3 unread" />);
    expect(screen.getByRole('img', { name: '3 unread' })).toHaveTextContent('3');
  });

  it.each([[0], [-1], [Number.NaN], [undefined]])('renders nothing for a count of %s', (count) => {
    const { container } = renderWithKit(<Badge count={count} label="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [100000, '99+'],
    [Number.POSITIVE_INFINITY, '99+'],
  ])('shows %s as %s by default', (count, text) => {
    renderWithKit(<Badge count={count} label="unread" />);
    expect(screen.getByRole('img', { name: 'unread' })).toHaveTextContent(text);
  });

  it('caps at max with a plus sign', () => {
    const { rerender } = renderWithKit(<Badge count={10} max={9} label="unread" />);
    expect(screen.getByRole('img', { name: 'unread' })).toHaveTextContent('9+');
    rerender(<Badge count={9} max={9} label="unread" />);
    expect(screen.getByRole('img', { name: 'unread' })).toHaveTextContent('9');
    expect(screen.getByRole('img', { name: 'unread' })).not.toHaveTextContent('+');
  });

  it('falls back to 99 for an unusable max', () => {
    renderWithKit(<Badge count={150} max={Number.NaN} label="unread" />);
    expect(screen.getByRole('img', { name: 'unread' })).toHaveTextContent('99+');
  });

  it('is a dot with no text', () => {
    renderWithKit(<Badge dot label="New activity" />);
    const dot = screen.getByRole('img', { name: 'New activity' });
    expect(dot).toBeEmptyDOMElement();
    expect(dot).toHaveStyle({ width: `${tokens.space.sm}px`, height: `${tokens.space.sm}px` });
  });

  it('shows a dot even when the count is zero', () => {
    renderWithKit(<Badge dot count={0} label="New activity" />);
    expect(screen.getByRole('img', { name: 'New activity' })).toBeInTheDocument();
  });

  it('is danger by default and accent on request', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    renderWithKit(
      <>
        <Badge count={1} label="d" />
        <Badge count={1} tone="accent" label="a" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'd' })).toHaveStyle({ background: `rgb(${parseHex(palette.danger).join(', ')})` });
    expect(screen.getByRole('img', { name: 'a' })).toHaveStyle({ background: `rgb(${parseHex(palette.accent).join(', ')})` });
    expect(screen.getByRole('img', { name: 'a' })).toHaveStyle({
      height: `${tokens.icon.lg}px`,
      minWidth: `${tokens.icon.lg}px`,
    });
  });

  it('requires a label', () => {
    renderWithKit(
      // @ts-expect-error -- label is the accessible name and is required.
      <Badge count={2} />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
