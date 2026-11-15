import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton, ListRow, useListFocus, type ListFocusOptions, type ListFocusRow } from '../../../../kit';
import { renderWithKit } from '../../../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  vi.useRealTimers();
});

const row = (id: string, label = id, disabled = false): ListFocusRow => ({ id, label, disabled });
const CHANNELS = [
  row('general', 'General'),
  row('games', 'Games'),
  row('archive', 'Archive', true),
  row('random', 'Random'),
];

interface ListProps extends Partial<Omit<ListFocusOptions, 'rows' | 'selected'>> {
  rows?: ListFocusRow[];
  selected?: string | null;
  /** Rows are links (`#id`) instead of buttons. */
  links?: boolean;
  /** Trailing Mute and More buttons: on every row, or on the rows named. */
  trailing?: boolean | string[];
  onRowClick?: (id: string) => void;
  /** Changing it remounts every row element (same ids, labels and disabled). */
  generation?: number;
}

function List({
  rows = CHANNELS,
  selected = null,
  links = false,
  trailing = false,
  onRowClick,
  generation = 0,
  ...options
}: ListProps) {
  const list = useListFocus({ rows, selected, ...options });
  return (
    <div role="list" aria-label="Channels" {...list.listProps}>
      <output data-testid="focused" hidden>
        {list.focused ?? ''}
      </output>
      {rows.map((item) => (
        <div role="listitem" key={`${item.id}-${generation}`}>
          <ListRow
            primary={item.label}
            disabled={item.disabled}
            selected={item.id === selected}
            focus={list.rowFocus(item.id)}
            {...(links ? { href: `#${item.id}` } : { onClick: () => onRowClick?.(item.id) })}
            trailing={
              trailing === true || (Array.isArray(trailing) && trailing.includes(item.id)) ? (
                <>
                  <IconButton icon="BellOff" label={`Mute ${item.label}`} onClick={() => {}} />
                  <IconButton icon="Ellipsis" label={`More for ${item.label}`} onClick={() => {}} />
                </>
              ) : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}

/** Keeps the selection in state, as a screen does with its route. */
function Controlled(props: ListProps & { initial?: string | null }) {
  const { initial = null, onSelect, ...rest } = props;
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <List
      {...rest}
      selected={selected}
      onSelect={(id) => {
        onSelect?.(id);
        setSelected(id);
      }}
    />
  );
}

const rowEl = (name: string): HTMLElement =>
  screen.queryByRole('button', { name }) ?? screen.getByRole('link', { name });
const active = () => document.activeElement;
const focus = (element: HTMLElement) => act(() => element.focus());

describe('useListFocus: the Tab stop', () => {
  it('is the selected row; every other row and the trailing controls are out of the Tab order', () => {
    renderWithKit(<List selected="games" trailing />);
    expect(rowEl('Games')).toHaveAttribute('tabindex', '0');
    expect(rowEl('General')).toHaveAttribute('tabindex', '-1');
    expect(rowEl('Random')).toHaveAttribute('tabindex', '-1');
    for (const control of screen.getAllByRole('button', { name: /^(Mute|More for) / })) {
      expect(control).toHaveAttribute('tabindex', '-1');
    }
  });

  it('is the first enabled row with no selection, a disabled selection, or one that names no row', () => {
    const rows = [row('archive', 'Archive', true), row('general', 'General'), row('random', 'Random')];
    for (const selected of [null, 'archive', 'missing']) {
      const { unmount } = renderWithKit(<List rows={rows} selected={selected} />);
      expect(rowEl('General')).toHaveAttribute('tabindex', '0');
      expect(rowEl('Random')).toHaveAttribute('tabindex', '-1');
      unmount();
    }
  });

  it('Tab enters on the selected row and the next Tab leaves the list', async () => {
    const { user } = renderWithKit(
      <>
        <button type="button">Before</button>
        <List selected="random" trailing />
        <button type="button">After</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(active()).toBe(rowEl('Random'));
    await user.tab();
    expect(active()).toBe(screen.getByRole('button', { name: 'After' }));
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('Random'));
  });

  it('with a selection, Tab comes back to the selected row after the user moved and left (focusOut)', async () => {
    const { user } = renderWithKit(
      <>
        <List selected="general" />
        <button type="button">After</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'After' }));
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    expect(rowEl('Games')).toHaveAttribute('tabindex', '0');
    expect(rowEl('General')).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(rowEl('General')).toHaveAttribute('tabindex', '0');
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('General'));
  });

  it('with no selection, Tab comes back to the last focused row', async () => {
    const { user } = renderWithKit(
      <>
        <List />
        <button type="button">After</button>
      </>,
    );
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    await user.tab();
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('Games'));
  });

  it('leaving, then a selection set from outside: Tab comes back to the newly selected row', async () => {
    const ui = (selected: string) => (
      <>
        <List selected={selected} />
        <button type="button">After</button>
      </>
    );
    const { user, rerender } = renderWithKit(ui('general'));
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    await user.tab();
    rerender(ui('random'));
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('Random'));
  });

  it('moving between rows or into a trailing control is not leaving the list', async () => {
    const { user } = renderWithKit(
      <>
        <List selected="general" trailing />
        <button type="button">After</button>
      </>,
    );
    const focused = () => screen.getByTestId('focused').textContent;
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('games');
    await user.keyboard('{ArrowRight}');
    expect(active()).toBe(screen.getByRole('button', { name: 'Mute Games' }));
    expect(focused()).toBe('games');
    await user.tab();
    // Out of the list: the focused row stays; the Tab stop shows where focus will enter (the selected row).
    expect(focused()).toBe('games');
    expect(rowEl('General')).toHaveAttribute('tabindex', '0');
    expect(rowEl('Games')).toHaveAttribute('tabindex', '-1');
  });
});

