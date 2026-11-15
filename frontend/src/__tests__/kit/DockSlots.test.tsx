/**
 * Kit additions for the shell's dock: Dock `start`/`end` (fixed items around the scrolling region, its inset and edge
 * fade), IconButton `badge`/`badgeMeaning`/`current`, DockItem `unreadLabel`, and Stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { Dock, DockDivider, DockItem, IconButton, Sheet, Stack, Text, useListFocus } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';
import { rawCssFor, rulesFor } from './cssRules';
import { derivePalette, type IntensityName, type ModeName } from '../../theme/derive/derivePalette';
import { contrastRatio, parseHex } from '../../theme/derive/oklch';

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

describe('Dock wheel', () => {
  function setup(sizes: { scrollWidth: number; clientWidth: number }) {
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => sizes.scrollWidth);
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => sizes.clientWidth);
    renderWithKit(
      <Dock label="d" start={<IconButton icon="Inbox" label="Inbox" />}>
        {['a', 'b', 'c', 'd'].map((name) => (
          <DockItem key={name} name={name} />
        ))}
      </Dock>,
    );
    return () => {
      scrollWidth.mockRestore();
      clientWidth.mockRestore();
    };
  }

  it('turns a vertical wheel into a sideways scroll while the middle overflows, and takes the event from the page', () => {
    const restore = setup({ scrollWidth: 600, clientWidth: 200 });
    try {
      const region = scroller();
      expect(fireEvent.wheel(region, { deltaY: 120 })).toBe(false);
      expect(region.scrollLeft).toBe(120);
      expect(fireEvent.wheel(region, { deltaY: -50 })).toBe(false);
      expect(region.scrollLeft).toBe(70);
      // Lines (a mouse wheel in some browsers) count as 16 px each
      fireEvent.wheel(region, { deltaY: 3, deltaMode: 1 });
      expect(region.scrollLeft).toBe(118);
    } finally {
      restore();
    }
  });

  it('lets the event through at the end it is moving to, for a sideways wheel, a pinch, and when nothing overflows', () => {
    const sizes = { scrollWidth: 600, clientWidth: 200 };
    const restore = setup(sizes);
    try {
      const region = scroller();
      // At the start, scrolling back: the page gets it
      expect(fireEvent.wheel(region, { deltaY: -40 })).toBe(true);
      region.scrollLeft = 400;
      // At the end, scrolling on: the page gets it
      expect(fireEvent.wheel(region, { deltaY: 40 })).toBe(true);
      expect(region.scrollLeft).toBe(400);
      // A trackpad's sideways part is the browser's own scroll
      expect(fireEvent.wheel(region, { deltaX: 30, deltaY: -10 })).toBe(true);
      // Ctrl + wheel is a zoom
      expect(fireEvent.wheel(region, { deltaY: -40, ctrlKey: true })).toBe(true);
      sizes.scrollWidth = 200;
      region.scrollLeft = 0;
      expect(fireEvent.wheel(region, { deltaY: 40 })).toBe(true);
      expect(region.scrollLeft).toBe(0);
    } finally {
      restore();
    }
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

describe('focus on a current item', () => {
  const focusOffset = (element: Element) =>
    rulesFor(element, ':focus-visible')
      .map((rule) => rule.style.outlineOffset)
      .filter(Boolean)
      .pop();

  it('IconButton: the focus ring is offset past the current ring (2 px gap + 2 px ring), then the focus offset', () => {
    renderWithKit(
      <>
        <IconButton icon="Inbox" label="current" current />
        <IconButton icon="Inbox" label="plain" />
      </>,
    );
    // The current ring's band reaches 4 px out; the outline starts at 6 px, so a 2 px surface gap separates them.
    expect(focusOffset(screen.getByRole('button', { name: 'current, current' }))).toBe('6px');
    expect(focusOffset(screen.getByRole('button', { name: 'plain' }))).toBe('2px');
  });

  it('DockItem: its ring is a border inside the item, so the usual outside offset already clears it', () => {
    renderWithKit(<DockItem name="Couch Co-op" current onClick={() => undefined} />);
    expect(focusOffset(screen.getByRole('button', { name: 'Couch Co-op, current' }))).toBe('2px');
  });

  it('the focus colour stands out (3:1) from the surface and the ground it sits on, on every palette', () => {
    const bases = ['#8E75FF', '#0d9488', '#FF9A6B', '#E0C060', '#6BC5E0', '#888888'];
    const modes: ModeName[] = ['dark', 'light'];
    const intensities: IntensityName[] = ['minimal', 'balanced', 'vibrant'];
    for (const base of bases)
      for (const mode of modes)
        for (const intensity of intensities) {
          const palette = derivePalette(base, mode, intensity);
          const label = `${base} ${mode} ${intensity}`;
          expect(contrastRatio(parseHex(palette.focus), parseHex(palette.surface)), label).toBeGreaterThanOrEqual(3);
          expect(contrastRatio(parseHex(palette.focus), parseHex(palette.ground)), label).toBeGreaterThanOrEqual(3);
        }
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

describe('Sheet top', () => {
  it('renders `top` between the title and the scrolling body, outside the body', async () => {
    renderWithKit(
      <Sheet open onClose={() => undefined} title="All communities" top={<Text>Fixed part</Text>}>
        <Text>Row one</Text>
      </Sheet>,
    );
    const fixed = await screen.findByText('Fixed part');
    const body = document.querySelector<HTMLElement>('[data-kit-sheet-body]')!;
    expect(body).toContainElement(screen.getByText('Row one'));
    expect(body).not.toContainElement(fixed);
    expect(fixed.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(body).overflowY).toBe('auto');
  });
});
