import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Icon, IconButton, ListRow } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('ListRow', () => {
  it('with href is a link named by its primary line', () => {
    renderWithKit(<ListRow primary="general" href="/c/general" />);
    const link = screen.getByRole('link', { name: 'general' });
    expect(link).toHaveAttribute('href', '/c/general');
  });

  it('with onClick is a button that fires on click and on Enter', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<ListRow primary="general" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'general' });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('with neither is plain content: no button, no link', () => {
    renderWithKit(<ListRow primary="general" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('general')).toBeInTheDocument();
  });

  it('selected exposes aria-current: page for a link, true for a button', () => {
    const { rerender } = renderWithKit(<ListRow primary="a" href="/a" selected />);
    expect(screen.getByRole('link', { name: 'a' })).toHaveAttribute('aria-current', 'page');
    rerender(<ListRow primary="a" onClick={() => undefined} selected />);
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('aria-current', 'true');
  });

  it('is not current when not selected', () => {
    renderWithKit(<ListRow primary="a" href="/a" />);
    expect(screen.getByRole('link', { name: 'a' })).not.toHaveAttribute('aria-current');
  });

  it('disabled blocks activation of a button', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<ListRow primary="a" onClick={onClick} disabled />);
    await user.click(screen.getByRole('button', { name: 'a' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'a' })).toBeDisabled();
  });

  it('disabled link is not navigable', async () => {
    const { user } = renderWithKit(<ListRow primary="a" href="/a" disabled />);
    const link = screen.queryByRole('link', { name: 'a' });
    expect(link === null || !link.hasAttribute('href')).toBe(true);
    await user.tab();
    expect(screen.getByText('a').closest('a')).not.toBe(document.activeElement);
  });

  it('renders the secondary line, the leading and the trailing slot', () => {
    renderWithKit(
      <ListRow
        primary="aiko"
        secondary="Playing Hades"
        leading={<Icon name="Hash" label="channel" />}
        trailing={<IconButton icon="Ellipsis" label="More" />}
        href="/u/aiko"
      />,
    );
    expect(screen.getByText('Playing Hades')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'channel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('a trailing IconButton is a separate tab stop and does not trigger the row', async () => {
    const onRow = vi.fn();
    const onMore = vi.fn();
    const { user } = renderWithKit(
      <ListRow
        primary="aiko"
        onClick={onRow}
        trailing={<IconButton icon="Ellipsis" label="More" onClick={onMore} />}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'aiko' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    // Valid HTML: no interactive element inside another.
    expect(screen.getByRole('button', { name: 'aiko' }).querySelector('button, a')).toBeNull();
  });

  it('unread is heavier than read', () => {
    renderWithKit(
      <>
        <ListRow primary="read one" />
        <ListRow primary="unread one" unread />
      </>,
    );
    const read = Number(getComputedStyle(screen.getByText('read one')).fontWeight);
    const unread = Number(getComputedStyle(screen.getByText('unread one')).fontWeight);
    expect(unread).toBeGreaterThan(read);
  });

  it('forwards id and ref to the interactive element', () => {
    const ref = { current: null as HTMLElement | null };
    renderWithKit(<ListRow primary="a" onClick={() => undefined} id="row-a" ref={ref} />);
    expect(screen.getByRole('button', { name: 'a' })).toHaveAttribute('id', 'row-a');
    expect(ref.current).toBe(screen.getByRole('button', { name: 'a' }));
  });
});