describe('useListFocus: keys', () => {
  it('Down and Up skip disabled rows and stop at the ends; the keys are taken (no page scroll)', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithKit(<List onSelect={onSelect} />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(rowEl('Games'));
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(rowEl('Random'));
    expect(fireEvent.keyDown(rowEl('Random'), { key: 'ArrowDown' })).toBe(false);
    expect(active()).toBe(rowEl('Random'));
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe(rowEl('Games'));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(active()).toBe(rowEl('General'));
    // Moving never selects in a list where selection does not follow focus.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('wraps round with wrap', async () => {
    const { user } = renderWithKit(<List wrap />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe(rowEl('Random'));
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(rowEl('General'));
  });

  it('Home and End go to the first and last enabled rows', async () => {
    const rows = [row('a', 'Alpha', true), row('b', 'Beta'), row('c', 'Gamma'), row('d', 'Delta', true)];
    const { user } = renderWithKit(<List rows={rows} />);
    focus(rowEl('Beta'));
    await user.keyboard('{End}');
    expect(active()).toBe(rowEl('Gamma'));
    await user.keyboard('{Home}');
    expect(active()).toBe(rowEl('Beta'));
  });

  it('vertical lists leave Left and Right alone without trailing controls; horizontal ones move on all four', async () => {
    const { unmount } = renderWithKit(<List />);
    focus(rowEl('General'));
    expect(fireEvent.keyDown(rowEl('General'), { key: 'ArrowRight' })).toBe(true);
    expect(active()).toBe(rowEl('General'));
    unmount();
    const second = renderWithKit(<List orientation="horizontal" />);
    focus(rowEl('General'));
    await second.user.keyboard('{ArrowRight}');
    expect(active()).toBe(rowEl('Games'));
    await second.user.keyboard('{ArrowDown}');
    expect(active()).toBe(rowEl('Random'));
    await second.user.keyboard('{ArrowLeft}');
    expect(active()).toBe(rowEl('Games'));
    await second.user.keyboard('{ArrowUp}');
    expect(active()).toBe(rowEl('General'));
  });

  it('ignores keys with Ctrl, Alt or Meta, and keys a control already handled', async () => {
    renderWithKit(<List />);
    focus(rowEl('General'));
    fireEvent.keyDown(rowEl('General'), { key: 'ArrowDown', ctrlKey: true });
    fireEvent.keyDown(rowEl('General'), { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(rowEl('General'), { key: 'ArrowDown', metaKey: true });
    expect(active()).toBe(rowEl('General'));
    const handled = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => {
      rowEl('General').dispatchEvent(handled);
    });
    expect(active()).toBe(rowEl('General'));
  });

  it('ignores keys from inside the list that are not on a row (a text field in the list)', () => {
    function WithField() {
      const list = useListFocus({ rows: [row('a', 'Alpha'), row('b', 'Beta')], selected: null });
      return (
        <div {...list.listProps}>
          <input aria-label="Filter" />
          <ListRow primary="Alpha" onClick={() => {}} focus={list.rowFocus('a')} />
          <ListRow primary="Beta" onClick={() => {}} focus={list.rowFocus('b')} />
        </div>
      );
    }
    renderWithKit(<WithField />);
    const field = screen.getByRole('textbox', { name: 'Filter' });
    focus(field);
    expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(field, { key: 'b' })).toBe(true);
    expect(active()).toBe(field);
  });
});

describe('useListFocus: activation', () => {
  it('Enter and Space choose the focused button row once each, through its own click', async () => {
    const onSelect = vi.fn();
    const onRowClick = vi.fn();
    const { user } = renderWithKit(<List onSelect={onSelect} onRowClick={onRowClick} />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect.mock.calls).toEqual([['games']]);
    expect(onRowClick.mock.calls).toEqual([['games']]);
    await user.keyboard(' ');
    expect(onSelect.mock.calls).toEqual([['games'], ['games']]);
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('a pointer click focuses and selects the row', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithKit(<List onSelect={onSelect} />);
    await user.click(rowEl('Random'));
    expect(onSelect.mock.calls).toEqual([['random']]);
    expect(active()).toBe(rowEl('Random'));
    expect(rowEl('Random')).toHaveAttribute('tabindex', '0');
  });

  it('a disabled row cannot be chosen', async () => {
    const onSelect = vi.fn();
    renderWithKit(<List onSelect={onSelect} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(rowEl('Archive'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selection follows focus when asked: every move selects', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithKit(<Controlled selectionFollowsFocus onSelect={onSelect} />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}{End}');
    expect(onSelect.mock.calls).toEqual([['games'], ['random']]);
    expect(rowEl('Random')).toHaveAttribute('aria-current', 'true');
  });

  describe('link rows', () => {
    // Bubble phase on the document, after React: a click on a link that gets here unprevented navigates.
    let navigated = 0;
    const listener = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]') && !event.defaultPrevented) navigated += 1;
    };
    beforeEach(() => {
      navigated = 0;
      document.addEventListener('click', listener);
    });
    afterEach(() => document.removeEventListener('click', listener));
    const countNavigations = () => ({ count: () => navigated });

    it('Enter follows the link once and selects it once', async () => {
      const navigations = countNavigations();
      const onSelect = vi.fn();
      const { user } = renderWithKit(<List links onSelect={onSelect} />);
      focus(rowEl('General'));
      await user.keyboard('{ArrowDown}{Enter}');
      expect(navigations.count()).toBe(1);
      expect(onSelect.mock.calls).toEqual([['games']]);
    });

    it('Space presses the link once instead of scrolling the page', async () => {
      const navigations = countNavigations();
      const onSelect = vi.fn();
      renderWithKit(<List links onSelect={onSelect} />);
      focus(rowEl('General'));
      expect(fireEvent.keyDown(rowEl('General'), { key: ' ' })).toBe(false);
      fireEvent.keyUp(rowEl('General'), { key: ' ' });
      // A held Space repeats keydown: no second press.
      expect(fireEvent.keyDown(rowEl('General'), { key: ' ', repeat: true })).toBe(false);
      expect(navigations.count()).toBe(1);
      expect(onSelect.mock.calls).toEqual([['general']]);
    });

    it('a pointer click follows the link once; a modified click is left to the browser', async () => {
      const navigations = countNavigations();
      const onSelect = vi.fn();
      const { user } = renderWithKit(<List links onSelect={onSelect} />);
      await user.click(rowEl('Random'));
      expect(navigations.count()).toBe(1);
      expect(onSelect.mock.calls).toEqual([['random']]);
      fireEvent.click(rowEl('Games'), { ctrlKey: true, detail: 1 });
      fireEvent.click(rowEl('Games'), { metaKey: true, detail: 1 });
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });
});

describe('useListFocus: typeahead', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  const setup = (ui: React.ReactElement) => renderWithKit(ui);
  // Keys on whatever has focus, as the keyboard sends them (user-event's own delays wait on real timers).
  const press = (keys: string) => {
    for (const key of keys) fireEvent.keyDown(document.activeElement as Element, { key });
  };

  it('jumps to the row that starts with the letters, which add up for 1000 ms', async () => {
    const rows = [row('general', 'General'), row('games', 'Games'), row('gchat', 'General chat'), row('random', 'Random')];
    setup(<List rows={rows} />);
    focus(rowEl('General'));
    press('r');
    expect(active()).toBe(rowEl('Random'));
    act(() => vi.advanceTimersByTime(999));
    // Still one word: "ra" is Random.
    press('a');
    expect(active()).toBe(rowEl('Random'));
    act(() => vi.advanceTimersByTime(1000));
    // The buffer emptied: "g" starts again, from the row after the focused one (round to General).
    press('g');
    expect(active()).toBe(rowEl('General'));
    press('a');
    expect(active()).toBe(rowEl('Games'));
  });

  it('restarts the 1000 ms on each letter', async () => {
    const rows = [row('alpha', 'Alpha'), row('also', 'Also'), row('beta', 'Beta')];
    setup(<List rows={rows} />);
    focus(rowEl('Alpha'));
    press('a');
    act(() => vi.advanceTimersByTime(600));
    press('l');
    act(() => vi.advanceTimersByTime(600));
    // 1200 ms after "a" but 600 after "l": "als" still adds up.
    press('s');
    expect(active()).toBe(rowEl('Also'));
  });

  it('Space while letters are pending is a letter: it does not press the row, on keydown or keyup', async () => {
    const rows = [row('general', 'General'), row('gchat', 'General chat')];
    const onSelect = vi.fn();
    const onRowClick = vi.fn();
    setup(<List rows={rows} onSelect={onSelect} onRowClick={onRowClick} />);
    focus(rowEl('General'));
    for (const key of 'general') fireEvent.keyDown(active() as Element, { key });
    expect(fireEvent.keyDown(rowEl('General'), { key: ' ' })).toBe(false);
    expect(fireEvent.keyUp(rowEl('General'), { key: ' ' })).toBe(false);
    fireEvent.keyDown(active() as Element, { key: 'c' });
    expect(active()).toBe(rowEl('General chat'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
    // After the timer, Space presses again.
    act(() => vi.advanceTimersByTime(1000));
    expect(fireEvent.keyUp(rowEl('General chat'), { key: ' ' })).toBe(true);
  });

  it('leaving the list drops the letters typed so far', () => {
    const rows = [row('general', 'General'), row('random', 'Random'), row('rgb', 'RGB')];
    setup(
      <>
        <List rows={rows} />
        <button type="button">After</button>
      </>,
    );
    focus(rowEl('General'));
    press('r');
    expect(active()).toBe(rowEl('Random'));
    focus(screen.getByRole('button', { name: 'After' }));
    focus(rowEl('Random'));
    // Fresh letters: "g" is General, not "rg" (no match, focus would stay on Random).
    press('g');
    expect(active()).toBe(rowEl('General'));
  });

  it('typeahead: false leaves letters alone', () => {
    setup(<List typeahead={false} />);
    focus(rowEl('General'));
    expect(fireEvent.keyDown(rowEl('General'), { key: 'r' })).toBe(true);
    expect(active()).toBe(rowEl('General'));
  });

  it('an unmounted list leaves no timer behind', () => {
    const { rerender } = setup(<List />);
    focus(rowEl('General'));
    act(() => vi.runOnlyPendingTimers());
    const before = vi.getTimerCount();
    press('r');
    act(() => vi.advanceTimersByTime(1));
    const during = vi.getTimerCount();
    rerender(<p>gone</p>);
    expect(during).toBe(before + 1);
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe('useListFocus: the selection set from outside', () => {
  it('a new selected prop moves the Tab stop, calls nothing back and leaves focus alone', async () => {
    const onSelect = vi.fn();
    const { rerender, user } = renderWithKit(
      <>
        <button type="button">Elsewhere</button>
        <List selected="general" onSelect={onSelect} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <List selected="random" onSelect={onSelect} />
      </>,
    );
    expect(rowEl('Random')).toHaveAttribute('tabindex', '0');
    expect(rowEl('General')).toHaveAttribute('tabindex', '-1');
    expect(active()).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
    await user.tab();
    expect(active()).toBe(rowEl('Random'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a change while a row has focus does not move focus', async () => {
    const { rerender, user } = renderWithKit(<List selected="general" />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    rerender(<List selected="random" />);
    expect(active()).toBe(rowEl('Games'));
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(rowEl('Random'));
  });

  it('a selected prop that names no row yet is taken when the row arrives', () => {
    const { rerender } = renderWithKit(<List rows={CHANNELS.slice(0, 2)} selected="random" />);
    expect(rowEl('General')).toHaveAttribute('tabindex', '0');
    rerender(<List rows={CHANNELS} selected="random" />);
    expect(rowEl('Random')).toHaveAttribute('tabindex', '0');
  });

  it('the selection set to null goes back to the first row as the stop', () => {
    const { rerender } = renderWithKit(<List selected="random" />);
    rerender(<List selected={null} />);
    expect(rowEl('General')).toHaveAttribute('tabindex', '0');
  });
});

describe('useListFocus: a row focused by other means (focusRow)', () => {
  it('a row focused from code is where the arrows start; nothing is chosen or revealed', async () => {
    const onSelect = vi.fn();
    const reveal = vi.fn();
    const { user } = renderWithKit(<List onSelect={onSelect} reveal={reveal} />);
    focus(rowEl('Games'));
    expect(rowEl('Games')).toHaveAttribute('tabindex', '0');
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(rowEl('Random'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(reveal.mock.calls).toEqual([['random']]);
  });

  it('a row focused from code never selects, also when selection follows focus', () => {
    const onSelect = vi.fn();
    renderWithKit(<Controlled selectionFollowsFocus onSelect={onSelect} />);
    focus(rowEl('Random'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('focused').textContent).toBe('random');
  });

  it('a click on a trailing control makes its row the focused row, without selecting (Down goes on from there)', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithKit(<List selected="general" trailing onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Mute Games' }));
    expect(screen.getByTestId('focused').textContent).toBe('games');
    expect(rowEl('Games')).toHaveAttribute('tabindex', '0');
    expect(rowEl('General')).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(rowEl('Random'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('entering by Tab lands on the Tab stop and chooses nothing; entering by a press on another row focuses that row only', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithKit(
      <>
        <button type="button">Before</button>
        <Controlled selectionFollowsFocus onSelect={onSelect} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(active()).toBe(rowEl('General'));
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Before' }));
    // Pointer down on Random: focus arrives there (focusIn, then focusRow); nothing is chosen until the click.
    await user.pointer({ keys: '[MouseLeft>]', target: rowEl('Random') });
    expect(active()).toBe(rowEl('Random'));
    expect(screen.getByTestId('focused').textContent).toBe('random');
    expect(onSelect).not.toHaveBeenCalled();
    await user.pointer({ keys: '[/MouseLeft]', target: rowEl('Random') });
    expect(onSelect.mock.calls).toEqual([['random']]);
  });
});

describe('useListFocus: rows that change', () => {
  it('a removed focused row hands focus to the next row, never to the body', async () => {
    const { rerender, user } = renderWithKit(<List />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    rerender(<List rows={CHANNELS.filter((item) => item.id !== 'games')} />);
    expect(active()).toBe(rowEl('Random'));
    // The last row goes: the previous one.
    rerender(<List rows={[row('general', 'General')]} />);
    expect(active()).toBe(rowEl('General'));
  });

  it('a focused row that becomes disabled hands focus on', async () => {
    const { rerender, user } = renderWithKit(<List />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    rerender(<List rows={CHANNELS.map((item) => (item.id === 'games' ? { ...item, disabled: true } : item))} />);
    expect(active()).toBe(rowEl('Random'));
  });

  it('reordered or added rows keep focus on the same row', async () => {
    const { rerender, user } = renderWithKit(<List />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    rerender(<List rows={[row('new', 'New'), ...[...CHANNELS].reverse()]} />);
    expect(active()).toBe(rowEl('Games'));
    await user.keyboard('{ArrowDown}');
    // Games is now after Archive (disabled) in reverse order: next is General.
    expect(active()).toBe(rowEl('General'));
  });

  it('rows that change while focus is elsewhere never take focus', async () => {
    const { rerender, user } = renderWithKit(
      <>
        <button type="button">Composer</button>
        <List />
      </>,
    );
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('button', { name: 'Composer' }));
    rerender(
      <>
        <button type="button">Composer</button>
        <List rows={CHANNELS.filter((item) => item.id !== 'games')} />
      </>,
    );
    expect(active()).toBe(screen.getByRole('button', { name: 'Composer' }));
    expect(rowEl('Random')).toHaveAttribute('tabindex', '0');
  });

  it('the selected row leaving the rows calls onDeselect', () => {
    const onDeselect = vi.fn();
    const { rerender } = renderWithKit(<List selected="games" onDeselect={onDeselect} />);
    rerender(<List selected="games" onDeselect={onDeselect} rows={CHANNELS.filter((item) => item.id !== 'games')} />);
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });
});

describe('useListFocus: trailing controls and reveal', () => {
  it('Right goes from the row into its trailing controls and Left back; Up and Down go on to the rows', async () => {
    const { user } = renderWithKit(<List trailing />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowRight}');
    expect(active()).toBe(screen.getByRole('button', { name: 'Mute General' }));
    await user.keyboard('{ArrowRight}');
    expect(active()).toBe(screen.getByRole('button', { name: 'More for General' }));
    // The end of the row: Right stays.
    await user.keyboard('{ArrowRight}');
    expect(active()).toBe(screen.getByRole('button', { name: 'More for General' }));
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(active()).toBe(rowEl('General'));
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(active()).toBe(rowEl('Games'));
  });

  it('Enter on a trailing control is that control, not the row', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithKit(<List trailing onSelect={onSelect} />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowRight}{Enter} ');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('reveal is called with the row before it is focused', async () => {
    const seen: Array<[string, Element | null]> = [];
    const reveal = (id: string) => seen.push([id, document.activeElement]);
    const { user } = renderWithKit(<List reveal={reveal} />);
    focus(rowEl('General'));
    await user.keyboard('{End}');
    expect(seen).toEqual([['random', rowEl('General')]]);
    expect(active()).toBe(rowEl('Random'));
  });

  it('a row that reveal renders later is focused once it is there', async () => {
    // A virtualised list: only the rows near the focus are rendered.
    function Windowed() {
      const rows = Array.from({ length: 50 }, (_, index) => row(`r${index}`, `Row ${index}`));
      const [shown, setShown] = useState<[number, number]>([0, 5]);
      const list = useListFocus({
        rows,
        selected: null,
        reveal: (id) => {
          const at = Number(id.slice(1));
          if (at < shown[0] || at >= shown[1]) setShown([Math.max(0, at - 4), at + 1]);
        },
      });
      return (
        <div {...list.listProps}>
          {rows.slice(shown[0], shown[1]).map((item) => (
            <ListRow key={item.id} primary={item.label} onClick={() => {}} focus={list.rowFocus(item.id)} />
          ))}
        </div>
      );
    }
    const { user } = renderWithKit(<Windowed />);
    focus(rowEl('Row 0'));
    await user.keyboard('{End}');
    expect(active()).toBe(rowEl('Row 49'));
  });
});

describe('useListFocus: where focus comes back (rule 6 on every entry)', () => {
  const ui = (props: ListProps) => (
    <>
      <List {...props} />
      <button type="button">After</button>
    </>
  );
  async function leaveFrom(user: ReturnType<typeof userEvent.setup>, start: string, moves: string) {
    focus(rowEl(start));
    if (moves) await user.keyboard(moves);
    await user.tab();
    expect(active()).toBe(screen.getByRole('button', { name: 'After' }));
  }

  it('no selection when leaving, one set while away: the stop and Tab go to it', async () => {
    const { user, rerender } = renderWithKit(ui({}));
    await leaveFrom(user, 'General', '{ArrowDown}');
    rerender(ui({ selected: 'random' }));
    expect(rowEl('Random')).toHaveAttribute('tabindex', '0');
    expect(rowEl('Games')).toHaveAttribute('tabindex', '-1');
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('Random'));
  });

  it('a selection cleared while away: back to the row focus left', async () => {
    const { user, rerender } = renderWithKit(ui({ selected: 'general' }));
    await leaveFrom(user, 'General', '{ArrowDown}');
    expect(rowEl('General')).toHaveAttribute('tabindex', '0');
    rerender(ui({ selected: null }));
    expect(rowEl('Games')).toHaveAttribute('tabindex', '0');
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('Games'));
  });

  it('the selected row removed or disabled while away: back to the row focus left', async () => {
    const { user, rerender } = renderWithKit(ui({ selected: 'random' }));
    await leaveFrom(user, 'Games', '');
    rerender(ui({ selected: 'random', rows: CHANNELS.filter((item) => item.id !== 'random') }));
    expect(rowEl('Games')).toHaveAttribute('tabindex', '0');
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('Games'));
    await user.tab();
    rerender(ui({ selected: 'random', rows: CHANNELS.map((item) => (item.id === 'random' ? { ...item, disabled: true } : item)) }));
    await user.tab({ shift: true });
    expect(active()).toBe(rowEl('Games'));
  });
});

describe('useListFocus: focus never falls to the page', () => {
  it('a focused trailing control that goes away hands focus to its row', async () => {
    const { user, rerender } = renderWithKit(<List trailing={['games']} />);
    await user.click(screen.getByRole('button', { name: 'Mute Games' }));
    rerender(<List trailing={[]} />);
    expect(active()).toBe(rowEl('Games'));
  });

  it('a trailing control that unmounts through its own state (no list render) hands focus to its row', async () => {
    function MarkRead({ label }: { label: string }) {
      const [read, setRead] = useState(false);
      return read ? null : <IconButton icon="Check" label={`Mark ${label} read`} onClick={() => setRead(true)} />;
    }
    function Self() {
      const list = useListFocus({ rows: CHANNELS, selected: null });
      return (
        <div {...list.listProps}>
          {CHANNELS.map((item) => (
            <ListRow
              key={item.id}
              primary={item.label}
              onClick={() => {}}
              disabled={item.disabled}
              focus={list.rowFocus(item.id)}
              trailing={<MarkRead label={item.label} />}
            />
          ))}
        </div>
      );
    }
    const { user } = renderWithKit(<Self />);
    await user.click(screen.getByRole('button', { name: 'Mark Games read' }));
    // The MutationObserver runs after the commit.
    await act(async () => {});
    expect(active()).toBe(rowEl('Games'));
  });

  it('a focused row element replaced with the same id, label and state keeps the focus on that row', async () => {
    const { user, rerender } = renderWithKit(<List />);
    focus(rowEl('General'));
    await user.keyboard('{ArrowDown}');
    rerender(<List generation={1} />);
    expect(active()).toBe(rowEl('Games'));
  });

  it('after focus left to the page background, a removed row never takes focus back', async () => {
    const { rerender } = renderWithKit(<List />);
    focus(rowEl('Games'));
    act(() => rowEl('Games').blur());
    await act(async () => {});
    rerender(<List rows={CHANNELS.filter((item) => item.id !== 'games')} />);
    expect(active()).toBe(document.body);
  });
});

describe('useListFocus: keys, review fixes', () => {
  it('Space on a trailing control while letters are pending is that control', () => {
    vi.useFakeTimers();
    renderWithKit(<List trailing />);
    focus(rowEl('General'));
    fireEvent.keyDown(rowEl('General'), { key: 'g' });
    const mute = screen.getByRole('button', { name: 'Mute General' });
    focus(mute);
    expect(fireEvent.keyDown(mute, { key: ' ' })).toBe(true);
    expect(active()).toBe(mute);
  });

  it('a held Enter or Space chooses once', () => {
    const onSelect = vi.fn();
    renderWithKit(<List onSelect={onSelect} />);
    focus(rowEl('General'));
    expect(fireEvent.keyDown(rowEl('General'), { key: 'Enter', repeat: true })).toBe(false);
    expect(fireEvent.keyDown(rowEl('General'), { key: ' ', repeat: true })).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('AltGr letters type; a key composing text is left to the IME', () => {
    const rows = [row('a', 'Alpha'), row('l', 'łódź')];
    renderWithKit(<List rows={rows} />);
    focus(rowEl('Alpha'));
    const altGr = new KeyboardEvent('keydown', { key: 'ł', ctrlKey: true, altKey: true, modifierAltGraph: true, bubbles: true, cancelable: true } as KeyboardEventInit);
    act(() => {
      rowEl('Alpha').dispatchEvent(altGr);
    });
    expect(active()).toBe(rowEl('łódź'));
    focus(rowEl('Alpha'));
    expect(fireEvent.keyDown(rowEl('Alpha'), { key: 'ArrowDown', isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(rowEl('Alpha'), { key: 'ArrowDown', keyCode: 229 })).toBe(true);
    expect(active()).toBe(rowEl('Alpha'));
  });

  it('leaving the list forgets a swallowed Space keyup', () => {
    vi.useFakeTimers();
    renderWithKit(
      <>
        <List />
        <button type="button">After</button>
      </>,
    );
    focus(rowEl('General'));
    fireEvent.keyDown(rowEl('General'), { key: 'g' });
    fireEvent.keyDown(rowEl('General'), { key: ' ' });
    focus(screen.getByRole('button', { name: 'After' }));
    focus(rowEl('General'));
    expect(fireEvent.keyUp(rowEl('General'), { key: ' ' })).toBe(true);
  });

  it('a Ctrl- or Shift-click on a button row still chooses it', () => {
    const onSelect = vi.fn();
    renderWithKit(<List onSelect={onSelect} />);
    fireEvent.click(rowEl('Games'), { ctrlKey: true, detail: 1 });
    fireEvent.click(rowEl('Random'), { shiftKey: true, detail: 1 });
    expect(onSelect.mock.calls).toEqual([['games'], ['random']]);
  });

  it('a row that reveal renders two frames later is still focused', async () => {
    function Slow() {
      const rows = Array.from({ length: 30 }, (_, index) => row(`r${index}`, `Row ${index}`));
      const [want, setWant] = useState<number | null>(null);
      const [shown, setShown] = useState(5);
      // The virtualiser asks for one frame, then renders on the next.
      useEffect(() => {
        if (want !== null && want >= shown) setShown(want + 1);
      }, [want, shown]);
      const list = useListFocus({ rows, selected: null, reveal: (id) => setWant(Number(id.slice(1))) });
      return (
        <div {...list.listProps}>
          {rows.slice(0, shown).map((item) => (
            <ListRow key={item.id} primary={item.label} onClick={() => {}} focus={list.rowFocus(item.id)} />
          ))}
        </div>
      );
    }
    const { user } = renderWithKit(<Slow />);
    focus(rowEl('Row 0'));
    await user.keyboard('{End}');
    expect(active()).toBe(rowEl('Row 29'));
  });
});
