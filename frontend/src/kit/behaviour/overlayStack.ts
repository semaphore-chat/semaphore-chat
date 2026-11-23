/**
 * The overlay stack: the layers floating above a screen, in the order they
 * opened. Escape, a press outside, Tab and the system Back are decided here, once.
 *
 * A direct port of the `overlayStack` reducers in `design/gen/behaviour_ref.py`;
 * the rule numbers below are that pattern's rules. Pure: it never mutates the
 * state it is given.
 */

import { requireEvent } from './event';

export type LayerKind = 'tooltip' | 'menu' | 'popover' | 'dialog' | 'sheet';

/** Where focus is as a layer closes. */
export type FocusPosition = 'inside' | 'lost' | 'outside';

export interface Layer {
  id: string;
  kind: LayerKind;
  /** The layer it is owned by: it closes with that layer. */
  parent: string | null;
  /** The element that had focus when it opened: focus returns there. */
  opener: string | null;
  /** The layer the opener is in; null for the screen. */
  openerLayer: string | null;
}

export interface State {
  /** Bottom first. */
  layers: Layer[];
}

export type CloseReason = 'escape' | 'pressOutside' | 'scrim' | 'tab' | 'back' | 'parentClosed';

/** An event is an object with exactly one key, its name. */
export type Event =
  | { open: { layer: Layer } }
  | { closed: { id: string; openerPresent: boolean; focus: FocusPosition } }
  | { escape: { composing: boolean; focusOwnsEscape: boolean } }
  | { pressOutside: { insideId: string | null } }
  | { tab: Record<string, never> }
  /** The system Back: Android's Back gesture or button, a browser's Back while a layer is open. */
  | { back: Record<string, never> };

export type Effect =
  | { requestClose: { id: string; reason: CloseReason } }
  | { restoreFocus: { to: string | null } }
  | { passToScreen: { key: 'Escape' } }
  /** Nothing under the tooltips took the Back: the platform goes back a screen. */
  | { passToPlatform: Record<string, never> };

/** The overlay stack has no settings. */
export type Params = Record<string, never>;

const EVENT_NAMES = ['open', 'closed', 'escape', 'pressOutside', 'tab', 'back'] as const;

export const DEFAULT_PARAMS: Params = {};

export function initialOverlayStack(_params: Params = DEFAULT_PARAMS): State {
  return { layers: [] };
}

/** `layerId` and the ids of the layers that own it, innermost first. */
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

