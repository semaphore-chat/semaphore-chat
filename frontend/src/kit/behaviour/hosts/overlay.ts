import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  initialOverlayStack,
  stepOverlayStack,
  type CloseReason,
  type Effect,
  type Event,
  type FocusPosition,
  type Layer,
  type LayerKind,
  type State,
} from '../overlayStack';
import { useBehaviourHost } from './hostContext';
import type { Ids } from './ids';
import { createMachine, type Machine } from './machine';
import type { RouterHandlers } from './router';

/**
 * The overlay-stack host (`design/guide/behaviour.md`, "Overlay stack" and
 * "What a host does"). Every kit overlay registers a layer through
 * `useOverlayLayer`. One set of document listeners turns Escape, Tab and
 * presses into the reducer's events, and the host applies its effects: it asks
 * an owner to close, moves focus back, or runs the screen's Escape chain.
 *
 * MUI still draws the overlays, traps Tab inside a modal, locks the scroll and
 * hides the page from assistive technology. It no longer decides anything: the
 * overlays turn off its Escape handling, its focus restore and its close
 * reasons.
 */

/** What a layer gives the host. */
export interface LayerOptions {
  kind: LayerKind;
  open: boolean;
  /** The layer's own box: presses in it are inside, focus in it is inside, and it is the layer's focus target. */
  panel: RefObject<HTMLElement | null>;
  /**
   * The whole layer as drawn, when it is more than the panel: focus anywhere in
   * it is inside the layer. A modal's container takes focus on a press on the
   * scrim, yet that press is outside the panel.
   */
  root?: RefObject<HTMLElement | null>;
  /** Also counts as inside for a press: a Popover's anchor. */
  inside?: ReadonlyArray<HTMLElement | null>;
  /**
   * The element focus returns to. Default: the element that has focus as the
   * layer opens. A tooltip never has one.
   */
  opener?: HTMLElement | null;
  /** The host asks the owner to close. Every reason but `parentClosed` may be refused. */
  onRequestClose: (reason: CloseReason) => void;
}

export interface LayerHandle {
  /** The layer's id: provide it as `LayerContext` to what the layer holds. */
  id: string;
  /** The layer that owns this one has closed: render closed until `open` goes false and true again. */
  forcedClosed: boolean;
}

/** The id of the layer a component renders inside: the `parent` of a layer it opens. Crosses portals. */
export const LayerContext = createContext<string | null>(null);

/** Screens: the order of the Escape chain. Lower runs first. */
export const ESCAPE_PRIORITY = { panel: 10, conversation: 100 } as const;

interface Registration {
  kind: LayerKind;
  panel: () => HTMLElement | null;
  root: () => HTMLElement | null;
  inside: () => ReadonlyArray<HTMLElement | null>;
  onRequestClose: (reason: CloseReason) => void;
}

interface ScreenEscape {
  handler: () => boolean;
  priority: number;
  order: number;
}

