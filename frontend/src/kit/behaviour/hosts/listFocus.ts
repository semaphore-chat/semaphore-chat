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
  /**
   * Called before a row is focused, so a virtualised list can render it. The host focuses it once it is rendered.
   * A virtualised list must keep its Tab stop row (the focused or the selected row) rendered, or Tab skips the list.
   */
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
    /** Capture phase: entering the list is handled before any row sees the focus. */
    onFocusCapture: FocusEventHandler<HTMLElement>;
    onBlur: FocusEventHandler<HTMLElement>;
  };
  rowFocus(id: string): RowFocus;
  /** For a bar of items that is not a list element of its own (the Dock): pass to its `focus` prop instead of spreading `listProps`. Opaque. */
  bar: BarFocus;
  /** The focused row (the tab stop once the list has been entered). */
  focused: string | null;
}

/** What a bar (the Dock) needs to be the keyboard list. Opaque: pass `useListFocus(...).bar` to the Dock's `focus`. */
export interface BarFocus {
  readonly __brand: 'BarFocus';
}

/** Kit-internal: the four handlers a `BarFocus` stands for. */
export function barFocusProps(bar: BarFocus | undefined): ListFocus['listProps'] | undefined {
  return bar as unknown as ListFocus['listProps'] | undefined;
}

