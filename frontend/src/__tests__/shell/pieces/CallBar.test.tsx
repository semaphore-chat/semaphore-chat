/**
 * The Lounge call bar view: for every model state, what each control shows, its accessible name, whether it
 * is enabled, and which model action it calls. The model is a fake (`stories/fixtures/callBarFixtures`); the
 * connected test (ShellCall.test.tsx) proves the actions are the classic bar's own functions.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { CallBar } from '../../../shell/lounge/pieces/call/CallBar';
import { VoiceNoticeBar } from '../../../shell/lounge/pieces/call/VoiceNoticeBar';
import type { CallBarModel } from '../../../data/callBar';
import { renderWithKit } from '../../test-utils/renderWithKit';
import {
  DM_PLACE,
  ENDED_NOTICE,
  MIC,
  NOT_FOUND_NOTICE,
  fakeCallBarModel,
  fakeVoiceNotice,
} from '../../../stories/fixtures/callBarFixtures';

const said = vi.hoisted(() => [] as string[]);
vi.mock('../../../kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('../../../kit')>();
  return { ...kit, useAnnounce: () => (text: string) => said.push(text) };
});

let consoleError: MockInstance;
beforeEach(() => {
  said.length = 0;
  consoleError = vi.spyOn(console, 'error');
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

type Overrides = Partial<Omit<CallBarModel, 'actions'>>;

function bar(overrides: Overrides = {}) {
  const actions = {
    toggleMute: vi.fn(),
    toggleDeafen: vi.fn(),
    leave: vi.fn(),
    cancel: vi.fn(),
    stopSharing: vi.fn(),
    openCallView: vi.fn(),
    holdStart: vi.fn(() => true),
    holdEnd: vi.fn(() => true),
  };
  const model = fakeCallBarModel({ ...overrides, actions });
  const view = renderWithKit(<CallBar model={model} />);
  return { actions, model, ...view };
}

interface Control {
  name: string;
  pressed: 'true' | 'false' | null;
  /** Pressing it acts: neither `disabled` nor `aria-disabled`. */
  available: boolean;
  /** A Tab stop (an unavailable mic stays one, so its reason can be found). */
  focusable: boolean;
}

function control(name: string): Control | null {
  const button = screen.queryByRole('button', { name });
  if (!button) return null;
  const disabled = (button as HTMLButtonElement).disabled;
  return {
    name,
    pressed: button.getAttribute('aria-pressed') as Control['pressed'],
    available: !disabled && button.getAttribute('aria-disabled') !== 'true',
    focusable: !disabled && button.tabIndex >= 0,
  };
}

const MUTE_LIVE: Control = { name: 'Mute', pressed: 'false', available: true, focusable: true };
const MUTE_MUTED: Control = { name: 'Mute', pressed: 'true', available: true, focusable: true };
const MUTE_BLOCKED: Control = { name: 'Mute', pressed: 'true', available: false, focusable: true };
const MUTE_LIVE_BLOCKED: Control = { name: 'Mute', pressed: 'false', available: false, focusable: true };
const HOLD: Control = { name: 'Hold to talk', pressed: null, available: true, focusable: true };
const HOLD_BLOCKED: Control = { name: 'Hold to talk', pressed: null, available: false, focusable: true };

/** The state line as drawn: in the room's row (may truncate) or on its own line (in full), or none. */
interface Line {
  text: string;
  full: boolean;
}

function drawnLine(model: CallBarModel): { row: string | null; full: string | null } {
  const name = screen.getByText(model.place.name, { exact: true });
  const row = name.nextElementSibling?.textContent ?? null;
  const full = screen.queryByTestId('lounge-call-line')?.textContent ?? null;
  return { row, full };
}

const line = (text: string, full = false): Line => ({ text, full });

const TIMED_OUT = 'Timed out — you can listen until 14:05';

/**
 * Every state of the bar: the mic control, Deafen (on the bar at every width), and the state line. Reconnecting
 * rows also show the status row (asserted below them).
 */
