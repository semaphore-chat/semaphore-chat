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
import type { WidthRange } from '../../../kit';
import { renderWithKit } from '../../test-utils/renderWithKit';
import {
  DM_PLACE,
  ENDED_NOTICE,
  MIC,
  NOT_FOUND_NOTICE,
  fakeCallBarModel,
  fakeVoiceNotice,
} from '../../../stories/fixtures/callBarFixtures';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

type Overrides = Partial<Omit<CallBarModel, 'actions'>>;

function bar(overrides: Overrides = {}, width: WidthRange = 'phone') {
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
  const view = renderWithKit(<CallBar model={model} width={width} />);
  return { actions, model, ...view };
}

interface Control {
  name: string;
  pressed: 'true' | 'false' | null;
  enabled: boolean;
}

function control(name: string): Control | null {
  const button = screen.queryByRole('button', { name });
  if (!button) return null;
  return { name, pressed: button.getAttribute('aria-pressed') as Control['pressed'], enabled: !(button as HTMLButtonElement).disabled };
}

const MUTE_LIVE: Control = { name: 'Mute', pressed: 'false', enabled: true };
const MUTE_MUTED: Control = { name: 'Mute', pressed: 'true', enabled: true };
const MUTE_DISABLED: Control = { name: 'Mute', pressed: 'true', enabled: false };
const HOLD: Control = { name: 'Hold to talk', pressed: null, enabled: true };
const HOLD_DISABLED: Control = { name: 'Hold to talk', pressed: null, enabled: false };

const STATES: [string, Overrides, { mic: Control; micLabel: string; line: string }][] = [
  ['voice activity, live', {}, { mic: MUTE_LIVE, micLabel: 'Mute', line: 'Voice connected' }],
  ['voice activity, muted', { mic: MIC.muted }, { mic: MUTE_MUTED, micLabel: 'Mute', line: 'Voice connected' }],
  ['speaking', { mic: MIC.speaking }, { mic: MUTE_LIVE, micLabel: 'Mute', line: 'Voice connected' }],
  ['someone talking', { talking: 'dropbear' }, { mic: MUTE_LIVE, micLabel: 'Mute', line: 'dropbear is talking' }],
  ['server-muted', { mic: MIC.serverMuted }, { mic: MUTE_DISABLED, micLabel: 'Mute', line: 'Muted by a moderator' }],
  ['blocked (no SPEAK)', { mic: MIC.blocked }, { mic: MUTE_DISABLED, micLabel: 'Mute', line: "You can't speak in this room" }],
  ['deafened', { mic: MIC.muted, deafened: true }, { mic: MUTE_MUTED, micLabel: 'Mute', line: 'Deafened' }],
  ['push-to-talk key, idle', { mic: MIC.pttIdle }, { mic: MUTE_DISABLED, micLabel: 'Mute', line: 'Hold V to talk' }],
  [
    'push-to-talk key, held',
    { mic: MIC.pttHeld },
    { mic: { name: 'Mute', pressed: 'false', enabled: false }, micLabel: 'Mute', line: "You're talking" },
  ],
  ['hold-to-talk, idle', { mic: MIC.holdIdle }, { mic: HOLD, micLabel: 'Hold to talk', line: 'Hold the mic to talk' }],
  ['hold-to-talk, held', { mic: MIC.holdHeld }, { mic: HOLD, micLabel: 'Hold to talk', line: "You're talking" }],
  [
    'hold-to-talk, server-muted',
    { mic: MIC.holdServerMuted },
    { mic: HOLD_DISABLED, micLabel: 'Hold to talk', line: 'Muted by a moderator' },
  ],
  ['hold-to-talk, blocked', { mic: MIC.holdBlocked }, { mic: MUTE_DISABLED, micLabel: 'Mute', line: "You can't speak in this room" }],
  ['DM call', { place: DM_PLACE }, { mic: MUTE_LIVE, micLabel: 'Mute', line: 'Call connected' }],
];

describe('CallBar: every state, at every width', () => {
  describe.each(['phone', 'compact', 'wide'] as const)('%s', (width) => {
    it.each(STATES)('%s', (_name, overrides, expected) => {
      bar(overrides, width);
      expect(control(expected.micLabel)).toEqual(expected.mic);
      expect(screen.getByText(expected.line, { exact: true })).toBeInTheDocument();
      // Leave and Open call view are always there and enabled in a call.
      expect(control('Leave call')).toEqual({ name: 'Leave call', pressed: null, enabled: true });
      expect(control('Open call view')).toEqual({ name: 'Open call view', pressed: null, enabled: true });
      // Deafen on the phone bar only (PA-3); at compact and wide it is on the user card.
      const deafen = control('Deafen');
      if (width === 'phone') {
        expect(deafen).toEqual({ name: 'Deafen', pressed: overrides.deafened ? 'true' : 'false', enabled: true });
      } else {
        expect(deafen).toBeNull();
      }
    });
  });

  it('names the region after the room', () => {
    bar({ place: DM_PLACE });
    expect(screen.getByRole('region', { name: 'Call in aiko' })).toBeInTheDocument();
  });

  it.each(['phone', 'wide'] as const)('joining (%s): the room and "Joining…", nothing to press', (width) => {
    bar({ phase: 'connecting' }, width);
    const region = screen.getByRole('region', { name: 'Call in Squad Up' });
    expect(within(region).getByText('Joining…', { exact: true })).toBeInTheDocument();
    expect(within(region).queryAllByRole('button')).toEqual([]);
  });

  it('reconnecting: the attempt and Cancel, which cancels; the controls stay', () => {
    const { actions } = bar({ phase: 'reconnecting', reconnectAttempt: 2 });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting (2)…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actions.cancel).toHaveBeenCalledTimes(1);
    expect(actions.leave).not.toHaveBeenCalled();
    expect(control('Leave call')?.enabled).toBe(true);
  });

  it('Tab order: mic, deafen, open, leave (phone)', () => {
    bar();
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Mute', 'Deafen', 'Open call view', 'Leave call']);
  });
});

describe('CallBar: each control calls the model action', () => {
  it.each([
    ['Mute', 'toggleMute'],
    ['Deafen', 'toggleDeafen'],
    ['Open call view', 'openCallView'],
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
    ['server-muted', MIC.serverMuted],
    ['blocked', MIC.blocked],
    ['push-to-talk key', MIC.pttIdle],
  ])('a %s mic calls nothing when clicked', (_name, mic) => {
    const { actions } = bar({ mic });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(actions.toggleMute).not.toHaveBeenCalled();
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

  it('ends when a moderator mutes you mid-hold (the control becomes disabled)', () => {
    const { actions, rerender, model } = bar({ mic: MIC.holdHeld });
    press(screen.getByRole('button', { name: 'Hold to talk' }));
    rerender(<CallBar model={{ ...model, mic: MIC.holdServerMuted }} width="phone" />);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('ends when push-to-talk is turned off mid-hold (the control becomes the mute toggle)', () => {
    const { actions, rerender, model } = bar({ mic: MIC.holdHeld });
    press(screen.getByRole('button', { name: 'Hold to talk' }));
    rerender(<CallBar model={{ ...model, mic: MIC.live }} width="phone" />);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('ends when the bar goes to the joining state (the controls go)', () => {
    const { actions, rerender, model } = bar({ mic: MIC.holdHeld });
    press(screen.getByRole('button', { name: 'Hold to talk' }));
    rerender(<CallBar model={{ ...model, phase: 'connecting' }} width="phone" />);
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
