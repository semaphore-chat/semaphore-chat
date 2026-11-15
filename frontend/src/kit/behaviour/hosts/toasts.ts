import { useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  DEFAULT_PARAMS,
  initialToastQueue,
  stepToastQueue,
  type Effect,
  type Event,
  type Params,
  type State,
  type ToastTone,
} from '../toastQueue';
import type { Announcer } from './announcer';
import { BehaviourHostContext, useBehaviourHost } from './hostContext';
import type { Ids } from './ids';
import { createMachine, type Machine } from './machine';
import { canTakeFocus, type OverlayHost } from './overlay';
import type { RouterHandlers } from './router';
import type { TimerService } from './timers';

/** What a screen asks for: one notice. */
export interface ToastRequest {
  /** One id per subject (`'offline'`, `` `upload-${fileId}` ``): showing it again replaces it. Default: a fresh id. */
  id?: string;
  /** `'neutral'` by default. */
  tone?: ToastTone;
  message: string;
  /**
   * One action, shown as a text button. Pressing it dismisses the toast, then runs `onAction`, so a follow-up
   * the action shows under the same id stays. A throw or a rejected promise is reported, never left unhandled.
   */
  action?: { label: string; onAction: () => void | Promise<unknown> };
}

export interface Toasts {
  /** Shows a toast, or queues it behind the one showing. Returns its id. */
  show(toast: ToastRequest): string;
  /** Takes the toast away, showing or waiting. An id that is not there does nothing. */
  dismiss(id: string): void;
}

/** Why the toast area holds its timer (the pattern's rule 15). */
export type PauseReason = 'pointer' | 'focus' | 'hidden' | 'modal';

export interface ToastHost {
  readonly machine: Machine<State, Event>;
  /** What `useToasts` returns: one object for the life of the host. */
  readonly toasts: Toasts;
  /** F6, focus tracking, the window hidden or blurred: for the document router. */
  readonly handlers: RouterHandlers;
  /** Whether this reason to pause holds. The host sends one `pause` and one `resume` for all of them. */
  setReason(reason: PauseReason, holds: boolean): void;
  reasons(): ReadonlySet<PauseReason>;
  /** The region element while a toast shows (`ToastRegion` sets it). */
  setRegion(region: HTMLElement | null): void;
  /** The toast's action was pressed: dismiss, then run it. */
  act(id: string): void;
  /** Elements the region must sit above (a composer, the stage controls). */
  addClearance(ref: RefObject<HTMLElement | null>): () => void;
  clearances(): HTMLElement[];
  /** Called when a clearance is added, removed, or its element appears or goes, so the region measures again. */
  onLayout(listener: () => void): () => void;
  /** A clearance's element changed (it mounted later, or went). */
  clearanceChanged(): void;
  /** Starts following the overlay stack and the queue; returns the function that stops it (and its timers). */
  connect(): () => void;
}

export interface ToastHostOptions {
  ids: Ids;
  timers: TimerService;
  announcer: Announcer;
  /** For the modal reason (a dialog or sheet in the stack) and the last focus fallback. */
  overlay: Pick<OverlayHost, 'machine' | 'focusScreen'>;
  doc: Document;
  params?: Params;
  /** Where an action that throws or rejects is reported; the queue carries on. */
  onError?: (error: unknown) => void;
}

function reportToConsole(error: unknown): void {
  console.error(error);
}

const MODAL_KINDS = new Set(['dialog', 'sheet']);

