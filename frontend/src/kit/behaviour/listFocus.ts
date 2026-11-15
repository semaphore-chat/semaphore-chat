/**
 * Keyboard focus and selection in a list of rows: arrows, Home and End,
 * typeahead, and what happens when the rows change under the focus.
 *
 * A direct port of the `listFocus` reducers in `design/gen/behaviour_ref.py`;
 * the rule numbers below are that pattern's rules. Pure: it never mutates the
 * state it is given, never reads a clock and never makes an id. A timer is an
 * effect that comes back as a `timerFired` event.
 */

import { tokens } from '../../theme/generated/tokens';
import { requireEvent } from './event';

export interface Row {
  id: string;
  label: string;
  disabled: boolean;
}

export interface State {
  /** In display order. */
  rows: Row[];
  /** The focused row; never a disabled one. */
  focused: string | null;
  /** The selected row. */
  selected: string | null;
  /** The letters typed so far, folded (rule 16). */
  typeahead: string;
  /** The token of the latest typeahead timer. */
  token: number;
}

/** An event is an object with exactly one key, its name. */
export type Event =
  | { setRows: { rows: Row[] } }
  | { focusIn: Record<string, never> }
  | { up: Record<string, never> }
  | { down: Record<string, never> }
  | { home: Record<string, never> }
  | { end: Record<string, never> }
  | { type: { char: string } }
  | { timerFired: { token: number } }
  | { activate: Record<string, never> }
  | { press: { id: string } }
  | { setSelected: { id: string | null } }
  | { focusOut: Record<string, never> }
  | { focusRow: { id: string } };

export type Effect =
  | { select: { id: string } }
  | { deselect: Record<string, never> }
  | { startTimer: { token: number; ms: number } }
  | { cancelTimer: { token: number } };

export interface Params {
  wrap: boolean;
  selectionFollowsFocus: boolean;
  typeaheadMs: number;
}

const EVENT_NAMES = [
  'setRows',
  'focusIn',
  'up',
  'down',
  'home',
  'end',
  'type',
  'timerFired',
  'activate',
  'press',
  'setSelected',
  'focusOut',
  'focusRow',
] as const;

export const DEFAULT_PARAMS: Params = {
  wrap: false,
  selectionFollowsFocus: false,
  typeaheadMs: tokens.motion.typeahead,
};

export function initialListFocus(_params: Params = DEFAULT_PARAMS): State {
  return { rows: [], focused: null, selected: null, typeahead: '', token: 0 };
}

/** Rule 1: only enabled rows take focus. */
function enabledIds(rows: readonly Row[]): string[] {
  return rows.filter((row) => !row.disabled).map((row) => row.id);
}

/**
 * Move focus by key or typeahead. Rule 12: with selectionFollowsFocus on,
 * every focus move also selects; rule 11: with it off, a focus move never does.
 */
function focus(state: State, target: string, params: Params, effects: Effect[]): void {
  if (target === state.focused) return;
  state.focused = target;
  if (params.selectionFollowsFocus && state.selected !== target) {
    state.selected = target;
    effects.push({ select: { id: target } });
  }
}

/**
 * Rule 16: map each character on its own with the Unicode default lower-case
 * mapping, which is locale independent (Python `str.lower()` per character, so
 * the final-sigma rule never applies). Code points are iterated so that an
 * emoji is one character, and the result is compared by code point.
 */
function fold(text: string): string {
  return [...text].map((ch) => ch.toLowerCase()).join('');
}

/**
 * The row the typeahead buffer picks. Rule 7: the first enabled row from the
 * focused one onwards, wrapping round, whose folded label starts with the
 * folded buffer. Rule 8: one character repeated steps through the rows that
 * start with it, from the row after the focused one.
 */
function typeaheadMatch(state: State): string | null {
  const { rows, focused } = state;
  const ids = rows.map((row) => row.id);
  const focusedAt = focused !== null && ids.includes(focused) ? ids.indexOf(focused) : -1;
  const buffer = [...state.typeahead];
  let prefix = state.typeahead;
  let start = focusedAt === -1 ? 0 : focusedAt;
  if (new Set(buffer).size === 1 && focusedAt !== -1) {
    prefix = buffer[0];
    start += 1;
  }
  for (let offset = 0; offset < rows.length; offset++) {
    const row = rows[(start + offset) % rows.length];
    if (!row.disabled && fold(row.label).startsWith(prefix)) return row.id;
  }
  return null;
}

