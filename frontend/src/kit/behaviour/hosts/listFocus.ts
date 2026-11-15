import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type FocusEventHandler,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type MouseEvent,
} from 'react';
import {
  DEFAULT_PARAMS,
  initialListFocus,
  stepListFocus,
  type Event,
  type Params,
  type Row,
  type State,
} from '../listFocus';
import { useBehaviourHost } from './hostContext';
import { createMachine, type Machine } from './machine';
import type { TimerService } from './timers';

export type { Row as ListFocusRow } from '../listFocus';

export interface ListFocusOptions {
  /** The whole list, in display order (also rows a virtualised list has not rendered). Sent on every change. */
  rows: Row[];
  /** The screen's selection (the route, a `value` prop). An id that names no row counts as none. */
  selected: string | null;
  /** A row was chosen: Enter, Space, a click, or a focus move when selection follows focus. */
  onSelect?: (id: string) => void;
  /** The selected row left the rows. */
  onDeselect?: () => void;
  /** Which arrows move: Up and Down (`vertical`), or Left and Right plus Up and Down (`horizontal`). */
  orientation?: 'vertical' | 'horizontal';
  /** Down on the last row goes to the first, and Up on the first to the last. Default false. */
  wrap?: boolean;
  /** Every focus move by a key selects too (tabs). Default false. */
  selectionFollowsFocus?: boolean;
  /** Typing letters jumps to a row. Default true. */
  typeahead?: boolean;
  /** Called before a row is focused, so a virtualised list can render it. */
  reveal?: (id: string) => void;
}

/** What a row needs to join the list. Opaque: pass it to `ListRow`'s `focus` prop. */
export interface RowFocus {
  readonly __brand: 'RowFocus';
}

export interface ListFocus {
  /** Spread on the element that holds the rows. */
  listProps: {
    onKeyDown: KeyboardEventHandler<HTMLElement>;
    onKeyUp: KeyboardEventHandler<HTMLElement>;
    onFocus: FocusEventHandler<HTMLElement>;
    onBlur: FocusEventHandler<HTMLElement>;
  };
  rowFocus(id: string): RowFocus;
  /** The focused row (the tab stop once the list has been entered). */
  focused: string | null;
}

/** What `RowFocus` holds, for kit components that render a row (ListRow, Tabs). */
export interface RowFocusProps {
  tabIndex: number;
  ref: (element: HTMLElement | null) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
}

/** Kit-internal: the props a `RowFocus` stands for. */
export function rowFocusProps(focus: RowFocus | undefined): RowFocusProps | undefined {
  return focus as unknown as RowFocusProps | undefined;
}

/** Marks a ListRow (the wrapper) and its trailing slot, so the host can reach the slot's controls with arrows. */
export const ROW_ATTRIBUTE = 'data-kit-list-row';
export const TRAILING_ATTRIBUTE = 'data-kit-row-trailing';
const TRAILING_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/**
 * Kit-internal: trailing controls of a row in a roving list are not Tab stops
 * (the row is the one stop); Right and Left reach them from the row.
 */
export function takeTrailingOutOfTabOrder(slot: HTMLElement | null): void {
  slot?.querySelectorAll<HTMLElement>(TRAILING_FOCUSABLE).forEach((element) => {
    if (element.getAttribute('tabindex') !== '-1') element.setAttribute('tabindex', '-1');
  });
}

interface Callbacks {
  onSelect?: (id: string) => void;
  onDeselect?: () => void;
  reveal?: (id: string) => void;
}

const MOVES: Record<string, Event> = {
  ArrowDown: { down: {} },
  ArrowUp: { up: {} },
  Home: { home: {} },
  End: { end: {} },
};
const HORIZONTAL_MOVES: Record<string, Event> = {
  ...MOVES,
  ArrowRight: { down: {} },
  ArrowLeft: { up: {} },
};

function rowsKey(rows: readonly Row[]): string {
  return JSON.stringify(rows.map((row) => [row.id, row.label, row.disabled]));
}

function isLink(element: HTMLElement | undefined): boolean {
  return element instanceof HTMLAnchorElement && element.hasAttribute('href');
}

/**
 * The list host without React: the machine, the row elements, and the key,
 * focus and click handling. One per `useListFocus`.
 */
