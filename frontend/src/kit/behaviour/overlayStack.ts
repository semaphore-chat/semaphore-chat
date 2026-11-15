/**
 * The overlay stack: the layers floating above a screen, in the order they
 * opened. Escape, a press outside and Tab are decided here, once.
 *
 * A direct port of the `overlayStack` reducers in
 * `design/gen/behaviour_ref.py`; the rule numbers below are that pattern's
 * rules. Pure: it never mutates the state it is given.
 */

import { requireEvent } from './event';

export type LayerKind = 'tooltip' | 'menu' | 'popover' | 'dialog' | 'sheet';

export interface Layer {
  id: string;
  kind: LayerKind;
  /** The layer it opened from. */
  parent: string | null;
  /** The element that had focus when it opened. */
  opener: string | null;
}

export interface State {
  /** Bottom first. */
  layers: Layer[];
}

export type CloseReason = 'escape' | 'pressOutside' | 'scrim' | 'tab' | 'parentClosed';

/** An event is an object with exactly one key, its name. */
export type Event =
  | { open: { layer: Layer } }
  | { closed: { id: string; openerPresent: boolean } }
  | { escape: Record<string, never> }
  | { pressOutside: { insideId: string | null } }
  | { tab: Record<string, never> };

export type Effect =
  | { requestClose: { id: string; reason: CloseReason } }
  | { restoreFocus: { to: string | null } }
  | { passToScreen: { key: 'Escape' } };

/** The overlay stack has no settings. */
export type Params = Record<string, never>;

const EVENT_NAMES = ['open', 'closed', 'escape', 'pressOutside', 'tab'] as const;

export const DEFAULT_PARAMS: Params = {};

export function initialOverlayStack(_params: Params = DEFAULT_PARAMS): State {
  return { layers: [] };
}

/** `layerId` and the ids of the layers it was opened from, innermost first. */
function ancestors(layers: readonly Layer[], layerId: string | null): string[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const chain: string[] = [];
  let current = layerId;
  while (current !== null && !chain.includes(current)) {
    chain.push(current);
    current = byId.get(current)?.parent ?? null;
  }
  return chain;
}

/** The layers opened from `layerId`, directly or not, topmost (innermost) first. */
function descendants(layers: readonly Layer[], layerId: string): Layer[] {
  return [...layers]
    .reverse()
    .filter((layer) => layer.id !== layerId && ancestors(layers, layer.id).includes(layerId));
}

export function stepOverlayStack(
  state: State,
  event: Event,
  _params: Params = DEFAULT_PARAMS,
): { state: State; effects: Effect[] } {
  requireEvent('overlayStack', event, EVENT_NAMES);
  const next: State = { layers: [...state.layers] };
  const effects: Effect[] = [];
  const { layers } = next;
  const others = layers.filter((layer) => layer.kind !== 'tooltip');

  if ('open' in event) {
    const layer: Layer = { ...event.open.layer };
    // Rule 2: opening a layer whose id is already in the stack does nothing.
    if (layers.every((item) => item.id !== layer.id)) {
      // Rule 1: layers stack in the order they open, and a tooltip always sits
      // on top: anything else goes just below the tooltips.
      let at = layers.length;
      if (layer.kind !== 'tooltip') {
        while (at > 0 && layers[at - 1].kind === 'tooltip') at -= 1;
      }
      layers.splice(at, 0, layer);
    }
  } else if ('escape' in event) {
    // Rule 4: tooltips never block Escape: each is asked to close, topmost
    // first, and Escape then acts as if they were not there.
    for (let i = layers.length - 1; i >= 0; i--) {
      if (layers[i].kind === 'tooltip') {
        effects.push({ requestClose: { id: layers[i].id, reason: 'escape' } });
      }
    }
    if (others.length > 0) {
      // Rule 3: Escape asks the topmost layer to close, one layer per Escape.
      effects.push({ requestClose: { id: others[others.length - 1].id, reason: 'escape' } });
    } else {
      // Rule 5: with nothing (else) open, the screen gets the key.
      effects.push({ passToScreen: { key: 'Escape' } });
    }
  } else if ('pressOutside' in event) {
    // Rule 6: a press is inside a layer when it lands in it or in any layer
    // opened from it.
    const inside = ancestors(layers, event.pressOutside.insideId);
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (inside.includes(layer.id)) break;
      if (layer.kind === 'tooltip') {
        // Rule 10: presses never close a tooltip.
        continue;
      }
      if (layer.kind === 'popover') {
        // Rule 7: a press outside a popover asks it to close and carries on below.
        effects.push({ requestClose: { id: layer.id, reason: 'pressOutside' } });
        continue;
      }
      if (layer.kind === 'menu') {
        // Rule 8: a press outside a menu asks it to close and goes no further.
        effects.push({ requestClose: { id: layer.id, reason: 'pressOutside' } });
        break;
      }
      // Rule 9: a press outside a dialog or sheet is a press on its scrim.
      effects.push({ requestClose: { id: layer.id, reason: 'scrim' } });
      break;
    }
  } else if ('tab' in event) {
    // Rule 11: Tab closes a menu that is topmost under the tooltips; otherwise nothing.
    if (others.length > 0 && others[others.length - 1].kind === 'menu') {
      effects.push({ requestClose: { id: others[others.length - 1].id, reason: 'tab' } });
    }
  } else if ('closed' in event) {
    // Rule 12: a layer leaves the stack only when its owner reports closed.
    const target = layers.find((layer) => layer.id === event.closed.id);
    if (target !== undefined) {
      // Rule 13: layers opened from it are asked to close first, innermost first.
      const children = descendants(layers, target.id);
      for (const child of children) {
        effects.push({ requestClose: { id: child.id, reason: 'parentClosed' } });
      }
      const gone = new Set([target.id, ...children.map((child) => child.id)]);
      next.layers = layers.filter((layer) => !gone.has(layer.id));
      // Rule 15: closing a tooltip moves no focus.
      if (target.kind !== 'tooltip') {
        // Rule 14: focus goes to the opener if it is still on the page, else to
        // the layer it opened from, else to the screen (null).
        const remaining = new Set(next.layers.map((layer) => layer.id));
        const openerPresent = event.closed.openerPresent && target.opener !== null;
        const to = openerPresent
          ? target.opener
          : target.parent !== null && remaining.has(target.parent)
            ? target.parent
            : null;
        effects.push({ restoreFocus: { to } });
      }
    }
    // Rule 15: a closed event for an id not in the stack does nothing.
  }

  return { state: next, effects };
}
