import { createElement, useEffect, useLayoutEffect, useState, useSyncExternalStore, type JSX } from 'react';
import {
  initialConfirmDestructive,
  stepConfirmDestructive,
  type CancelReason,
  type Effect,
  type Event,
  type Params,
  type Phase,
  type State,
} from '../confirmDestructive';
import { ConfirmDialog } from '../../overlays/ConfirmDialog';
import { useBehaviourHost } from './hostContext';
import { createMachine, type Machine } from './machine';
import type { ToastRequest } from './toasts';
import type { TimerService } from './timers';

export interface ConfirmDestructiveOptions {
  /** Names what is lost: "Delete #general?". */
  title: string;
  /** What goes with it: "This removes 214 messages for everyone." */
  description: string;
  /** The confirm button, and the retry button after a failure: "Delete channel". */
  confirmLabel: string;
  /**
   * The action. A rejection is a failure; the dialog stays open with its message.
   * The signal aborts when the answer no longer counts: a timeout, or the screen going away.
   */
  run: (signal: AbortSignal) => Promise<void>;
  /** The text shown when `run` rejects. Default: "Couldn't finish that. Try again." */
  errorMessage?: (error: unknown) => string;
  /** The text shown when `run` does not answer in time. Default: `TIMEOUT_MESSAGE`. */
  timeoutMessage?: string;
  /** Called after the dialog has closed and focus has gone back, when `run` succeeded. */
  onDone?: () => void;
  /** How long `run` may take before it counts as failed. Default 30 000. */
  timeoutMs?: number;
}

export interface ConfirmDestructive {
  /** Opens the dialog (nothing happens while it is open). Wire it to the dangerous button or menu item. Stable. */
  request: () => void;
  /** Render this once, anywhere in the screen's tree. */
  dialog: JSX.Element;
  phase: Phase;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_ERROR_MESSAGE = "Couldn't finish that. Try again.";
/** The result of a timed-out action is unknown, so the user checks before trying again. */
export const TIMEOUT_MESSAGE = "This is taking too long. It may still have worked, so check before you try again.";
const NO_PARAMS: Params = {};

/** The abort reason `run`'s signal carries when the action did not answer in time. */
export class ConfirmTimeoutError extends Error {
  constructor() {
    super('The action timed out');
    this.name = 'ConfirmTimeoutError';
  }
}

export interface ConfirmController {
  machine: Machine<State, Event>;
  /** Replaces the options the next run and result use (the latest render's). */
  setOptions(options: ConfirmDestructiveOptions): void;
  /** True once after a `done` effect: the screen is to be told, when the dialog has closed. */
  takeDone(): boolean;
  /**
   * The dialog went away without an answer: the layer it was opened from
   * closed and took it along, or the dialog left the page. Before the action
   * and after a failure that is a cancel. While the action works the run goes
   * on: success is `done` as usual; failure goes to a danger toast (the dialog that
   * would show it has gone) and the confirmation closes, so `request` works again.
   */
  viewGone(): void;
  /** The dialog is on the page again (its parent reopened while the action works): a failure shows in it. */
  viewBack(): void;
  /** The host's view is gone: a run in flight is reported as failed, its timer and late result dropped. */
  dispose(): void;
  /** Undo `dispose` (React strict mode runs a cleanup and a setup again). */
  revive(): void;
}

/**
 * The confirm host's machine: applies `run` (with a timeout, exactly one result
 * per attempt) and `done`. Pure of React, so a test can drive it with a fake
 * timer service.
 */
export function createConfirmController(
  initial: ConfirmDestructiveOptions,
  timers: TimerService,
  notify: (request: ToastRequest) => void,
  notifyId: string,
): ConfirmController {
  const owner = {};
  let options = initial;
  let disposed = false;
  let done = false;
  // The dialog went with its parent while the action worked: a failure has nowhere to show.
  let parentGone = false;
  // The attempt whose result has not been reported yet; at most one is ever open.
  let open: { attempt: number; report: (event: Event) => void; abort: AbortController } | null = null;

  const machine: Machine<State, Event> = createMachine<State, Event, Effect, Params>(
    stepConfirmDestructive,
    initialConfirmDestructive(NO_PARAMS),
    NO_PARAMS,
    (effect, send) => {
      if ('done' in effect) {
        done = true;
        return;
      }
      const { attempt } = effect.run;
      const abort = new AbortController();
      let settled = false;
      const report = (event: Event): void => {
        // Exactly one result per run: a late answer after a timeout stops here.
        if (settled) return;
        settled = true;
        timers.cancel(owner, attempt);
        if (open?.attempt === attempt) open = null;
        const gone = parentGone;
        parentGone = false;
        send(event);
        if (gone && 'failed' in event) {
          // Rule 7 keeps a failure open, but its dialog has gone with its parent: close it, so a
          // later request() works, and tell the user through a toast instead.
          send({ cancel: { reason: 'button' } });
          notify({ id: notifyId, tone: 'danger', message: event.failed.message });
        }
      };
      const fail = (error: unknown): void => {
        let message: string;
        try {
          message = (options.errorMessage ?? (() => DEFAULT_ERROR_MESSAGE))(error);
        } catch {
          message = DEFAULT_ERROR_MESSAGE;
        }
        report({ failed: { attempt, message } });
      };
      open = { attempt, report, abort };
      timers.start(owner, attempt, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
        abort.abort(new ConfirmTimeoutError());
        report({ failed: { attempt, message: options.timeoutMessage ?? TIMEOUT_MESSAGE } });
      });
      let running: Promise<void>;
      try {
        running = Promise.resolve(options.run(abort.signal));
      } catch (error) {
        running = Promise.reject(error);
      }
      running.then(
        () => report({ succeeded: { attempt } }),
        (error: unknown) => fail(error),
      );
    },
  );