export function createListFocusHost(timers: TimerService, doc: Document, params: Params) {
  const elements = new Map<string, HTMLElement>();
  const refs = new Map<string, (element: HTMLElement | null) => void>();
  const clicks = new Map<string, (event: MouseEvent<HTMLElement>) => void>();
  let callbacks: Callbacks = {};
  let root: HTMLElement | null = null;
  // The row element that last had focus: if it is removed while focused, focus follows the list's new row.
  let lastRow: HTMLElement | null = null;
  let pendingFocus: string | null = null;
  let swallowSpaceUp = false;
  let typeahead = true;
  let horizontal = false;
  let sentRows: string | null = null;

  const machine: Machine<State, Event> = createMachine(stepListFocus, initialListFocus(params), params, (effect) => {
    if ('select' in effect) callbacks.onSelect?.(effect.select.id);
    else if ('deselect' in effect) callbacks.onDeselect?.();
    else if ('startTimer' in effect) {
      const { token, ms } = effect.startTimer;
      timers.start(machine, token, ms, () => machine.send({ timerFired: { token } }));
    } else if ('cancelTimer' in effect) timers.cancel(machine, effect.cancelTimer.token);
  });

  function focusInList(): boolean {
    const active = doc.activeElement;
    return root !== null && active !== null && root.contains(active);
  }

  /** Real focus to the row: reveal it first; if it is not rendered yet, after the next render. */
  function focusRow(id: string): void {
    callbacks.reveal?.(id);
    const element = elements.get(id);
    if (element?.isConnected) {
      pendingFocus = null;
      if (doc.activeElement !== element) element.focus();
    } else {
      pendingFocus = id;
    }
  }

  /** Send a key's event, then move real focus to the focused row. */
  function sendKey(event: Event): void {
    machine.send(event);
    const { focused } = machine.getState();
    if (focused !== null) focusRow(focused);
  }

  function locate(target: EventTarget | null): { id: string; part: 'row' | 'trailing' } | null {
    if (!(target instanceof HTMLElement)) return null;
    for (const [id, element] of elements) if (element === target) return { id, part: 'row' };
    const wrapper = target.closest(`[${TRAILING_ATTRIBUTE}]`)?.closest(`[${ROW_ATTRIBUTE}]`);
    if (!wrapper) return null;
    for (const [id, element] of elements) if (wrapper.contains(element)) return { id, part: 'trailing' };
    return null;
  }

  /** Right and Left in a vertical list: from the row into its trailing controls and back. */
  function moveAcross(id: string, forward: boolean, target: HTMLElement): boolean {
    const row = elements.get(id);
    const wrapper = row?.closest(`[${ROW_ATTRIBUTE}]`);
    const slot = wrapper?.querySelector<HTMLElement>(`[${TRAILING_ATTRIBUTE}]`);
    if (!row || !slot) return false;
    const items = [row, ...Array.from(slot.querySelectorAll<HTMLElement>(TRAILING_FOCUSABLE))];
    const at = items.indexOf(target);
    const next = items[at + (forward ? 1 : -1)];
    if (at === -1 || next === undefined) return false;
    next.focus();
    return true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // Keys from a Menu opened from a trailing control bubble here through React's tree: not ours.
    const place = event.currentTarget.contains(event.target as Node) ? locate(event.target) : null;
    if (place === null) return;
    root = event.currentTarget;
    const { key } = event;
    const move = (horizontal ? HORIZONTAL_MOVES : MOVES)[key];
    if (move !== undefined) {
      event.preventDefault();
      sendKey(move);
      return;
    }
    if (!horizontal && (key === 'ArrowRight' || key === 'ArrowLeft')) {
      if (moveAcross(place.id, key === 'ArrowRight', event.target as HTMLElement)) event.preventDefault();
      return;
    }
    if (key === ' ' && typeahead && machine.getState().typeahead !== '') {
      // Space continues the typed text ("general chat"): it must not press the row, on keydown or keyup.
      event.preventDefault();
      swallowSpaceUp = true;
      sendKey({ type: { char: ' ' } });
      return;
    }
    if ((key === ' ' || key === 'Enter') && place.part === 'row') {
      const element = elements.get(place.id);
      // A button clicks itself (Enter and Space) and a link follows itself (Enter); that click is the activation.
      const native = element instanceof HTMLButtonElement || (key === 'Enter' && isLink(element));
      if (element === undefined || native) return;
      // Space on a link scrolls the page natively: press the link instead. A plain row is pressed for both keys.
      event.preventDefault();
      if (!event.repeat) element.click();
      return;
    }
    if (typeahead && key !== ' ' && [...key].length === 1) {
      event.preventDefault();
      const before = machine.getState().focused;
      machine.send({ type: { char: key } });
      const { focused } = machine.getState();
      if (focused !== null && focused !== before) focusRow(focused);
    }
  }

  function onKeyUp(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === ' ' && swallowSpaceUp) {
      swallowSpaceUp = false;
      event.preventDefault();
    }
  }

  function onListFocus(event: FocusEvent<HTMLElement>): void {
    root = event.currentTarget;
    const from = event.relatedTarget;
    if (from instanceof Node && event.currentTarget.contains(from)) return;
    // Real focus is already where the browser put it (the tab stop, or the row a pointer is pressing).
    machine.send({ focusIn: {} });
  }

  function onListBlur(event: FocusEvent<HTMLElement>): void {
    const to = event.relatedTarget;
    // Focus went somewhere else on purpose: a row removed later must not pull it back.
    if (to instanceof Node && !event.currentTarget.contains(to)) lastRow = null;
  }

  function onRowFocus(event: FocusEvent<HTMLElement>): void {
    lastRow = event.currentTarget;
  }

  function refFor(id: string): (element: HTMLElement | null) => void {
    let ref = refs.get(id);
    if (ref === undefined) {
      ref = (element) => {
        if (element !== null) elements.set(id, element);
        else elements.delete(id);
      };
      refs.set(id, ref);
    }
    return ref;
  }

  function clickFor(id: string): (event: MouseEvent<HTMLElement>) => void {
    let click = clicks.get(id);
    if (click === undefined) {
      click = (event) => {
        // A modified click (a new tab, a new window) or another button: the browser's, not a choice here.
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        // detail 0 is a click from Enter or Space (or assistive technology) rather than a pointer.
        if (event.detail === 0 && machine.getState().focused === id) machine.send({ activate: {} });
        else {
          machine.send({ press: { id } });
          if (machine.getState().focused === id && doc.activeElement !== event.currentTarget) {
            // Safari does not focus a button or link on a pointer press; the row is the focus now. It came
            // from a pointer, so no ring (the option is ignored where unsupported).
            event.currentTarget.focus({ focusVisible: false } as FocusOptions);
          }
        }
      };
      clicks.set(id, click);
    }
    return click;
  }

  return {
    machine,
    onKeyDown,
    onKeyUp,
    onListFocus,
    onListBlur,
    onRowFocus,
    refFor,
    clickFor,
    configure(next: { callbacks: Callbacks; typeahead: boolean; horizontal: boolean }): void {
      callbacks = next.callbacks;
      typeahead = next.typeahead;
      horizontal = next.horizontal;
    },
    /** After a render: send the rows and the selection if they changed, and carry focus over a change. */
    sync(rows: Row[], selected: string | null): void {
      const key = rowsKey(rows);
      if (key !== sentRows) {
        sentRows = key;
        const before = machine.getState().focused;
        // Focus was on a row that this render removed: the browser dropped it to the body.
        const lost = (doc.activeElement === null || doc.activeElement === doc.body) && lastRow !== null && !lastRow.isConnected;
        const had = focusInList() || lost;
        machine.send({ setRows: { rows } });
        const { focused } = machine.getState();
        if (had && focused !== null && (focused !== before || lost)) focusRow(focused);
      }
      const known = selected !== null && machine.getState().rows.some((row) => row.id === selected);
      if (machine.getState().selected !== (known ? selected : null)) machine.send({ setSelected: { id: selected } });
      if (pendingFocus !== null) {
        const id = pendingFocus;
        pendingFocus = null;
        if (machine.getState().focused === id) {
          const element = elements.get(id);
          if (element?.isConnected) element.focus();
        }
      }
    },
    dispose(): void {
      timers.disposeAll(machine);
    },
  };
}