/** The layers owned by `layerId`, directly or not, topmost (innermost) first. */
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
  // The layers are copied so the rule-17 inheritance below never writes into the caller's state.
  const next: State = { layers: state.layers.map((layer) => ({ ...layer })) };
  const effects: Effect[] = [];
  const { layers } = next;

  if ('open' in event) {
    const layer: Layer = { ...event.open.layer };
    const ids = new Set(layers.map((item) => item.id));
    // Rule 2: opening a layer whose id is already in the stack does nothing.
    if (!ids.has(layer.id)) {
      // Rule 19: a parent or openerLayer that is not in the stack is stored as null.
      if (layer.parent !== null && !ids.has(layer.parent)) layer.parent = null;
      if (layer.openerLayer !== null && !ids.has(layer.openerLayer)) layer.openerLayer = null;
      // Rule 1: layers stack in the order they open, and a tooltip always sits
      // on top: anything else goes just below the tooltips.
      let at = layers.length;
      if (layer.kind !== 'tooltip') {
        while (at > 0 && layers[at - 1].kind === 'tooltip') at -= 1;
      }
      layers.splice(at, 0, layer);
    }
  } else if ('escape' in event) {
    if (event.escape.composing || event.escape.focusOwnsEscape) {
      // Rule 18: Escape during composition never reaches the stack, and a
      // focused control that owns Escape gets it first.
    } else {
      const tooltips = layers.filter((layer) => layer.kind === 'tooltip').reverse();
      const others = layers.filter((layer) => layer.kind !== 'tooltip');
      if (tooltips.length > 0) {
        // Rule 4: a tooltip takes the Escape: every tooltip is asked to close,
        // topmost first, and the key goes no further.
        for (const layer of tooltips) {
          effects.push({ requestClose: { id: layer.id, reason: 'escape' } });
        }
      } else if (others.length > 0) {
        // Rule 3: Escape asks the topmost layer to close, one layer per Escape.
        effects.push({ requestClose: { id: others[others.length - 1].id, reason: 'escape' } });
      } else {
        // Rule 5: with nothing open, the screen gets the key.
        effects.push({ passToScreen: { key: 'Escape' } });
      }
    }
  } else if ('pressOutside' in event) {
    // Rule 6: a press is inside a layer when it lands in it or in any layer it owns.
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
  } else if ('back' in event) {
    const tooltips = layers.filter((layer) => layer.kind === 'tooltip').reverse();
    const others = layers.filter((layer) => layer.kind !== 'tooltip');
    // Rule 20: a tooltip never takes the Back: every tooltip is asked to close,
    // topmost first, and the Back carries on.
    for (const layer of tooltips) {
      effects.push({ requestClose: { id: layer.id, reason: 'back' } });
    }
    if (others.length > 0) {
      // Rule 20: Back asks the topmost layer under the tooltips to close, one per Back.
      effects.push({ requestClose: { id: others[others.length - 1].id, reason: 'back' } });
    } else {
      // Rule 21: with no layer open under the tooltips, the platform goes back.
      effects.push({ passToPlatform: {} });
    }
  } else if ('tab' in event) {
    // Rule 11: Tab closes a menu that is topmost under the tooltips; otherwise nothing.
    const others = layers.filter((layer) => layer.kind !== 'tooltip');
    if (others.length > 0 && others[others.length - 1].kind === 'menu') {
      effects.push({ requestClose: { id: others[others.length - 1].id, reason: 'tab' } });
    }
  } else if ('closed' in event) {
    const { id, openerPresent, focus } = event.closed;
    // Rule 12: a layer leaves the stack only when its owner reports closed.
    const at = layers.findIndex((layer) => layer.id === id);
    if (at !== -1) {
      const target = layers[at];
      // Rule 13: the layers it owns are told to close (a command), innermost
      // first, and leave with it.
      const children = descendants(layers, target.id);
      for (const child of children) {
        effects.push({ requestClose: { id: child.id, reason: 'parentClosed' } });
      }
      const gone = new Map<string, Layer>([[target.id, target]]);
      for (const child of children) gone.set(child.id, child);
      const above = layers.slice(at + 1);
      next.layers = layers.filter((layer) => !gone.has(layer.id));
      // Rule 17: a layer whose opener was inside a closed layer takes over that
      // layer's opener and openerLayer.
      for (const layer of next.layers) {
        while (layer.openerLayer !== null && gone.has(layer.openerLayer)) {
          const source = gone.get(layer.openerLayer) as Layer;
          layer.opener = source.opener;
          layer.openerLayer = source.openerLayer;
        }
      }
      const remaining = new Set(next.layers.map((layer) => layer.id));
      const underModal = above.some(
        (layer) => (layer.kind === 'dialog' || layer.kind === 'sheet') && remaining.has(layer.id),
      );
      if (target.kind === 'tooltip') {
        // Rule 15: closing a tooltip moves no focus.
      } else if (underModal) {
        // Rule 16: never restore focus beneath a dialog or sheet that is still open.
      } else if (focus === 'inside' || focus === 'lost') {
        // Rule 14: focus inside the layer or lost goes to the opener if it is
        // still on the page, else the layer the opener was in, else the screen.
        const to =
          openerPresent && target.opener !== null
            ? target.opener
            : target.openerLayer !== null && remaining.has(target.openerLayer)
              ? target.openerLayer
              : null;
        effects.push({ restoreFocus: { to } });
      }
      // Rule 14: focus the user moved outside the layer stays where it is.
    }
    // Rule 15: a closed event for an id not in the stack does nothing.
  }

  return { state: next, effects };
}