export interface OverlayHost {
  readonly machine: Machine<State, Event>;
  /** The document listeners, for the router. */
  readonly handlers: RouterHandlers;
  /** A layer appeared. `opener` is the element focus returns to, or null. */
  open(id: string, registration: Registration, opener: Element | null, parent: string | null): void;
  /** A layer has gone (its owner closed it, or it unmounted). */
  closed(id: string): void;
  addScreenEscape(handler: () => boolean, priority: number): () => void;
  addScreenFocusTarget(ref: RefObject<HTMLElement | null>): () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tryFocus(doc: Document, element: Element | null | undefined): boolean {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  element.focus({ preventScroll: true });
  return doc.activeElement === element;
}

export function createOverlayHost(options: {
  ids: Ids;
  doc: Document;
  /** The stack changed: Escape should come to this host. */
  onOpen: () => void;
}): OverlayHost {
  const { ids, doc, onOpen } = options;
  const registry = new Map<string, Registration>();
  const openers = new Map<string, Element>();
  const screenEscapes: ScreenEscape[] = [];
  const focusTargets: Array<RefObject<HTMLElement | null>> = [];
  let escapeOrder = 0;
  // Counted per step, so the keydown handler knows whether the key was used.
  let closeRequests = 0;
  let screenTook = false;
  // Non-tooltip layers opened so far: a press during which one opened is not a press on it.
  let opened = 0;
  let press: { insideId: string | null; opened: number } | null = null;
  // Layers told to close by `parentClosed` that have not gone yet, and the focus
  // move waiting for them: a closing child modal still traps focus until it goes.
  const closing = new Set<string>();
  let waitingRestore: { to: string | null } | null = null;

  function screenTarget(): void {
    const target = focusTargets[focusTargets.length - 1]?.current;
    if (tryFocus(doc, target)) return;
    tryFocus(doc, doc.querySelector('main, [role="main"]'));
  }

  function restoreFocus(to: string | null): void {
    if (to !== null) {
      const opener = openers.get(to);
      if (opener !== undefined && tryFocus(doc, opener)) return;
      const panel = registry.get(to)?.panel();
      if (panel?.isConnected === true && tryFocus(doc, panel.querySelector(FOCUSABLE) ?? panel)) return;
    }
    screenTarget();
  }

  function apply(effect: Effect): void {
    if ('requestClose' in effect) {
      closeRequests += 1;
      const { id, reason } = effect.requestClose;
      if (reason === 'parentClosed' && registry.has(id)) closing.add(id);
      registry.get(id)?.onRequestClose(reason);
    } else if ('restoreFocus' in effect) {
      if (closing.size > 0) waitingRestore = { to: effect.restoreFocus.to };
      else restoreFocus(effect.restoreFocus.to);
    } else if ('passToScreen' in effect) {
      const chain = [...screenEscapes].sort((a, b) => a.priority - b.priority || a.order - b.order);
      screenTook = chain.some((entry) => entry.handler());
    }
  }

  const machine = createMachine(stepOverlayStack, initialOverlayStack(), {}, apply);

  /** The topmost layer whose panel (or, for a press, its `inside` elements) holds `target`. */
  function layerAt(target: EventTarget | null, forPress: boolean): string | null {
    if (!(target instanceof Node)) return null;
    const { layers } = machine.getState();
    for (let i = layers.length - 1; i >= 0; i--) {
      const registration = registry.get(layers[i].id);
      if (registration === undefined) continue;
      if (registration.panel()?.contains(target) === true) return layers[i].id;
      if (forPress && registration.inside().some((element) => element?.contains(target) === true)) {
        return layers[i].id;
      }
    }
    return null;
  }

  /** `id` and every layer it owns, however deep. */
  function family(layers: readonly Layer[], id: string): string[] {
    const ids = new Set([id]);
    for (const layer of layers) {
      if (layer.parent !== null && ids.has(layer.parent)) ids.add(layer.id);
    }
    return [...ids];
  }

  function focusPosition(layers: readonly Layer[], id: string): FocusPosition {
    const active = doc.activeElement;
    if (active === null || active === doc.body || !active.isConnected) return 'lost';
    const inside = family(layers, id).some((member) => {
      const registration = registry.get(member);
      return registration?.panel()?.contains(active) === true || registration?.root()?.contains(active) === true;
    });
    return inside ? 'inside' : 'outside';
  }

  function pruneOpeners(): void {
    const used = new Set(machine.getState().layers.map((layer) => layer.opener));
    if (waitingRestore !== null) used.add(waitingRestore.to);
    for (const key of openers.keys()) {
      if (!used.has(key)) openers.delete(key);
    }
  }

  const handlers: RouterHandlers = {
    keydown(event) {
      if (event.key === 'Escape') {
        closeRequests = 0;
        screenTook = false;
        machine.send({
          escape: {
            composing: event.isComposing || event.keyCode === 229,
            focusOwnsEscape: event.defaultPrevented,
          },
        });
        // Used: old window listeners (and the browser) skip it.
        if (closeRequests > 0 || screenTook) event.preventDefault();
      } else if (event.key === 'Tab') {
        closeRequests = 0;
        machine.send({ tab: {} });
        // Tab closed a menu: focus goes back to the opener, not on to the next control.
        if (closeRequests > 0) event.preventDefault();
      }
    },
    pointerdown(event) {
      press = { insideId: layerAt(event.target, true), opened };
    },
    pointerup(event) {
      const down = press;
      press = null;
      // A press is down and up in the same layer, with no layer opened in between
      // (a select list opens on pointerdown, under the pointer).
      if (down === null || down.opened !== opened) return;
      const insideId = layerAt(event.target, true);
      if (insideId !== down.insideId) return;
      machine.send({ pressOutside: { insideId } });
    },
    pointercancel() {
      press = null;
    },
  };

  return {
    machine,
    handlers,
    open(id, registration, opener, parent) {
      registry.set(id, registration);
      const tooltip = registration.kind === 'tooltip';
      const openerElement = tooltip ? null : opener;
      let openerId: string | null = null;
      if (openerElement !== null) {
        openerId = ids.forElement(openerElement);
        openers.set(openerId, openerElement);
      }
      const openerLayer = openerElement === null ? null : layerAt(openerElement, false);
      if (!tooltip) opened += 1;
      machine.send({ open: { layer: { id, kind: registration.kind, parent, opener: openerId, openerLayer } } });
      onOpen();
    },
    closed(id) {
      const { layers } = machine.getState();
      const layer = layers.find((item) => item.id === id);
      if (layer === undefined) {
        // Already gone (a parent closed it): nothing to report. The last of those
        // children to go lets the parent's focus move happen.
        registry.delete(id);
        if (closing.delete(id) && closing.size === 0 && waitingRestore !== null) {
          const { to } = waitingRestore;
          waitingRestore = null;
          restoreFocus(to);
        }
        return;
      }
      const opener = layer.opener === null ? undefined : openers.get(layer.opener);
      const focus = focusPosition(layers, id);
      machine.send({ closed: { id, openerPresent: opener?.isConnected === true, focus } });
      registry.delete(id);
      pruneOpeners();
    },
    addScreenEscape(handler, priority) {
      escapeOrder += 1;
      const entry = { handler, priority, order: escapeOrder };
      screenEscapes.push(entry);
      return () => {
        const at = screenEscapes.indexOf(entry);
        if (at !== -1) screenEscapes.splice(at, 1);
      };
    },
    addScreenFocusTarget(ref) {
      focusTargets.push(ref);
      return () => {
        const at = focusTargets.lastIndexOf(ref);
        if (at !== -1) focusTargets.splice(at, 1);
      };
    },
  };
}

/**
 * Makes a kit overlay a layer of the stack. The opener is read in the render
 * that opens the layer, before any effect inside can move focus (MUI's list
 * focuses its first item in a layout effect when a menu reopens during its exit
 * fade). The layer opens in a layout effect, so it is in the stack before
 * anything inside takes focus. It reports `closed` in a passive effect's cleanup: after MUI's focus
 * trap of a closing modal has let go (its effects are inside, so they clean up
 * first), and after a layer opened in the same commit (a Dialog from a Menu
 * item) has joined the stack.
 */
export function useOverlayLayer(options: LayerOptions): LayerHandle {
  const { overlay, ids } = useBehaviourHost();
  const parent = useContext(LayerContext);
  const [id] = useState(() => ids.next('layer'));
  const [forced, setForced] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  const lastPanel = useRef<HTMLElement | null>(null);
  const lastRoot = useRef<HTMLElement | null>(null);
  const forcedClosed = forced && options.open;
  const shown = options.open && !forced;
  // `shown` as of the last commit, and the element focused in the render that opens the layer.
  const committed = useRef(false);
  const focusedAtOpen = useRef<Element | null>(null);
  if (shown && !committed.current) {
    focusedAtOpen.current = document.activeElement;
  }

  // A forced close lasts until the owner closes the layer itself.
  useEffect(() => {
    if (!options.open) setForced(false);
  }, [options.open]);

  useLayoutEffect(() => {
    committed.current = shown;
    if (!shown) return;
    const given = latest.current.opener;
    const active = focusedAtOpen.current;
    const opener = given ?? (active !== null && active !== document.body ? active : null);
    overlay.open(
      id,
      {
        kind: latest.current.kind,
        panel: () => {
          const element = latest.current.panel.current;
          if (element !== null) lastPanel.current = element;
          return element ?? lastPanel.current;
        },
        root: () => {
          const element = latest.current.root?.current ?? null;
          if (element !== null) lastRoot.current = element;
          return element ?? lastRoot.current;
        },
        inside: () => latest.current.inside ?? [],
        onRequestClose: (reason) => {
          if (reason === 'parentClosed') setForced(true);
          latest.current.onRequestClose(reason);
        },
      },
      opener,
      parent,
    );
    // `parent` is read once, as the layer opens: the stack holds it from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, overlay, id]);

  useEffect(() => {
    if (!shown) return undefined;
    return () => overlay.closed(id);
  }, [shown, overlay, id]);

  return { id, forcedClosed };
}

/**
 * For screens: a step of the Escape chain, run when Escape reaches the screen
 * (no layer is open). Steps run by ascending `priority` until one returns true
 * (it used the key). Use `ESCAPE_PRIORITY`.
 */
export function useScreenEscape(handler: () => boolean, priority: number): void {
  const { overlay } = useBehaviourHost();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => overlay.addScreenEscape(() => latest.current(), priority), [overlay, priority]);
}

/**
 * For screens: where focus goes when the layer it would return to has gone (the
 * composer on a chat screen). The last one mounted wins; without one, the
 * page's `main` landmark if it takes focus.
 */
export function useScreenFocusTarget(ref: RefObject<HTMLElement | null>): void {
  const { overlay } = useBehaviourHost();
  useEffect(() => overlay.addScreenFocusTarget(ref), [overlay, ref]);
}