type ListFocusHost = ReturnType<typeof createListFocusHost>;

/**
 * Keyboard focus and selection for a list of rows (the list focus pattern):
 * one Tab stop, arrows, Home and End, typeahead, activation by the native
 * click, and focus kept on a row when rows come and go. Render each row with
 * `rowFocus(id)` (ListRow's `focus` prop) and spread `listProps` on the
 * element that holds them.
 */
export function useListFocus(options: ListFocusOptions): ListFocus {
  const {
    rows,
    selected,
    onSelect,
    onDeselect,
    reveal,
    orientation = 'vertical',
    wrap = false,
    selectionFollowsFocus = false,
    typeahead = true,
  } = options;
  const { timers } = useBehaviourHost();
  const [{ host, params }] = useState(() => {
    const created: Params = { ...DEFAULT_PARAMS, wrap, selectionFollowsFocus };
    const list: ListFocusHost = createListFocusHost(timers, document, created);
    // The first render already has its tab stop.
    list.sync(rows, selected);
    return { host: list, params: created };
  });
  const state = useSyncExternalStore(host.machine.subscribe, host.machine.getState);

  useLayoutEffect(() => {
    // The machine reads its params on every step; they follow the props.
    params.wrap = wrap;
    params.selectionFollowsFocus = selectionFollowsFocus;
    host.configure({ callbacks: { onSelect, onDeselect, reveal }, typeahead, horizontal: orientation === 'horizontal' });
    host.sync(rows, selected);
  });
  useEffect(() => () => host.dispose(), [host]);

  const enabled = state.rows.filter((row) => !row.disabled).map((row) => row.id);
  const tabStop =
    state.focused ?? (state.selected !== null && enabled.includes(state.selected) ? state.selected : (enabled[0] ?? null));

  return {
    listProps: { onKeyDown: host.onKeyDown, onKeyUp: host.onKeyUp, onFocus: host.onListFocus, onBlur: host.onListBlur },
    rowFocus(id) {
      const props: RowFocusProps = {
        tabIndex: id === tabStop ? 0 : -1,
        ref: host.refFor(id),
        onClick: host.clickFor(id),
        onFocus: host.onRowFocus,
      };
      return props as unknown as RowFocus;
    },
    focused: state.focused,
  };
}