const STATES: [string, Overrides, { mic: Control; micLabel: string; deafened: boolean; line: Line | null }][] = [
  ['voice activity, live', {}, { mic: MUTE_LIVE, micLabel: 'Mute', deafened: false, line: line('Voice connected') }],
  ['voice activity, muted', { mic: MIC.muted }, { mic: MUTE_MUTED, micLabel: 'Mute', deafened: false, line: line('Muted') }],
  ['speaking', { mic: MIC.speaking }, { mic: MUTE_LIVE, micLabel: 'Mute', deafened: false, line: line('Voice connected') }],
  ['someone talking', { talking: 'dropbear' }, { mic: MUTE_LIVE, micLabel: 'Mute', deafened: false, line: line('dropbear is talking') }],
  ['muted while someone talks', { mic: MIC.muted, talking: 'dropbear' }, { mic: MUTE_MUTED, micLabel: 'Mute', deafened: false, line: line('Muted') }],
  ['server-muted', { mic: MIC.serverMuted }, { mic: MUTE_BLOCKED, micLabel: 'Mute', deafened: false, line: line('Muted by a moderator', true) }],
  ['blocked (no SPEAK)', { mic: MIC.blocked }, { mic: MUTE_BLOCKED, micLabel: 'Mute', deafened: false, line: line("You can't speak in this room", true) }],
  ['timed out', { mic: MIC.timedOut }, { mic: MUTE_BLOCKED, micLabel: 'Mute', deafened: false, line: line(TIMED_OUT, true) }],
  ['deafened (mic off)', { mic: MIC.muted, deafened: true }, { mic: MUTE_MUTED, micLabel: 'Mute', deafened: true, line: line('Deafened') }],
  [
    'deafened, then Mute pressed (mic on, still deafened, as classic)',
    { mic: MIC.live, deafened: true },
    { mic: MUTE_LIVE, micLabel: 'Mute', deafened: true, line: line('Deafened · your mic is on', true) },
  ],
  [
    'deafened and server-muted',
    { mic: MIC.serverMuted, deafened: true },
    { mic: MUTE_BLOCKED, micLabel: 'Mute', deafened: true, line: line('Muted by a moderator', true) },
  ],
  ['push-to-talk key, idle', { mic: MIC.pttIdle }, { mic: MUTE_BLOCKED, micLabel: 'Mute', deafened: false, line: line('Hold V to talk') }],
  ['push-to-talk key, held', { mic: MIC.pttHeld }, { mic: MUTE_LIVE_BLOCKED, micLabel: 'Mute', deafened: false, line: line("You're talking") }],
  [
    'push-to-talk key held while deafened',
    { mic: MIC.pttHeld, deafened: true },
    { mic: MUTE_LIVE_BLOCKED, micLabel: 'Mute', deafened: true, line: line('Deafened · your mic is on', true) },
  ],
  ['hold-to-talk, idle', { mic: MIC.holdIdle }, { mic: HOLD, micLabel: 'Hold to talk', deafened: false, line: line('Hold the mic to talk') }],
  ['hold-to-talk, held', { mic: MIC.holdHeld }, { mic: HOLD, micLabel: 'Hold to talk', deafened: false, line: line("You're talking") }],
  [
    'hold-to-talk, held while deafened',
    { mic: MIC.holdHeld, deafened: true },
    { mic: HOLD, micLabel: 'Hold to talk', deafened: true, line: line('Deafened · your mic is on', true) },
  ],
  [
    'hold-to-talk, server-muted',
    { mic: MIC.holdServerMuted },
    { mic: HOLD_BLOCKED, micLabel: 'Hold to talk', deafened: false, line: line('Muted by a moderator', true) },
  ],
  [
    'hold-to-talk, blocked',
    { mic: MIC.holdBlocked },
    { mic: MUTE_BLOCKED, micLabel: 'Mute', deafened: false, line: line("You can't speak in this room", true) },
  ],
  ['DM call', { place: DM_PLACE }, { mic: MUTE_LIVE, micLabel: 'Mute', deafened: false, line: line('Call connected') }],
  // Reconnecting: the status row says so (asserted below); the line never says connected, nor who talks.
  ['reconnecting, live', { phase: 'reconnecting', reconnectAttempt: 2 }, { mic: MUTE_LIVE, micLabel: 'Mute', deafened: false, line: null }],
  [
    'reconnecting while someone talked',
    { phase: 'reconnecting', reconnectAttempt: 2, talking: 'dropbear' },
    { mic: MUTE_LIVE, micLabel: 'Mute', deafened: false, line: null },
  ],
  [
    'reconnecting, muted',
    { phase: 'reconnecting', reconnectAttempt: 2, mic: MIC.muted },
    { mic: MUTE_MUTED, micLabel: 'Mute', deafened: false, line: line('Muted') },
  ],
  [
    'reconnecting, deafened',
    { phase: 'reconnecting', reconnectAttempt: 2, mic: MIC.muted, deafened: true },
    { mic: MUTE_MUTED, micLabel: 'Mute', deafened: true, line: line('Deafened') },
  ],
  [
    'reconnecting, server-muted',
    { phase: 'reconnecting', reconnectAttempt: 2, mic: MIC.serverMuted },
    { mic: MUTE_BLOCKED, micLabel: 'Mute', deafened: false, line: line('Muted by a moderator', true) },
  ],
];

