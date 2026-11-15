/**
 * Kit additions for the shell's dock: Dock `start`/`end` (fixed items around the scrolling region, its inset and edge
 * fade), IconButton `badge`/`badgeMeaning`/`current`, DockItem `unreadLabel`, and Stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { Dock, DockDivider, DockItem, IconButton, Stack, Text, useListFocus } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';
import { rawCssFor } from './cssRules';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const scroller = () => screen.getByRole('navigation').querySelector<HTMLElement>('[data-kit-dock-scroll]')!;

describe('Dock start and end', () => {
  it('puts start before and end after the scrolling region, outside it', () => {
    renderWithKit(
      <Dock label="d" start={<IconButton icon="Inbox" label="Inbox" />} end={<IconButton icon="LayoutGrid" label="All" />}>
        <DockItem name="A" />
        <DockItem name="B" />
      </Dock>,
    );
    const region = scroller();
    const inbox = screen.getByRole('button', { name: 'Inbox' });
    const all = screen.getByRole('button', { name: 'All' });
    expect(region).not.toContainElement(inbox);
    expect(region).not.toContainElement(all);
    expect(region).toContainElement(screen.getByRole('button', { name: 'A' }));
    const order = [...screen.getByRole('navigation').querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual(['Inbox', 'A', 'B', 'All']);
  });

  it('keeps an inset inside the scrolling region so a badge or dot at an edge is not clipped', () => {
    renderWithKit(
      <Dock label="d">
        <DockItem name="A" unread={3} />
      </Dock>,
    );
    expect(rawCssFor(scroller())).toMatch(/padding:\s*0 8px/);
  });

  it('fades only an edge with more beyond it, and follows the scroll', () => {
    const sizes = { scrollWidth: 600, clientWidth: 200 };
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => sizes.scrollWidth);
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => sizes.clientWidth);
    try {
      renderWithKit(
        <Dock label="d">
          {['a', 'b', 'c', 'd'].map((name) => (
            <DockItem key={name} name={name} />
          ))}
        </Dock>,
      );
      const region = scroller();
      const mask = () => /mask-image:\s*([^;]+)/.exec(rawCssFor(region))?.[1] ?? '';
      // At the start: the end fades, the start does not.
      expect(mask()).toMatch(/^linear-gradient\(to right, (?!transparent)/);
      expect(mask()).toMatch(/transparent 100%\)$/);
      act(() => {
        region.scrollLeft = 400;
        fireEvent.scroll(region);
      });
      expect(mask()).toMatch(/^linear-gradient\(to right, transparent 0/);
      expect(mask()).not.toMatch(/transparent 100%\)$/);
      sizes.scrollWidth = 200;
      act(() => {
        region.scrollLeft = 0;
        fireEvent.scroll(region);
      });
      expect(mask()).toBe('');
    } finally {
      scrollWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });

  it('as a keyboard list, the start and end items are stops of the one list, in visual order', async () => {
    function Bar() {
      const rows = ['inbox', 'a', 'b', 'all'].map((id) => ({ id, label: id, disabled: false }));
      const list = useListFocus({ rows, selected: 'a', orientation: 'horizontal' });
      return (
        <Dock
          label="d"
          focus={list.bar}
          start={<IconButton icon="Inbox" label="inbox" focus={list.rowFocus('inbox')} />}
          end={<IconButton icon="LayoutGrid" label="all" focus={list.rowFocus('all')} />}
        >
          <DockDivider />
          <DockItem name="a" current focus={list.rowFocus('a')} onClick={() => undefined} />
          <DockItem name="b" focus={list.rowFocus('b')} onClick={() => undefined} />
        </Dock>
      );
    }
    const { user } = renderWithKit(<Bar />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'a, current' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'inbox' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'all' })).toHaveFocus();
  });
});

describe('IconButton badge and current', () => {
  it('a badge shows the count over the corner and adds it to the name; 0 shows nothing', () => {
    const { rerender } = renderWithKit(<IconButton icon="Inbox" label="Inbox" badge={9} />);
    const button = screen.getByRole('button', { name: 'Inbox, 9 unread' });
    expect(button).toHaveTextContent('9');
    rerender(<IconButton icon="Inbox" label="Inbox" badge={0} />);
    expect(screen.getByRole('button', { name: 'Inbox' })).not.toHaveTextContent('0');
    rerender(<IconButton icon="Inbox" label="Inbox" badge={Number.NaN} />);
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('badgeMeaning words the count', () => {
    renderWithKit(<IconButton icon="AtSign" label="Mentions" badge={1} badgeMeaning="mentions" />);
    expect(screen.getByRole('button', { name: 'Mentions, 1 mention' })).toBeInTheDocument();
  });

  it('current draws the accent ring, says ", current" before the count and is the page', () => {
    renderWithKit(<IconButton icon="Inbox" label="Inbox" badge={2} current />);
    const button = screen.getByRole('button', { name: 'Inbox, current, 2 unread' });
    expect(button).toHaveAttribute('aria-current', 'page');
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(rawCssFor(button)).toMatch(/box-shadow:\s*0 0 0 2px [^,]+,\s*0 0 0 4px/);
  });

  it('without current: no ring, no aria-current', () => {
    renderWithKit(<IconButton icon="Inbox" label="Inbox" />);
    const button = screen.getByRole('button', { name: 'Inbox' });
    expect(button).not.toHaveAttribute('aria-current');
    expect(rawCssFor(button)).not.toMatch(/box-shadow:\s*0 0 0 2px/);
  });
});

describe('DockItem unreadLabel', () => {
  it('"mentions" words the count in the name and the badge; the default stays "unread"', () => {
    renderWithKit(
      <>
        <DockItem name="Lumen Studio" unread={2} unreadLabel="mentions" />
        <DockItem name="Friday LAN" unread={1} unreadLabel="mentions" />
        <DockItem name="Trailheads" unread={3} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Lumen Studio, 2 mentions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Friday LAN, 1 mention' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trailheads, 3 unread' })).toBeInTheDocument();
  });
});

describe('Stack', () => {
  it('lays its children in a column with the gap of the chosen space token', () => {
    const { container } = renderWithKit(
      <Stack gap="lg">
        <Text>One</Text>
        <Text>Two</Text>
      </Stack>,
    );
    const stack = container.firstElementChild as HTMLElement;
    const style = getComputedStyle(stack);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
    expect(style.gap).toBe('16px');
    expect(stack.children).toHaveLength(2);
  });
});
