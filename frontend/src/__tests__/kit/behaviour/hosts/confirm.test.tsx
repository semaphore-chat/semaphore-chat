import { useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Menu, Popover, useConfirmDestructive, type ConfirmDestructiveOptions } from '../../../../kit';
import {
  createConfirmController,
  ConfirmTimeoutError,
  TIMEOUT_MESSAGE,
} from '../../../../kit/behaviour/hosts/confirm';
import { useBehaviourHost } from '../../../../kit/behaviour/hosts/hostContext';
import type { ToastRequest } from '../../../../kit';
import { ToastRegion } from '../../../../kit/display/ToastRegion';
import { createTimerService, type Scheduler } from '../../../../kit/behaviour/hosts/timers';
import { renderWithKit } from '../../../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  vi.useRealTimers();
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

/** A promise the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Timers the test fires by hand, so a controller test needs no clock. */
function manualTimers() {
  const pending = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  const scheduler: Scheduler = {
    set(callback, ms) {
      next += 1;
      pending.set(next, { callback, ms });
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    service: createTimerService(scheduler),
    count: () => pending.size,
    msOfOnly: () => [...pending.values()][0]?.ms,
    fireAll: () =>
      [...pending.entries()].forEach(([handle, entry]) => {
        pending.delete(handle);
        entry.callback();
      }),
  };
}

const options = (over: Partial<ConfirmDestructiveOptions> = {}): ConfirmDestructiveOptions => ({
  title: 'Delete #general?',
  description: 'This removes 214 messages for everyone.',
  confirmLabel: 'Delete channel',
  run: () => Promise.resolve(),
  ...over,
});

const flush = () => act(async () => {});
const noNotify = () => {};

describe('createConfirmController', () => {
  it('reports one result per run: a late answer after the timeout is dropped', async () => {
    const timers = manualTimers();
    const first = deferred();
    const run = vi.fn(() => first.promise);
    const controller = createConfirmController(options({ run }), timers.service, noNotify, 'confirm-1');
    const { machine } = controller;
    machine.send({ request: {} });
    machine.send({ confirm: {} });
    expect(machine.getState()).toMatchObject({ phase: 'working', attempt: 1 });
    timers.fireAll();
    expect(machine.getState()).toMatchObject({ phase: 'failed', error: TIMEOUT_MESSAGE });
    // The run answers late: nothing is sent to the machine for it (the reducer would be told, and listeners woken).
    const lateListener = vi.fn();
    const off = machine.subscribe(lateListener);
    first.resolve();
    await flush();
    expect(lateListener).not.toHaveBeenCalled();
    off();
    // The first run answers late, after the user has asked again.
    const second = deferred();
    run.mockReturnValueOnce(second.promise);
    machine.send({ confirm: {} });
    expect(machine.getState()).toMatchObject({ phase: 'working', attempt: 2 });
    await flush();
    expect(machine.getState()).toMatchObject({ phase: 'working', attempt: 2 });
    second.resolve();
    await flush();
    expect(machine.getState().phase).toBe('idle');
    expect(timers.count()).toBe(0);
  });

  it('uses the default of 30 seconds, and timeoutMs when given', () => {
    const a = manualTimers();
    const one = createConfirmController(options({ run: () => new Promise(() => {}) }), a.service, noNotify, 'confirm-1');
    one.machine.send({ request: {} });
    one.machine.send({ confirm: {} });
    expect(a.msOfOnly()).toBe(30_000);
    const b = manualTimers();
    const two = createConfirmController(options({ run: () => new Promise(() => {}), timeoutMs: 5_000 }), b.service, noNotify, 'confirm-1');
    two.machine.send({ request: {} });
    two.machine.send({ confirm: {} });
    expect(b.msOfOnly()).toBe(5_000);
  });

  it('a rejection fails with errorMessage, a synchronous throw too', async () => {
    const timers = manualTimers();
    const errorMessage = vi.fn((error: unknown) => `No: ${(error as Error).message}`);
    const controller = createConfirmController(
      options({
        run: () => {
          throw new Error('boom');
        },
        errorMessage,
      }),
      timers.service,
      noNotify,
      'confirm-1',
    );
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    await flush();
    expect(controller.machine.getState()).toMatchObject({ phase: 'failed', error: 'No: boom' });
    expect(errorMessage).toHaveBeenCalledTimes(1);
    expect(timers.count()).toBe(0);
  });

  it('a throwing errorMessage falls back to the default text', async () => {
    const timers = manualTimers();
    const controller = createConfirmController(
      options({
        run: () => Promise.reject(new Error('x')),
        errorMessage: () => {
          throw new Error('bad formatter');
        },
      }),
      timers.service,
      noNotify,
      'confirm-1',
    );
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    await flush();
    expect(controller.machine.getState()).toMatchObject({ phase: 'failed', error: "Couldn't finish that. Try again." });
  });

  it('a timeout shows the timeout text, not errorMessage, and aborts the signal with a ConfirmTimeoutError', () => {
    const timers = manualTimers();
    const errorMessage = vi.fn(() => "Couldn't delete the channel. Try again.");
    let signal: AbortSignal | undefined;
    const controller = createConfirmController(
      options({
        run: (s) => {
          signal = s;
          return new Promise(() => {});
        },
        errorMessage,
      }),
      timers.service,
      noNotify,
      'confirm-1',
    );
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    expect(signal?.aborted).toBe(false);
    timers.fireAll();
    expect(controller.machine.getState()).toMatchObject({ phase: 'failed', error: TIMEOUT_MESSAGE });
    expect(errorMessage).not.toHaveBeenCalled();
    expect(signal?.reason).toBeInstanceOf(ConfirmTimeoutError);
  });

  it('timeoutMessage replaces the timeout text', () => {
    const timers = manualTimers();
    const controller = createConfirmController(
      options({ run: () => new Promise(() => {}), timeoutMessage: 'Still deleting. Check the channel list before you try again.' }),
      timers.service,
      noNotify,
      'confirm-1',
    );
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    timers.fireAll();
    expect(controller.machine.getState().error).toBe('Still deleting. Check the channel list before you try again.');
  });

  it('dispose aborts the signal of the run in flight', () => {
    let signal: AbortSignal | undefined;
    const controller = createConfirmController(
      options({
        run: (s) => {
          signal = s;
          return new Promise(() => {});
        },
      }),
      manualTimers().service,
      noNotify,
      'confirm-1',
    );
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    controller.dispose();
    expect(signal?.aborted).toBe(true);
  });

  it('the view going while working: a failure goes to a danger toast and the confirmation closes, so request works again', async () => {
    const pending = deferred();
    const notified: ToastRequest[] = [];
    const controller = createConfirmController(
      options({ run: () => pending.promise, errorMessage: () => "Couldn't delete the channel. Try again." }),
      manualTimers().service,
      (request) => notified.push(request),
      'confirm-7',
    );
    const { machine } = controller;
    machine.send({ request: {} });
    machine.send({ confirm: {} });
    controller.viewGone();
    expect(machine.getState().phase).toBe('working');
    pending.reject(new Error('403'));
    await flush();
    expect(machine.getState()).toMatchObject({ phase: 'idle', error: null });
    expect(notified).toEqual([{ id: 'confirm-7', tone: 'danger', message: "Couldn't delete the channel. Try again." }]);
    machine.send({ request: {} });
    expect(machine.getState().phase).toBe('confirming');
  });

  it('the view going while working, then success: done as usual, no notice; a later failure in a shown dialog stays in it', async () => {
    const first = deferred();
    const notified: ToastRequest[] = [];
    const run = vi.fn(() => first.promise);
    const controller = createConfirmController(options({ run }), manualTimers().service, (r) => notified.push(r), 'confirm-1');
    const { machine } = controller;
    machine.send({ request: {} });
    machine.send({ confirm: {} });
    controller.viewGone();
    first.resolve();
    await flush();
    expect(machine.getState().phase).toBe('idle');
    expect(controller.takeDone()).toBe(true);
    // The mark does not outlive its run.
    run.mockReturnValueOnce(Promise.reject(new Error('no')));
    machine.send({ request: {} });
    machine.send({ confirm: {} });
    await flush();
    expect(machine.getState().phase).toBe('failed');
    expect(notified).toEqual([]);
  });

  it('the view going before the action or after a failure is a cancel; while idle it sends nothing', async () => {
    const controller = createConfirmController(
      options({ run: () => Promise.reject(new Error('no')) }),
      manualTimers().service,
      noNotify,
      'confirm-1',
    );
    const { machine } = controller;
    const listener = vi.fn();
    machine.subscribe(listener);
    controller.viewGone();
    expect(listener).not.toHaveBeenCalled();
    machine.send({ request: {} });
    controller.viewGone();
    expect(machine.getState().phase).toBe('idle');
    machine.send({ request: {} });
    machine.send({ confirm: {} });
    await flush();
    expect(machine.getState().phase).toBe('failed');
    controller.viewGone();
    expect(machine.getState()).toMatchObject({ phase: 'idle', error: null });
  });

  it('dispose after the view went while working sends no notice (the action may still finish)', () => {
    const notified: ToastRequest[] = [];
    const controller = createConfirmController(
      options({ run: () => new Promise(() => {}) }),
      manualTimers().service,
      (r) => notified.push(r),
      'confirm-1',
    );
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    controller.viewGone();
    controller.dispose();
    expect(notified).toEqual([]);
  });

  it('dispose while working reports one failure, clears the timer and drops the late result', async () => {
    const timers = manualTimers();
    const pending = deferred();
    const controller = createConfirmController(options({ run: () => pending.promise }), timers.service, noNotify, 'confirm-1');
    const listener = vi.fn();
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    controller.machine.subscribe(listener);
    controller.dispose();
    expect(controller.machine.getState().phase).toBe('failed');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(timers.count()).toBe(0);
    pending.resolve();
    await flush();
    expect(controller.machine.getState().phase).toBe('failed');
    expect(controller.takeDone()).toBe(false);
    // A second dispose reports nothing more.
    controller.dispose();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('dispose with nothing running sends nothing', () => {
    const controller = createConfirmController(options(), manualTimers().service, noNotify, 'confirm-1');
    const listener = vi.fn();
    controller.machine.subscribe(listener);
    controller.dispose();
    expect(listener).not.toHaveBeenCalled();
  });

  it('done is taken once', async () => {
    const controller = createConfirmController(options(), manualTimers().service, noNotify, 'confirm-1');
    controller.machine.send({ request: {} });
    controller.machine.send({ confirm: {} });
    await flush();
    expect(controller.takeDone()).toBe(true);
    expect(controller.takeDone()).toBe(false);
  });
});

function Screen(props: Partial<ConfirmDestructiveOptions>) {
  const remove = useConfirmDestructive(options(props));
  return (
    <>
      <Button variant="danger" onClick={remove.request}>
        Delete
      </Button>
      <span data-testid="phase">{remove.phase}</span>
      {remove.dialog}
    </>
  );
}

const phase = () => screen.getByTestId('phase').textContent;
const confirmButton = () => screen.getByRole('button', { name: 'Delete channel' });
const dialog = () => screen.queryByRole('dialog');

describe('useConfirmDestructive', () => {
  it('opens on request, names what is lost, and puts the safe action first with focus on it', async () => {
    const { user } = renderWithKit(<Screen />);
    expect(dialog()).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog', { name: 'Delete #general?' })).toHaveAccessibleDescription(
      'This removes 214 messages for everyone.',
    );
    expect(phase()).toBe('confirming');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('runs once and closes on success, then calls onDone once', async () => {
    const onDone = vi.fn();
    const run = vi.fn(() => Promise.resolve());
    const { user } = renderWithKit(<Screen run={run} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(confirmButton());
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(run).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('idle');
  });

  it('calls onDone only after focus is back on the opener', async () => {
    let focusedAtDone: Element | null = null;
    const { user } = renderWithKit(
      <Screen onDone={() => (focusedAtDone = document.activeElement)} />,
    );
    const opener = screen.getByRole('button', { name: 'Delete' });
    await user.click(opener);
    await user.click(confirmButton());
    await waitFor(() => expect(focusedAtDone).not.toBeNull());
    expect(focusedAtDone).toBe(opener);
  });

  it('does not call onDone after a failure or a cancel', async () => {
    const onDone = vi.fn();
    const { user } = renderWithKit(<Screen run={() => Promise.reject(new Error('no'))} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(confirmButton());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows a failure as an alert in the body, keeps the confirm label, and retries', async () => {
    const run = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce();
    const { user } = renderWithKit(<Screen run={run} errorMessage={() => "Couldn't delete the channel. Try again."} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(confirmButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't delete the channel. Try again.");
    expect(dialog()).toContainElement(alert);
    expect(phase()).toBe('failed');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await user.click(confirmButton());
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps a busy confirm button focusable; Cancel reads unavailable but stays focusable and does nothing', async () => {
    const pending = deferred();
    const { user } = renderWithKit(<Screen run={() => pending.promise} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(confirmButton());
    expect(phase()).toBe('working');
    const confirm = confirmButton();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).not.toBeDisabled();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).not.toBeDisabled();
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    expect(cancel).not.toHaveAttribute('aria-busy');
    act(() => cancel.focus());
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    expect(phase()).toBe('working');
    await act(async () => pending.reject(new Error('no')));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('aria-disabled');
  });

  it('ignores Escape and a press on the scrim while working, and Cancel closes it again after a failure', async () => {
    const pending = deferred();
    const { user } = renderWithKit(<Screen run={() => pending.promise} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(confirmButton());
    await user.keyboard('{Escape}');
    await user.click((dialog() as HTMLElement).parentElement as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(dialog()).toBeInTheDocument();
    expect(phase()).toBe('working');
    await act(async () => pending.reject(new Error('no')));
    await screen.findByRole('alert');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });

  it('closes on Escape and on the scrim before the action', async () => {
    const { user } = renderWithKit(<Screen />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click((dialog() as HTMLElement).parentElement as HTMLElement);
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });

  it('runs once when the confirm button is activated twice at once', async () => {
    const pending = deferred();
    const run = vi.fn(() => pending.promise);
    const { user } = renderWithKit(<Screen run={run} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = confirmButton();
    // Both clicks land before React re-renders the button busy: only the reducer stops the second.
    act(() => {
      confirm.click();
      confirm.click();
    });
    await user.click(confirm);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
  });

  it('a timeout fails the run and shows its message; the late answer changes nothing', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    renderWithKit(<Screen run={() => pending.promise} timeoutMs={1_000} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(confirmButton());
    expect(phase()).toBe('working');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(phase()).toBe('working');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(phase()).toBe('failed');
    expect(screen.getByRole('alert')).toHaveTextContent(TIMEOUT_MESSAGE);
    // The result is unknown, but the same button stays, with its label, to try again.
    expect(confirmButton()).not.toHaveAttribute('aria-busy');
    await act(async () => {
      pending.resolve();
    });
    expect(phase()).toBe('failed');
  });

  it('unmounting while working drops the timer and the late result without a warning', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const onDone = vi.fn();
    const view = renderWithKit(<Screen run={() => pending.promise} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(confirmButton());
    expect(phase()).toBe('working');
    view.unmount();
    await act(async () => {
      pending.resolve();
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('request and the dialog callbacks keep their identity across renders', async () => {
    const seen = new Set<() => void>();
    function Probe({ n }: { n: number }) {
      const remove = useConfirmDestructive(options({ title: `Delete #general ${n}?` }));
      seen.add(remove.request);
      return remove.dialog;
    }
    const view = renderWithKit(<Probe n={1} />);
    view.rerender(<Probe n={2} />);
    view.rerender(<Probe n={3} />);
    expect(seen.size).toBe(1);
  });

  describe('inside a layer that closes while the action works', () => {
    /**
     * Records what reaches the real toast host (`useToasts().show`), and lets it through: the toast
     * queue runs as in the app. Registered in a layout effect, before the screen's own effects.
     */
    function Sink({ sink }: { sink: ToastRequest[] | ((request: ToastRequest) => void) }): null {
      const host = useBehaviourHost();
      useLayoutEffect(() => {
        const toasts = host.toasts.toasts;
        const show = toasts.show.bind(toasts);
        const spy = vi.spyOn(toasts, 'show').mockImplementation((request) => {
          if (typeof sink === 'function') sink(request);
          else sink.push(request);
          return show(request);
        });
        return () => spy.mockRestore();
      }, [host, sink]);
      return null;
    }
    let closePanel: () => void = () => {};
    function PanelScreen(props: Partial<ConfirmDestructiveOptions> & { sink: ToastRequest[] }) {
      const { sink, ...rest } = props;
      const [panel, setPanel] = useState(true);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const remove = useConfirmDestructive(options(rest));
      closePanel = () => setPanel(false);
      return (
        <>
          <Sink sink={sink} />
          <Button ref={setAnchor} onClick={() => setPanel(true)}>
            Channel settings
          </Button>
          <span data-testid="phase">{remove.phase}</span>
          <Popover open={panel} anchor={anchor} onClose={() => setPanel(false)} label="Channel settings">
            <Button variant="danger" onClick={remove.request}>
              Delete
            </Button>
            {remove.dialog}
          </Popover>
        </>
      );
    }

    it('a failure after the dialog went is a danger notice, and Delete works again', async () => {
      const sink: ToastRequest[] = [];
      const pending = deferred();
      const run = vi.fn<() => Promise<void>>().mockReturnValueOnce(pending.promise);
      const { user } = renderWithKit(
        <PanelScreen sink={sink} run={run} errorMessage={() => "Couldn't delete the channel. Try again."} />,
      );
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await user.click(confirmButton());
      expect(phase()).toBe('working');
      act(() => closePanel());
      await waitFor(() => expect(dialog()).not.toBeInTheDocument());
      expect(phase()).toBe('working');
      await act(async () => pending.reject(new Error('403')));
      expect(phase()).toBe('idle');
      expect(sink).toEqual([
        { id: expect.stringMatching(/^confirm-/), tone: 'danger', message: "Couldn't delete the channel. Try again." },
      ]);
      // Not stuck: the panel and the dialog open again.
      await user.click(screen.getByRole('button', { name: 'Channel settings' }));
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      expect(await screen.findByRole('dialog', { name: 'Delete #general?' })).toBeInTheDocument();
      expect(phase()).toBe('confirming');
    });

    it('the dialog element leaving the page while working (no parent layer) is the same: a notice, not stuck', async () => {
      const sink: ToastRequest[] = [];
      const pending = deferred();
      let hide: () => void = () => {};
      function Conditional() {
        const [shown, setShown] = useState(true);
        hide = () => setShown(false);
        const remove = useConfirmDestructive(options({ run: () => pending.promise }));
        return (
          <>
            <Sink sink={sink} />
            <Button variant="danger" onClick={remove.request}>
              Delete
            </Button>
            <span data-testid="phase">{remove.phase}</span>
            {shown && remove.dialog}
          </>
        );
      }
      const { user } = renderWithKit(<Conditional />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await user.click(confirmButton());
      act(() => hide());
      await act(async () => pending.reject(new Error('no')));
      expect(phase()).toBe('idle');
      expect(sink).toHaveLength(1);
    });

    it('the panel reopened while the action works: a failure shows in the dialog again, with no notice', async () => {
      const sink: ToastRequest[] = [];
      const pending = deferred();
      const { user } = renderWithKit(
        <PanelScreen sink={sink} run={() => pending.promise} errorMessage={() => "Couldn't delete the channel. Try again."} />,
      );
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await user.click(confirmButton());
      act(() => closePanel());
      await waitFor(() => expect(dialog()).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Channel settings' }));
      await screen.findByRole('dialog', { name: 'Delete #general?' });
      expect(phase()).toBe('working');
      await act(async () => pending.reject(new Error('403')));
      expect(phase()).toBe('failed');
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't delete the channel. Try again.");
      expect(sink).toEqual([]);
    });

    it('through the real toast region: the failure shows as a danger toast on the page', async () => {
      const pending = deferred();
      const toastState = { read: (): unknown => null };
      function Probe(): null {
        const host = useBehaviourHost();
        toastState.read = () => host.toasts.machine.getState().showing;
        return null;
      }
      const { user } = renderWithKit(
        <>
          <PanelScreen sink={[]} run={() => pending.promise} errorMessage={() => "Couldn't delete the channel. Try again."} />
          <ToastRegion />
          <Probe />
        </>,
      );
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await user.click(confirmButton());
      act(() => closePanel());
      await waitFor(() => expect(dialog()).not.toBeInTheDocument());
      await act(async () => pending.reject(new Error('403')));
      const region = await waitFor(() => {
        const found = document.querySelector('[data-kit-toast-region]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      expect(region).toHaveTextContent("Couldn't delete the channel. Try again.");
      expect(toastState.read()).toMatchObject({ id: expect.stringMatching(/^confirm-/), tone: 'danger' });
    });

    it('a success after the dialog went calls onDone and sends no notice', async () => {
      const sink: ToastRequest[] = [];
      const pending = deferred();
      const onDone = vi.fn();
      const { user } = renderWithKit(<PanelScreen sink={sink} run={() => pending.promise} onDone={onDone} />);
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await user.click(confirmButton());
      act(() => closePanel());
      await waitFor(() => expect(dialog()).not.toBeInTheDocument());
      await act(async () => pending.resolve());
      expect(phase()).toBe('idle');
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(sink).toEqual([]);
    });
  });

  describe('opened from a Menu item', () => {
    function MenuScreen(props: Partial<ConfirmDestructiveOptions>) {
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const remove = useConfirmDestructive(options(props));
      return (
        <>
          <Button ref={setAnchor} onClick={() => setOpen(true)}>
            Channel options
          </Button>
          <Menu
            open={open}
            anchor={anchor}
            onClose={() => setOpen(false)}
            label="Channel options"
            items={[{ id: 'delete', label: 'Delete channel…', onSelect: remove.request }]}
          />
          {remove.dialog}
        </>
      );
    }
    const trigger = () => screen.getByRole('button', { name: 'Channel options' });

    it('returns focus to the menu button after a successful confirm', async () => {
      const { user } = renderWithKit(<MenuScreen />);
      await user.click(trigger());
      await user.click(await screen.findByRole('menuitem', { name: 'Delete channel…' }));
      await user.click(await screen.findByRole('button', { name: 'Delete channel' }));
      await waitFor(() => expect(dialog()).not.toBeInTheDocument());
      await waitFor(() => expect(trigger()).toHaveFocus());
    });

    it('returns focus to the menu button after Cancel and after Escape', async () => {
      const { user } = renderWithKit(<MenuScreen />);
      for (const close of ['cancel', 'escape']) {
        await user.click(trigger());
        await user.click(await screen.findByRole('menuitem', { name: 'Delete channel…' }));
        await screen.findByRole('dialog');
        if (close === 'cancel') await user.click(screen.getByRole('button', { name: 'Cancel' }));
        else await user.keyboard('{Escape}');
        await waitFor(() => expect(dialog()).not.toBeInTheDocument());
        await waitFor(() => expect(trigger()).toHaveFocus());
      }
    });
  });
});
