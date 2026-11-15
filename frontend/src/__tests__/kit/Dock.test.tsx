import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Dock, DockDivider, DockItem, IconButton } from '../../kit';
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

describe('Dock', () => {
  it('is a navigation landmark named by label, holding its children', () => {
    renderWithKit(
      <Dock label="Pinned communities">
        <IconButton icon="Inbox" label="Inbox" />
        <DockDivider />
        <DockItem name="Couch Co-op" />
      </Dock>,
    );
    const nav = screen.getByRole('navigation', { name: 'Pinned communities' });
    expect(nav).toContainElement(screen.getByRole('button', { name: 'Inbox' }));
    expect(nav).toContainElement(screen.getByRole('button', { name: 'Couch Co-op' }));
  });

  it('DockDivider is hidden from the accessibility tree', () => {
    renderWithKit(
      <Dock label="d">
        <DockDivider />
      </Dock>,
    );
    expect(screen.getByRole('navigation').firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('scrolls sideways when it overflows, without a visible scrollbar', () => {
    renderWithKit(
      <Dock label="d">
        <DockItem name="A" />
      </Dock>,
    );
    const style = getComputedStyle(screen.getByRole('navigation'));
    expect(style.overflowX).toBe('auto');
  });

  it('scrolls the current item into view on mount and when it changes', () => {
    // jsdom has no layout: give the nav a viewport and the items positions, then check scrollLeft.
    const offsetLeft = vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      const label = this.getAttribute('aria-label') ?? '';
      return ({ a: 0, b: 200, c: 400, d: 600 } as Record<string, number>)[label[0]] ?? 0;
    });
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(44);
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    try {
      const tree = (current: string) => (
        <Dock label="d">
          {['a', 'b', 'c', 'd'].map((name) => (
            <DockItem key={name} name={name} current={name === current} />
          ))}
        </Dock>
      );
      const { rerender } = renderWithKit(tree('c'));
      const nav = screen.getByRole('navigation');
      // c sits at 400..444, the view is 100 wide: scrolled so c, plus the bar padding, ends at the view edge.
      expect(nav.scrollLeft).toBe(352);
      rerender(tree('a'));
      expect(nav.scrollLeft).toBe(0);
    } finally {
      offsetLeft.mockRestore();
      offsetWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });
});

describe('Dock on a phone', () => {
  it('bottomBar keeps the bar above the home indicator with a safe-area margin; without it there is none', () => {
    renderWithKit(
      <>
        <Dock label="bar" bottomBar>
          <DockItem name="A" />
        </Dock>
        <Dock label="plain">
          <DockItem name="B" />
        </Dock>
      </>,
    );
    // jsdom's parser drops a bare env() as a margin, so this reads the CSS source emotion wrote.
    const css = (name: string) => rawCssFor(screen.getByRole('navigation', { name }));
    expect(css('bar')).toMatch(/margin-bottom:\s*env\(safe-area-inset-bottom\)/);
    expect(css('plain')).not.toMatch(/safe-area-inset-bottom/);
  });

  it('leaves a scroll the user made alone when it re-renders with the same current item', () => {
    const offsetLeft = vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(0);
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(44);
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    try {
      const tree = (extra: string) => (
        <Dock label="d">
          <DockItem name="a" current />
          <DockItem name={extra} />
        </Dock>
      );
      const { rerender } = renderWithKit(tree('b'));
      const nav = screen.getByRole('navigation');
      nav.scrollLeft = 300;
      rerender(tree('c'));
      expect(nav.scrollLeft).toBe(300);
    } finally {
      offsetLeft.mockRestore();
      offsetWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });
});

describe('Dock resize', () => {
  it('centres the current item again when the bar changes size (a hidden bar, a rotation)', () => {
    let notify: () => void = () => undefined;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let width = 0;
    const offsetLeft = vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(400);
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(44);
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    try {
      renderWithKit(
        <Dock label="d">
          <DockItem name="a" current />
        </Dock>,
      );
      const nav = screen.getByRole('navigation');
      // First laid out at zero width: a browser clamps the scroll to 0; the bar becomes 100 wide later.
      nav.scrollLeft = 0;
      width = 100;
      notify();
      expect(nav.scrollLeft).toBe(352);
    } finally {
      vi.unstubAllGlobals();
      offsetLeft.mockRestore();
      offsetWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });
});

describe('DockItem', () => {
  it('is a button named by the community', () => {
    renderWithKit(<DockItem name="Couch Co-op" onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Couch Co-op' })).toBeInTheDocument();
  });

  it('current adds ", current" to the name and aria-current="page"', () => {
    renderWithKit(<DockItem name="Couch Co-op" current />);
    const item = screen.getByRole('button', { name: 'Couch Co-op, current' });
    expect(item).toHaveAttribute('aria-current', 'page');
  });

  it('a non-current item has no aria-current', () => {
    renderWithKit(<DockItem name="Couch Co-op" />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');
  });

  it('unread adds the count to the name and shows it', () => {
    renderWithKit(<DockItem name="Couch Co-op" unread={2} />);
    expect(screen.getByRole('button', { name: 'Couch Co-op, 2 unread' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeVisible();
  });

  it('unread of 0 shows no badge and adds nothing to the name', () => {
    renderWithKit(<DockItem name="Couch Co-op" unread={0} />);
    expect(screen.getByRole('button', { name: 'Couch Co-op' })).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('reconnecting adds ", reconnecting" to the name', () => {
    renderWithKit(<DockItem name="Friday LAN" status="reconnecting" />);
    expect(screen.getByRole('button', { name: 'Friday LAN, reconnecting' })).toBeInTheDocument();
  });

  it('carries everything the picture shows, in a fixed order', () => {
    renderWithKit(<DockItem name="Couch Co-op" current unread={3} status="reconnecting" />);
    expect(screen.getByRole('button', { name: 'Couch Co-op, current, 3 unread, reconnecting' })).toBeInTheDocument();
  });

  it('a reconnecting avatar is dimmed to the disabled opacity', () => {
    renderWithKit(<DockItem name="Friday LAN" status="reconnecting" />);
    const avatar = screen.getByRole('button').firstElementChild as HTMLElement;
    expect(getComputedStyle(avatar).opacity).toBe('0.5');
  });

  it('onClick fires from a click and from Enter', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<DockItem name="Couch Co-op" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('href renders a link', () => {
    renderWithKit(<DockItem name="Couch Co-op" href="/c/couch" />);
    expect(screen.getByRole('link', { name: 'Couch Co-op' })).toHaveAttribute('href', '/c/couch');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('current and not-current items have the same outer size', () => {
    renderWithKit(
      <>
        <DockItem name="here" current />
        <DockItem name="there" />
      </>,
    );
    const here = getComputedStyle(screen.getByRole('button', { name: 'here, current' }));
    const there = getComputedStyle(screen.getByRole('button', { name: 'there' }));
    expect(here.width).toBe(there.width);
    expect(here.height).toBe(there.height);
    expect(here.boxSizing).toBe('border-box');
    expect(there.boxSizing).toBe('border-box');
  });

  it('forwards a ref to the element', () => {
    const ref = { current: null as HTMLElement | null };
    renderWithKit(<DockItem name="Couch Co-op" ref={ref} />);
    expect(ref.current).toBe(screen.getByRole('button'));
  });

  it('a link item that is current has aria-current="page" and the composed name', () => {
    renderWithKit(<DockItem name="Couch Co-op" href="/c/couch" current unread={2} />);
    const link = screen.getByRole('link', { name: 'Couch Co-op, current, 2 unread' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveAttribute('href', '/c/couch');
  });

  it('an infinite unread count adds nothing to the name', () => {
    renderWithKit(<DockItem name="Couch Co-op" unread={Infinity} />);
    expect(screen.getByRole('button', { name: 'Couch Co-op' })).toBeInTheDocument();
  });

  it('the tooltip showing the name does not describe the item with its own name again', async () => {
    const matches = Element.prototype.matches;
    const spy = vi
      .spyOn(Element.prototype, 'matches')
      .mockImplementation(function (this: Element, selector: string) {
        return selector === ':focus-visible' ? this === document.activeElement : matches.call(this, selector);
      });
    try {
      const { user } = renderWithKit(<DockItem name="Couch Co-op" />);
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Couch Co-op');
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-describedby');
    } finally {
      spy.mockRestore();
    }
  });

  it('shows the name in a tooltip on keyboard focus', async () => {
    // jsdom's :focus-visible heuristic is unreliable after a click; this test needs keyboard focus.
    const matches = Element.prototype.matches;
    const spy = vi
      .spyOn(Element.prototype, 'matches')
      .mockImplementation(function (this: Element, selector: string) {
        return selector === ':focus-visible' ? this === document.activeElement : matches.call(this, selector);
      });
    try {
      const { user } = renderWithKit(<DockItem name="Couch Co-op" />);
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Couch Co-op');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <DockItem name="x" className="x" />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
