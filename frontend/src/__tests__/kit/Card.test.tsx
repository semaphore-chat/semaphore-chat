import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Card } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const px = (value: string) => Number.parseFloat(value);

describe('Card', () => {
  it('plain renders no button or link', () => {
    renderWithKit(<Card>Squad Up</Card>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Squad Up')).toBeInTheDocument();
  });

  it('selected is announced with aria-current', () => {
    renderWithKit(
      <>
        <Card selected>here</Card>
        <Card>elsewhere</Card>
      </>,
    );
    expect(screen.getByText('here')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('elsewhere')).not.toHaveAttribute('aria-current');
  });

  it('with onClick is one button named by its text, fired on click and Enter', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<Card onClick={onClick}>Squad Up</Card>);
    const button = screen.getByRole('button', { name: 'Squad Up' });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('label names a clickable card instead of its content', () => {
    renderWithKit(
      <Card onClick={() => undefined} label="Join Squad Up">
        <span aria-hidden="true">icon</span>
      </Card>,
    );
    expect(screen.getByRole('button', { name: 'Join Squad Up' })).toBeInTheDocument();
  });

  it('with href is a link', () => {
    renderWithKit(<Card href="/rooms/squad">Squad Up</Card>);
    expect(screen.getByRole('link', { name: 'Squad Up' })).toHaveAttribute('href', '/rooms/squad');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a selected clickable card keeps aria-current on the button or link', () => {
    const { rerender } = renderWithKit(<Card onClick={() => undefined} selected>a</Card>);
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-current', 'true');
    rerender(<Card href="/a" selected>a</Card>);
    expect(screen.getByRole('link', { name: 'a' })).toHaveAttribute('aria-current', 'true');
  });

  it('selected and unselected cards have the same outer size: the border width is reserved', () => {
    renderWithKit(
      <>
        <Card selected>on</Card>
        <Card>off</Card>
        <Card onClick={() => undefined} selected>on button</Card>
        <Card onClick={() => undefined}>off button</Card>
      </>,
    );
    for (const [on, off] of [['on', 'off'], ['on button', 'off button']]) {
      const a = getComputedStyle(screen.getByText(on));
      const b = getComputedStyle(screen.getByText(off));
      expect(a.borderTopWidth).toBe(b.borderTopWidth);
      expect(px(a.borderTopWidth)).toBeGreaterThan(0);
      expect(a.paddingTop).toBe(b.paddingTop);
      expect(a.borderTopColor).not.toBe(b.borderTopColor);
    }
  });

  it('padding lg is larger than md', () => {
    renderWithKit(
      <>
        <Card padding="md">md</Card>
        <Card padding="lg">lg</Card>
      </>,
    );
    expect(px(getComputedStyle(screen.getByText('lg')).paddingTop)).toBeGreaterThan(
      px(getComputedStyle(screen.getByText('md')).paddingTop),
    );
  });

  it('forwards id', () => {
    renderWithKit(<Card id="room" onClick={() => undefined}>a</Card>);
    expect(screen.getByRole('button')).toHaveAttribute('id', 'room');
  });

  it('refuses both onClick and href at the type level', () => {
    // @ts-expect-error a card is a button or a link, never both
    renderWithKit(<Card onClick={() => undefined} href="/x">both</Card>);
    expect(screen.getByText('both')).toBeInTheDocument();
  });
});