// The bar renders the same at every width (no width-dependent control is left); the browser spec checks the
// layout at 320, 390, 820 and 1440 px.
describe('CallBar: every state', () => {
  it.each(STATES)('%s', (_name, overrides, expected) => {
      const { model } = bar(overrides);
      expect(control(expected.micLabel)).toEqual(expected.mic);
      // The line, exactly where it is drawn: in the row, on its own line, or not at all.
      expect(drawnLine(model)).toEqual({
        row: expected.line && !expected.line.full ? expected.line.text : null,
        full: expected.line?.full ? expected.line.text : null,
      });
      // Mute, Deafen and Leave are on the bar at every width (Deafen pressed = deafened).
      expect(control('Deafen')).toEqual({
        name: 'Deafen',
        pressed: expected.deafened ? 'true' : 'false',
        available: true,
        focusable: true,
      });
      expect(control('Leave call')).toEqual({ name: 'Leave call', pressed: null, available: true, focusable: true });
      // The room is the Open call view control. Its name stays fixed; the row's line is its description, so a
      // screen reader hears "Open call view, Squad Up, Muted" (a full-width line is read after the row).
      expect(screen.getByRole('button', { name: `Open call view, ${model.place.name}` })).toHaveAccessibleDescription(
        expected.line && !expected.line.full ? expected.line.text : '',
      );
      expect(control(`Open call view, ${model.place.name}`)).toEqual({
        name: `Open call view, ${model.place.name}`,
        pressed: null,
        available: true,
        focusable: true,
      });
      const status = screen.queryByRole('status');
      if (overrides.phase === 'reconnecting') {
        expect(status).toHaveTextContent('Reconnecting (2)…');
        // Two lines that disagree about the connection never show together.
        expect(screen.queryByText(/connected/i)).toBeNull();
      } else {
        expect(status).toBeNull();
      }
  });

  it('names the region after the room', () => {
    bar({ place: DM_PLACE });
    expect(screen.getByRole('region', { name: 'Call in aiko' })).toBeInTheDocument();
  });

  it('joining: the room and "Joining…", nothing to press (the room is not a button yet)', () => {
    bar({ phase: 'connecting' });
    const region = screen.getByRole('region', { name: 'Call in Squad Up' });
    expect(within(region).getByText('Joining…', { exact: true })).toBeInTheDocument();
    expect(within(region).queryAllByRole('button')).toEqual([]);
  });

  it('reconnecting: the attempt and Cancel, which cancels; the controls stay; nothing says connected', () => {
    const { actions } = bar({ phase: 'reconnecting', reconnectAttempt: 2 });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting (2)…');
    expect(screen.queryByText(/connected/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actions.cancel).toHaveBeenCalledTimes(1);
    expect(actions.leave).not.toHaveBeenCalled();
    expect(control('Leave call')?.available).toBe(true);
  });

  it('Tab order: the room (Open call view), mic, deafen, leave; no separate Open control', () => {
    bar();
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Open call view, Squad Up', 'Mute', 'Deafen', 'Leave call']);
  });

  it('an unavailable mic is still a Tab stop, in the same order', () => {
    bar({ mic: MIC.serverMuted });
    const names = screen
      .getAllByRole('button')
      .filter((b) => (b as HTMLButtonElement).tabIndex >= 0 && !(b as HTMLButtonElement).disabled)
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Open call view, Squad Up', 'Mute', 'Deafen', 'Leave call']);
  });
});

describe('CallBar: each control calls the model action', () => {
  it.each([
    ['Mute', 'toggleMute'],
    ['Deafen', 'toggleDeafen'],
    ['Open call view, Squad Up', 'openCallView'],
    ['Leave call', 'leave'],
  ] as const)('%s → actions.%s', (name, action) => {
    const { actions } = bar();
    fireEvent.click(screen.getByRole('button', { name }));
    expect(actions[action]).toHaveBeenCalledTimes(1);
    for (const [key, fn] of Object.entries(actions)) {
      if (key !== action) expect(fn, key).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['server-muted', MIC.serverMuted, 'Muted by a moderator'],
    ['blocked', MIC.blocked, "You can't speak in this room"],
    ['timed out', MIC.timedOut, TIMED_OUT],
    ['push-to-talk key', MIC.pttIdle, 'Hold V to talk'],
    ['push-to-talk key, held', MIC.pttHeld, 'Hold V to talk'],
  ])('a %s mic does not act when pressed: it says why', (_name, mic, reason) => {
    const { actions } = bar({ mic });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(actions.toggleMute).not.toHaveBeenCalled();
    expect(said).toEqual([reason]);
  });

  it('a server-muted hold control does not hold when pressed: it says why', () => {
    const { actions } = bar({ mic: MIC.holdServerMuted });
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold, { pointerId: 1, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(hold, { pointerId: 1 });
    fireEvent.click(hold);
    expect(actions.holdStart).not.toHaveBeenCalled();
    expect(actions.holdEnd).not.toHaveBeenCalled();
    expect(said).toEqual(['Muted by a moderator']);
  });

  it('an available mic says nothing when pressed (the line and the pressed state tell)', () => {
    bar({ mic: MIC.muted });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(said).toEqual([]);
  });

  it('Deafen while deafened calls toggleDeafen: undeafen is always on screen', () => {
    const { actions } = bar({ mic: MIC.muted, deafened: true });
    fireEvent.click(screen.getByRole('button', { name: 'Deafen' }));
    expect(actions.toggleDeafen).toHaveBeenCalledTimes(1);
    expect(actions.toggleMute).not.toHaveBeenCalled();
  });

  it('Mute while deafened calls toggleMute only (the classic Mute: it does not undeafen)', () => {
    const { actions } = bar({ mic: MIC.muted, deafened: true });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);
    expect(actions.toggleDeafen).not.toHaveBeenCalled();
  });
});

describe('CallBar: hold to talk', () => {
  const press = (button: HTMLElement) => fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch' });

  it('press starts, release ends, a tap does not toggle the mic', () => {
    const { actions } = bar({ mic: MIC.holdIdle });
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    press(hold);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(hold, { pointerId: 1 });
    fireEvent.click(hold);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
    expect(actions.toggleMute).not.toHaveBeenCalled();
  });

  it('ends on pointer cancel and on lost capture (the finger slid off and the browser took it)', () => {
    const { actions } = bar({ mic: MIC.holdIdle });
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    press(hold);
    fireEvent.pointerCancel(hold, { pointerId: 1 });
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
    press(hold);
    fireEvent.lostPointerCapture(hold, { pointerId: 1 });
    expect(actions.holdEnd).toHaveBeenCalledTimes(2);
  });

  it('sliding off keeps the hold (the pointer is captured) until it is lifted', () => {
    const { actions } = bar({ mic: MIC.holdIdle });
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    press(hold);
    fireEvent.pointerLeave(hold, { pointerId: 1 });
    expect(actions.holdEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(hold, { pointerId: 1 });
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('ends when the bar unmounts mid-hold', () => {
    const { actions, unmount } = bar({ mic: MIC.holdIdle });
    press(screen.getByRole('button', { name: 'Hold to talk' }));
    unmount();
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('ends when a moderator mutes you mid-hold (the control becomes unavailable)', () => {
    const { actions, rerender, model } = bar({ mic: MIC.holdHeld });
    press(screen.getByRole('button', { name: 'Hold to talk' }));
    rerender(<CallBar model={{ ...model, mic: MIC.holdServerMuted }} />);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('ends when push-to-talk is turned off mid-hold (the control becomes the mute toggle)', () => {
    const { actions, rerender, model } = bar({ mic: MIC.holdHeld });
    press(screen.getByRole('button', { name: 'Hold to talk' }));
    rerender(<CallBar model={{ ...model, mic: MIC.live }} />);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('ends when the bar goes to the joining state (the controls go)', () => {
    const { actions, rerender, model } = bar({ mic: MIC.holdHeld });
    press(screen.getByRole('button', { name: 'Hold to talk' }));
    rerender(<CallBar model={{ ...model, phase: 'connecting' }} />);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceNoticeBar', () => {
  it('a failed join: title, message, Retry calls retry, Dismiss calls dismiss', () => {
    const retry = vi.fn(() => Promise.resolve());
    const dismiss = vi.fn();
    renderWithKit(<VoiceNoticeBar notice={fakeVoiceNotice({ retry, dismiss })} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Can't reach the voice server");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['call ended', ENDED_NOTICE, 'status'],
    ['room gone', NOT_FOUND_NOTICE, 'alert'],
  ] as const)('%s: no Retry (trying again cannot help), still Dismiss', (_name, notice, role) => {
    renderWithKit(<VoiceNoticeBar notice={fakeVoiceNotice(notice)} />);
    expect(screen.getByRole(role)).toHaveTextContent(notice.title!);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });
});