export function stepListFocus(
  state: State,
  event: Event,
  params: Params = DEFAULT_PARAMS,
): { state: State; effects: Effect[] } {
  requireEvent('listFocus', event, EVENT_NAMES);
  if (
    'type' in event &&
    (typeof event.type.char !== 'string' || [...event.type.char].length !== 1)
  ) {
    // `type.char` is exactly one Unicode scalar value; anything else is a host bug.
    throw new RangeError(
      `listFocus: type.char must be one character, got ${JSON.stringify(event.type.char)}`,
    );
  }
  const next: State = { ...state, rows: [...state.rows] };
  const effects: Effect[] = [];

  if ('setRows' in event) {
    const oldIds = next.rows.map((row) => row.id);
    next.rows = event.setRows.rows.map((row) => ({ ...row }));
    const enabled = enabledIds(next.rows);
    const present = new Set(next.rows.map((row) => row.id));
    const { focused } = next;
    if (focused !== null && !enabled.includes(focused)) {
      // Rule 14: the focused row is gone or disabled: focus moves to the
      // nearest enabled survivor after it in the old order, else before it,
      // else the first enabled row, else nothing. The selection moves with it
      // only when selectionFollowsFocus is on.
      const at = oldIds.indexOf(focused);
      const after = oldIds.slice(at + 1);
      const before = oldIds.slice(0, at).reverse();
      const survivors = [...after, ...before].filter((id) => enabled.includes(id));
      next.focused = survivors.length > 0 ? survivors[0] : (enabled[0] ?? null);
      if (params.selectionFollowsFocus && next.focused !== null) {
        next.selected = next.focused;
        effects.push({ select: { id: next.focused } });
      }
    }
    if (next.selected !== null && !present.has(next.selected)) {
      // Rule 15: a selected row that is gone clears the selection: deselect.
      next.selected = null;
      effects.push({ deselect: {} });
    }
    return { state: next, effects };
  }

  if ('setSelected' in event) {
    // Rule 17: the selection set from outside: a row's id (enabled or not),
    // else null. Nothing is emitted; focus and typeahead stay. Not a key, so
    // rule 2 does not stop it.
    const { id } = event.setSelected;
    next.selected = id !== null && next.rows.some((row) => row.id === id) ? id : null;
    return { state: next, effects };
  }

  if ('focusOut' in event) {
    // Rule 18: focus left the list. The typed letters go (their timer too); an
    // enabled selected row takes the Tab stop back (rule 6 on the next focusIn),
    // otherwise the last focused row keeps it.
    if (next.typeahead) {
      effects.push({ cancelTimer: { token: next.token } });
      next.typeahead = '';
    }
    if (next.selected !== null && enabledIds(next.rows).includes(next.selected)) next.focused = null;
    return { state: next, effects };
  }

  const enabled = enabledIds(next.rows);
  // Rule 2: with no enabled rows, every key does nothing.
  if (enabled.length === 0 && !('timerFired' in event)) return { state: next, effects };
  const { focused } = next;

  if ('down' in event || 'up' in event) {
    // Rule 3: Down moves to the next enabled row, Up to the previous one; with
    // nothing focused, Down takes the first and Up the last.
    const order = 'down' in event ? enabled : [...enabled].reverse();
    if (focused === null) {
      focus(next, order[0], params, effects);
    } else {
      const at = order.indexOf(focused);
      if (at + 1 < order.length) {
        focus(next, order[at + 1], params, effects);
      } else if (params.wrap) {
        // Rule 4: at the ends they stay put unless wrap is on.
        focus(next, order[0], params, effects);
      }
    }
  } else if ('home' in event) {
    // Rule 5: Home focuses the first enabled row.
    focus(next, enabled[0], params, effects);
  } else if ('end' in event) {
    // Rule 5: End focuses the last enabled row.
    focus(next, enabled[enabled.length - 1], params, effects);
  } else if ('focusIn' in event) {
    // Rule 6: focus entering the list goes to the selected row if enabled,
    // else the first enabled row, and never changes the selection.
    if (focused === null) {
      const { selected } = next;
      next.focused = selected !== null && enabled.includes(selected) ? selected : enabled[0];
    }
  } else if ('type' in event) {
    // Rule 7: the character joins the buffer, folded (rule 16), and the timer
    // restarts with a new token.
    if (next.typeahead) effects.push({ cancelTimer: { token: next.token } });
    next.typeahead += fold(event.type.char);
    next.token += 1;
    effects.push({ startTimer: { token: next.token, ms: params.typeaheadMs } });
    const match = typeaheadMatch(next);
    // Rule 9: no match leaves focus where it is; the buffer still grows.
    if (match !== null) focus(next, match, params, effects);
  } else if ('timerFired' in event) {
    // Rule 10: the current token empties the buffer; any other does nothing.
    if (event.timerFired.token === next.token && next.typeahead) next.typeahead = '';
  } else if ('activate' in event) {
    // Rule 11: Enter or Space selects the focused row and emits select, even
    // when it was already selected; with nothing focused it does nothing.
    if (focused !== null) {
      next.selected = focused;
      effects.push({ select: { id: focused } });
    }
  } else if ('focusRow' in event) {
    // Rule 19: a row focused by other means than the keys is the focused row, as
    // a focus move (rule 12 selects with selectionFollowsFocus on); a disabled or
    // unknown row does nothing.
    if (enabled.includes(event.focusRow.id)) focus(next, event.focusRow.id, params, effects);
  } else if ('press' in event) {
    // Rule 13: a press on an enabled row focuses and selects it; on a disabled
    // or unknown row it does nothing.
    if (enabled.includes(event.press.id)) {
      next.focused = event.press.id;
      next.selected = event.press.id;
      effects.push({ select: { id: event.press.id } });
    }
  }

  return { state: next, effects };
}
