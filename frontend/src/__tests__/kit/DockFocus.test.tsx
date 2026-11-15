import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { Dock, DockDivider, DockItem, IconButton, useListFocus } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const NAMES = ['Couch Co-op', 'Trailheads', 'Lumen Studio', 'Wavelength'];

/** A Dock as one keyboard list: the Inbox button, links and buttons, and All. */
function FocusDock({ onPick = () => undefined }: { onPick?: (id: string) => void }) {
  const rows = ['inbox', ...NAMES, 'all'].map((id) => ({ id, label: id, disabled: false }));
  const list = useListFocus({ rows, selected: 'Trailheads', orientation: 'horizontal', onSelect: onPick });
  return (
    <>
      <button type="button">before</button>
      <Dock label="Communities" focus={list.bar}>
        <IconButton icon="Inbox" label="Inbox" focus={list.rowFocus('inbox')} />
        <DockDivider />
        {NAMES.map((name, index) =>
          index % 2 === 0 ? (
            <DockItem key={name} name={name} href={`#${name}`} focus={list.rowFocus(name)} />
          ) : (
            <DockItem key={name} name={name} onClick={() => undefined} current={name === 'Trailheads'} focus={list.rowFocus(name)} />
          ),
        )}
        <IconButton icon="LayoutGrid" label="All communities" focus={list.rowFocus('all')} />
      </Dock>
      <button type="button">after</button>
    </>
  );
}

describe('a Dock on the list focus host (K1)', () => {
  it('is one Tab stop, on the selected item', () => {
    renderWithKit(<FocusDock />);
    const items = [
      screen.getByRole('button', { name: 'Inbox' }),
      screen.getByRole('link', { name: 'Couch Co-op' }),
      screen.getByRole('button', { name: 'Trailheads, current' }),
      screen.getByRole('link', { name: 'Lumen Studio' }),
      screen.getByRole('button', { name: 'Wavelength' }),
      screen.getByRole('button', { name: 'All communities' }),
    ];
    expect(items.map((item) => item.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1', '-1', '-1']);
  });

  it('Tab enters on the selected item and leaves past the bar; arrows, Home and End move between all item kinds', async () => {
    const { user } = renderWithKit(<FocusDock />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Trailheads, current' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('link', { name: 'Lumen Studio' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('link', { name: 'Couch Co-op' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'All communities' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Inbox' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  it('a click chooses the item and still runs its own onClick', async () => {
    const picked: string[] = [];
    const clicked = vi.fn();
    function One() {
      const list = useListFocus({ rows: [{ id: 'a', label: 'a', disabled: false }], selected: null, onSelect: (id) => picked.push(id) });
      return (
        <Dock label="d" focus={list.bar}>
          <DockItem name="a" onClick={clicked} focus={list.rowFocus('a')} />
        </Dock>
      );
    }
    const { user } = renderWithKit(<One />);
    await user.click(screen.getByRole('button', { name: 'a' }));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(picked).toEqual(['a']);
  });

  it('without focus an item keeps the default tab order', () => {
    renderWithKit(
      <Dock label="d">
        <IconButton icon="Inbox" label="Inbox" />
        <DockItem name="A" onClick={() => undefined} />
        <DockItem name="B" href="#b" />
      </Dock>,
    );
    for (const element of screen.getAllByRole('button').concat(screen.getAllByRole('link'))) {
      // Every item stays a Tab stop of its own (MUI's button says tabindex 0 itself).
      expect(element.getAttribute('tabindex') ?? '0').toBe('0');
    }
  });
});

describe('DockItem newMessages (K2)', () => {
  const dot = (container: HTMLElement) => container.querySelector('[data-kit-new-messages]');

  it('adds ", new messages" to the name and shows a dot', () => {
    const { container } = renderWithKit(<DockItem name="Couch Co-op" newMessages />);
    expect(screen.getByRole('button', { name: 'Couch Co-op, new messages' })).toBeInTheDocument();
    expect(dot(container)).not.toBeNull();
    expect(dot(container)).toHaveAttribute('aria-hidden', 'true');
  });

  it('comes after current and before reconnecting in the name', () => {
    renderWithKit(<DockItem name="Couch Co-op" current newMessages status="reconnecting" />);
    expect(screen.getByRole('button', { name: 'Couch Co-op, current, new messages, reconnecting' })).toBeInTheDocument();
  });

  it('with a count the badge wins: no dot, and the name says the count only', () => {
    const { container } = renderWithKit(<DockItem name="Couch Co-op" newMessages unread={3} />);
    expect(dot(container)).toBeNull();
    expect(screen.getByRole('button', { name: 'Couch Co-op, 3 unread' })).toBeInTheDocument();
  });

  it('a count of 0 does not suppress it, and false shows nothing', () => {
    const zero = renderWithKit(<DockItem name="A" newMessages unread={0} />);
    expect(dot(zero.container)).not.toBeNull();
    zero.unmount();
    const none = renderWithKit(<DockItem name="B" newMessages={false} />);
    expect(dot(none.container)).toBeNull();
    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument();
  });
});

describe('Dock focus (the bar)', () => {
  it('the bar itself is not a Tab stop (Firefox makes a scrolling bar one)', () => {
    renderWithKit(<FocusDock />);
    expect(screen.getByRole('navigation', { name: 'Communities' })).toHaveAttribute('tabindex', '-1');
  });

  it('a Dock without focus has no tabindex of its own', () => {
    renderWithKit(<Dock label="d">{null}</Dock>);
    expect(screen.getByRole('navigation')).not.toHaveAttribute('tabindex');
  });
});

describe('IconButton focus with disabled and loading', () => {
  function Mixed({ onPick }: { onPick: (id: string) => void }) {
    const rows = [
      { id: 'a', label: 'A', disabled: false },
      { id: 'b', label: 'B', disabled: true },
      { id: 'c', label: 'C', disabled: false },
    ];
    const list = useListFocus({ rows, selected: 'a', orientation: 'horizontal', onSelect: onPick });
    return (
      <Dock label="d" focus={list.bar}>
        <IconButton icon="Inbox" label="A" focus={list.rowFocus('a')} />
        <IconButton icon="Inbox" label="B" disabled focus={list.rowFocus('b')} />
        <IconButton icon="Inbox" label="C" loading focus={list.rowFocus('c')} />
      </Dock>
    );
  }

  it('arrows skip a disabled button, and a disabled one is not a tab stop', async () => {
    const { user } = renderWithKit(<Mixed onPick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'B' })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'C' })).toHaveFocus();
  });

  it('a busy button keeps its place in the list but a click on it chooses nothing', async () => {
    const picked: string[] = [];
    const { user } = renderWithKit(<Mixed onPick={(id) => picked.push(id)} />);
    await user.click(screen.getByRole('button', { name: 'C' }));
    expect(picked).toEqual([]);
  });
});

describe('Dock bar props', () => {
  it('only the four list handlers reach the bar: the key handler works, nothing else is added', async () => {
    const { user } = renderWithKit(<FocusDock />);
    const nav = screen.getByRole('navigation', { name: 'Communities' });
    expect(nav.getAttributeNames().sort()).toEqual(['aria-label', 'class', 'tabindex']);
    await user.tab();
    await user.tab();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'All communities' })).toHaveFocus();
  });
});