export function createToastHost(options: ToastHostOptions): ToastHost {
  const { ids, timers, announcer, overlay, doc, params = DEFAULT_PARAMS, onError = reportToConsole } = options;
  // The key of this machine's timers: another machine may hand out the same tokens.
  const owner = {};
  const actions = new Map<string, () => void | Promise<unknown>>();
  // Ids being shown right now: their action is stored before the toast is in the state (M6).
  const pending = new Set<string>();
  const reasons = new Set<PauseReason>();
  const clearanceRefs: Array<RefObject<HTMLElement | null>> = [];
  const layoutListeners = new Set<() => void>();
  let region: HTMLElement | null = null;
  // The element focused last outside the region: where focus goes back to.
  let before: Element | null = null;
  let blurred = false;

  const machine: Machine<State, Event> = createMachine<State, Event, Effect, Params>(
    stepToastQueue,
    initialToastQueue(params),
    params,
    (effect, send) => {
      if ('startTimer' in effect) {
        const { token, ms } = effect.startTimer;
        const fire = () => send({ timerFired: { token } });
        if (machine.getState().waits.includes(token)) {
          // Rule 17: a wait that ends at the same moment as the showing toast's timer goes second, so the
          // toast whose turn has come shows. Deliver it one task later, under the same key: if the toast is
          // promoted first, the reducer's cancelTimer cancels this too.
          timers.start(owner, token, ms, () => timers.start(owner, token, 0, fire));
        } else {
          timers.start(owner, token, ms, fire);
        }
      } else if ('cancelTimer' in effect) {
        timers.cancel(owner, effect.cancelTimer.token);
      } else if ('announce' in effect) {
        const { message, politeness, action } = effect.announce;
        announcer.say(action === null ? message : `${message}. ${action}`, politeness);
      } else if ('returnFocus' in effect) {
        returnFocus();
      }
    },
  );

  function returnFocus(): void {
    if (canTakeFocus(before) && !(region?.contains(before) ?? false)) {
      before.focus({ preventScroll: true });
      if (doc.activeElement === before) return;
    }
    overlay.focusScreen();
  }

  function focusInside(): boolean {
    return region !== null && region.contains(doc.activeElement);
  }

  function setReason(reason: PauseReason, holds: boolean): void {
    const had = reasons.size;
    if (holds) reasons.add(reason);
    else reasons.delete(reason);
    if (had === 0 && reasons.size > 0) machine.send({ pause: {} });
    else if (had > 0 && reasons.size === 0) machine.send({ resume: {} });
  }

  const isModalOpen = () => overlay.machine.getState().layers.some((layer) => MODAL_KINDS.has(layer.kind));
  const hiddenNow = () => doc.visibilityState === 'hidden' || blurred;

  // Rule 13: a toast that shows from empty while a reason holds is paused
  // again. When the last toast leaves, the region goes, and the pointer and
  // focus cannot be on it any more (no leave or blur event comes for a removed
  // element). The actions of toasts that are gone are forgotten here too.
  function connect(): () => void {
    let shown = machine.getState().showing !== null;
    const offMachine = machine.subscribe(() => {
      const state = machine.getState();
      const now = state.showing !== null;
      if (!shown && now && reasons.size > 0) machine.send({ pause: {} });
      if (shown && !now) {
        reasons.delete('pointer');
        reasons.delete('focus');
      }
      shown = now;
      const live = new Set([state.showing?.id, ...state.queue.map((toast) => toast.id)]);
      [...actions.keys()].forEach((id) => {
        if (!live.has(id) && !pending.has(id)) actions.delete(id);
      });
    });
    const offOverlay = overlay.machine.subscribe(() => setReason('modal', isModalOpen()));
    setReason('modal', isModalOpen());
    setReason('hidden', hiddenNow());
    // The timers are left running: they belong to the machine, which outlives a connection, and a reconnect
    // (StrictMode runs effects twice) could not restore them. A late one only steps the machine.
    return () => {
      offMachine();
      offOverlay();
    };
  }

  const toasts: Toasts = {
    show({ id, tone = 'neutral', message, action }) {
      const toastId = id ?? ids.next('toast');
      if (action === undefined) actions.delete(toastId);
      else actions.set(toastId, action.onAction);
      pending.add(toastId);
      try {
        machine.send({
          show: { toast: { id: toastId, tone, message, action: action?.label ?? null } },
        });
      } finally {
        pending.delete(toastId);
      }
      return toastId;
    },
    dismiss(id) {
      machine.send({ dismiss: { id, focusInside: focusInside() } });
    },
  };

  const handlers: RouterHandlers = {
    keydown(event) {
      if (event.key !== 'F6' || event.ctrlKey || event.altKey || event.metaKey) return;
      // Under a modal the region is hidden from the keyboard (it is a page sibling the modal hides).
      if (isModalOpen() || region === null || !region.isConnected) return;
      event.preventDefault();
      if (focusInside()) returnFocus();
      else region.focus({ preventScroll: true });
    },
    focusin(event) {
      const target = event.target;
      if (target instanceof Element && !(region?.contains(target) ?? false)) before = target;
    },
    visibilitychange() {
      setReason('hidden', hiddenNow());
    },
    blur(event) {
      // Only the window's own blur: an element's blur that reaches the window listener is not one.
      if (event.target instanceof Node) return;
      blurred = true;
      setReason('hidden', hiddenNow());
    },
    focus(event) {
      if (event.target instanceof Node) return;
      blurred = false;
      setReason('hidden', hiddenNow());
    },
  };

  return {
    machine,
    toasts,
    handlers,
    setReason,
    reasons: () => reasons,
    setRegion(element) {
      region = element;
    },
    act(id) {
      const action = actions.get(id);
      // Dismiss first: a follow-up the action shows under the same id then replaces nothing and stays.
      machine.send({ dismiss: { id, focusInside: focusInside() } });
      try {
        const result = action?.();
        if (result !== undefined && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(undefined, onError);
        }
      } catch (error) {
        onError(error);
      }
    },
    addClearance(ref) {
      clearanceRefs.push(ref);
      layoutListeners.forEach((listener) => listener());
      return () => {
        const at = clearanceRefs.indexOf(ref);
        if (at !== -1) clearanceRefs.splice(at, 1);
        layoutListeners.forEach((listener) => listener());
      };
    },
    clearances: () =>
      clearanceRefs.map((ref) => ref.current).filter((element): element is HTMLElement => element !== null),
    clearanceChanged() {
      layoutListeners.forEach((listener) => listener());
    },
    onLayout(listener) {
      layoutListeners.add(listener);
      return () => {
        layoutListeners.delete(listener);
      };
    },
    connect,
  };
}