/** What `RowFocus` holds, for kit components that render a row (ListRow, Tabs). */
export interface RowFocusProps {
  tabIndex: number;
  ref: (element: HTMLElement | null) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
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

const SAVED_TABINDEX = 'data-kit-saved-tabindex';

/**
 * Kit-internal: trailing controls of a row in a roving list are not Tab stops
 * (the row is the one stop); Right and Left reach them from the row. The
 * control's own tabindex is kept, so `restoreTrailingTabOrder` can put it back.
 */
export function takeTrailingOutOfTabOrder(slot: HTMLElement | null): void {
  slot?.querySelectorAll<HTMLElement>(TRAILING_FOCUSABLE).forEach((element) => {
    if (element.getAttribute('tabindex') === '-1') return;
    if (!element.hasAttribute(SAVED_TABINDEX)) element.setAttribute(SAVED_TABINDEX, element.getAttribute('tabindex') ?? '');
    element.setAttribute('tabindex', '-1');
  });
}

/** Kit-internal: the row left the keyboard list; its trailing controls are Tab stops again. */
export function restoreTrailingTabOrder(slot: HTMLElement | null): void {
  slot?.querySelectorAll<HTMLElement>(`[${SAVED_TABINDEX}]`).forEach((element) => {
    const saved = element.getAttribute(SAVED_TABINDEX) ?? '';
    element.removeAttribute(SAVED_TABINDEX);
    if (saved === '') element.removeAttribute('tabindex');
    else element.setAttribute('tabindex', saved);
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

/**
 * The row that holds the list's Tab stop. While focus is in the list, the focused row. While it is outside, the row
 * focus will enter on (rule 6): the selected row if enabled, else the focused row if enabled, else the first enabled.
 */
function tabStopOf(state: State, inside: boolean): string | null {
  const enabled = state.rows.filter((row) => !row.disabled).map((row) => row.id);
  const usable = (id: string | null): id is string => id !== null && enabled.includes(id);
  if (inside && usable(state.focused)) return state.focused;
  if (usable(state.selected)) return state.selected;
  if (usable(state.focused)) return state.focused;
  return enabled[0] ?? null;
}

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
  // The element in the list that last had focus (a row or a trailing control) and the row it belongs to: if it goes
  // away while focused, focus goes to that row, else the pattern's row, never to the body.
  let last: { element: HTMLElement; id: string } | null = null;
  let inside = false;
  let observer: MutationObserver | null = null;
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

  function focusLost(): boolean {
    const active = doc.activeElement;
    return (active === null || active === doc.body) && last !== null && !last.element.isConnected;
  }

  /** Focus fell to the body because the focused element in the list went away: give it to the owning row. */
  function recover(): void {
    if (!focusLost() || last === null) return;
    const state = machine.getState();
    const enabled = state.rows.filter((row) => !row.disabled).map((row) => row.id);
    const candidates = [last.id, state.focused, tabStopOf(state, false)];
    for (const id of candidates) {
      const element = id !== null && enabled.includes(id) ? elements.get(id) : undefined;
      if (element?.isConnected) {
        element.focus();
        if (doc.activeElement === element) return;
      }
    }
  }

  function watch(list: HTMLElement): void {
    if (root === list && observer !== null) return;
    root = list;
    observer?.disconnect();
    if (typeof MutationObserver === 'undefined') return;
    // Any commit can remove the focused element (a trailing control that unmounts on its own state): check after each.
    observer = new MutationObserver(() => recover());
    observer.observe(list, { childList: true, subtree: true });
  }

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
    if (event.defaultPrevented) return;
    // AltGr is reported as Ctrl+Alt on Windows; its letters (ł, ą, €) still type.
    const altGraph = event.getModifierState?.('AltGraph') === true;
    if ((event.altKey || event.ctrlKey || event.metaKey) && !altGraph) return;
    // A key that is composing text (an IME) is the IME's.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // Keys from a Menu opened from a trailing control bubble here through React's tree: not ours.
    const place = event.currentTarget.contains(event.target as Node) ? locate(event.target) : null;
    if (place === null) return;
    watch(event.currentTarget);
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
    if (key === ' ' && place.part === 'row' && typeahead && machine.getState().typeahead !== '') {
      // Space continues the typed text ("general chat"): it must not press the row, on keydown or keyup.
      event.preventDefault();
      swallowSpaceUp = true;
      sendKey({ type: { char: ' ' } });
      return;
    }
    if ((key === ' ' || key === 'Enter') && place.part === 'row') {
      const element = elements.get(place.id);
      // A held key activates once: a button or link would click again on every repeat.
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      // A button clicks itself (Enter and Space) and a link follows itself (Enter); that click is the activation.
      const native = element instanceof HTMLButtonElement || (key === 'Enter' && isLink(element));
      if (element === undefined || native) return;
      // Space on a link scrolls the page natively: press the link instead. A plain row is pressed for both keys.
      event.preventDefault();
      element.click();
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

  /**
   * Capture phase, before any row's own focus handler. Entering from outside is `focusIn` (rule 6), sent first. Then,
   * if the focus is on a row other than the pattern's focused row, or on a row's trailing control, that row is
   * `focusRow` (it never selects). Tab lands on the Tab stop, which is rule 6's row, so it sends only `focusIn`; a click
   * or a screen reader landing on another row sends `focusIn` and then `focusRow` for that row.
   */
  function onFocusCapture(event: FocusEvent<HTMLElement>): void {
    const list = event.currentTarget;
    watch(list);
    const from = event.relatedTarget;
    const entering = !(from instanceof Node && list.contains(from));
    const place = locate(event.target);
    if (pendingFocus !== null && place?.id !== pendingFocus) pendingFocus = null;
    if (entering) {
      inside = true;
      machine.send({ focusIn: {} });
    }
    if (place === null) return;
    last = { element: event.target as HTMLElement, id: place.id };
    if (place.id !== machine.getState().focused) machine.send({ focusRow: { id: place.id } });
  }

  function onListBlur(event: FocusEvent<HTMLElement>): void {
    const to = event.relatedTarget;
    // Between rows, or to a row's trailing control: still in the list.
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    const left = event.target as HTMLElement;
    if (to instanceof Node) last = null;
    else {
      // Focus went to nothing: a click on the page's background (forget the element, so a later change never takes
      // focus), the window losing focus (keep it), or the element being removed (keep it, to recover).
      queueMicrotask(() => {
        if (left.isConnected && doc.hasFocus() && last?.element === left && doc.activeElement !== left) last = null;
      });
    }
    inside = false;
    swallowSpaceUp = false;
    pendingFocus = null;
    machine.send({ focusOut: {} });
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
        // A modified click on a link opens a new tab or window: the browser's, not a choice here. A button row has
        // no such meaning, so a Ctrl- or Shift-click still chooses it (its own onClick runs too).
        const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
        if (event.button !== 0 || (modified && isLink(event.currentTarget))) return;
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
    onFocusCapture,
    onListBlur,
    refFor,
    clickFor,
    /** The Tab stop for this state; whether focus is in the list changes only with focusIn and focusOut steps. */
    tabStop(state: State): string | null {
      return tabStopOf(state, inside);
    },
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
        const had = focusInList();
        machine.send({ setRows: { rows } });
        // Rule 14 moved focus off a row that is gone or disabled while real focus is still in the list.
        const { focused } = machine.getState();
        if (had && focused !== null && focused !== before) focusRow(focused);
      }
      const known = selected !== null && machine.getState().rows.some((row) => row.id === selected);
      if (machine.getState().selected !== (known ? selected : null)) machine.send({ setSelected: { id: selected } });
      // Every commit: the focused element may have gone (a row removed, a trailing control unmounted).
      recover();
      if (pendingFocus !== null) {
        const id = pendingFocus;
        const element = elements.get(id);
        if (machine.getState().focused !== id) pendingFocus = null;
        else if (element?.isConnected) {
          // Kept until the row is rendered: a virtualiser may need more than one frame.
          pendingFocus = null;
          element.focus();
        }
      }
    },
    dispose(): void {
      observer?.disconnect();
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

  const tabStop = host.tabStop(state);

  const listProps = {
    onKeyDown: host.onKeyDown,
    onKeyUp: host.onKeyUp,
    onFocusCapture: host.onFocusCapture,
    onBlur: host.onListBlur,
  };
  return {
    listProps,
    bar: listProps as unknown as BarFocus,
    rowFocus(id) {
      const props: RowFocusProps = {
        tabIndex: id === tabStop ? 0 : -1,
        ref: host.refFor(id),
        onClick: host.clickFor(id),
      };
      return props as unknown as RowFocus;
    },
    focused: state.focused,
  };
}