  return {
    machine,
    setOptions(next) {
      options = next;
    },
    takeDone() {
      const was = done;
      done = false;
      return was;
    },
    viewBack() {
      parentGone = false;
    },
    viewGone() {
      const { phase } = machine.getState();
      if (phase === 'working') parentGone = true;
      else if (phase !== 'idle') machine.send({ cancel: { reason: 'button' } });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // An unmount while working counts as a failed run, reported once. Nobody is left to tell:
      // the action may still finish on the server, so no toast claims it failed.
      parentGone = false;
      const running = open;
      running?.abort.abort();
      running?.report({ failed: { attempt: running.attempt, message: DEFAULT_ERROR_MESSAGE } });
      // Defence only: reporting the open run already cancelled its timer.
      timers.disposeAll(owner);
    },
    revive() {
      disposed = false;
    },
  };
}

/**
 * Asks before an irreversible action, runs it, and keeps the dialog open with the
 * error when it fails (`design/guide/behaviour.md`, "Confirm destructive").
 *
 * ```tsx
 * const remove = useConfirmDestructive({ title: 'Delete #general?', ... });
 * <Button variant="danger" onClick={remove.request}>Delete</Button>
 * {remove.dialog}
 * ```
 * From a Menu item pass `onSelect: remove.request`: the dialog lives in the
 * screen's tree, and focus goes back to the menu's button when it closes.
 *
 * React `<Activity>` hiding the screen while the action works runs the
 * cleanups: the run counts as failed (no notice: it may still finish) and the
 * dialog, gone from the page, is cancelled, so it comes back closed.
 */
export function useConfirmDestructive(options: ConfirmDestructiveOptions): ConfirmDestructive {
  const host = useBehaviourHost();
  const [{ controller, handlers }] = useState(() => {
    const created = createConfirmController(
      options,
      host.timers,
      (request) => host.toasts.toasts.show(request),
      host.ids.next('confirm'),
    );
    const { machine } = created;
    return {
      controller: created,
      // Made once, so `request` can sit in an effect's deps or a memoised menu.
      handlers: {
        request: () => machine.send({ request: {} }),
        confirm: () => machine.send({ confirm: {} }),
        cancel: (reason: CancelReason) => machine.send({ cancel: { reason } }),
        presence: (present: boolean) => (present ? created.viewBack() : created.viewGone()),
      },
    };
  });
  const { machine } = controller;
  const state = useSyncExternalStore(machine.subscribe, machine.getState);

  useLayoutEffect(() => {
    controller.setOptions(options);
  });
  useEffect(() => {
    controller.revive();
    return () => controller.dispose();
  }, [controller]);
  // After the dialog's layer has closed (its cleanup runs in the same commit, first) and focus has moved.
  useEffect(() => {
    if (state.phase === 'idle' && controller.takeDone()) options.onDone?.();
  });

  const dialog = createElement(ConfirmDialog, {
    phase: state.phase,
    error: state.error,
    title: options.title,
    description: options.description,
    confirmLabel: options.confirmLabel,
    onConfirm: handlers.confirm,
    onCancel: handlers.cancel,
    onPresence: handlers.presence,
  });
  return { request: handlers.request, dialog, phase: state.phase };
}