/** Joins two sets of router handlers: both are called, `first` first. */
export function joinHandlers(first: RouterHandlers, second: RouterHandlers): RouterHandlers {
  const joined: RouterHandlers = { ...first };
  (Object.keys(second) as Array<keyof RouterHandlers>).forEach((name) => {
    const a = first[name] as ((event: never) => void) | undefined;
    const b = second[name] as ((event: never) => void) | undefined;
    if (a === undefined || b === undefined) {
      (joined as Record<string, unknown>)[name] = a ?? b;
      return;
    }
    (joined as Record<string, unknown>)[name] = (event: never) => {
      a(event);
      b(event);
    };
  });
  return joined;
}

/**
 * For screens: show and dismiss toasts. The object is the same for the life of
 * the page, so it can sit in effect dependencies; it works before the toast
 * region has mounted. Call it from event handlers and effects, never while
 * rendering. Never render a `Toast` yourself.
 */
export function useToasts(): Toasts {
  return useBehaviourHost().toasts.toasts;
}

/**
 * For a bottom-pinned element in the screen's main island (a composer, the
 * stage controls): toasts sit above it rather than over it.
 */
export function useToastClearance(ref: RefObject<HTMLElement | null>): void {
  const host = useContext(BehaviourHostContext);
  useEffect(() => host?.toasts.addClearance(ref), [host, ref]);
  // The element can mount later or go (a settings footer that appears with unsaved changes): tell the host.
  const last = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (ref.current === last.current) return;
    last.current = ref.current;
    host?.toasts.clearanceChanged();
  });
}
