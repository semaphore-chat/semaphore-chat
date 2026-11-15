import type { TextTone } from '../../../../kit';
import type { CallBarModel } from '../../../../data/callBar';

export interface CallBarLine {
  text: string;
  tone: TextTone;
  /**
   * The user must read it in full (why the mic cannot open, or that it is open while deafened): the bar draws it
   * on its own line under the room, wrapping, never cut off. Otherwise it shares the room's column and may
   * truncate.
   */
  full: boolean;
}

/**
 * The line under the room's name: what is happening now, most important first. Null when there is nothing to
 * say: while reconnecting the status row above says it, and nothing here may claim the call is connected (as
 * the classic bar hides "Voice Connected" then).
 */
export function callBarLine(model: CallBarModel): CallBarLine | null {
  const { mic } = model;
  if (model.phase === 'connecting') return { text: 'Joining…', tone: 'secondary', full: false };
  if (mic.blocked) return { text: mic.title, tone: 'danger', full: true };
  if (mic.serverMuted) return { text: 'Muted by a moderator', tone: 'danger', full: true };
  const live = mic.on || mic.transmitting;
  // The classic Mute does not undeafen: unmuting while deafened leaves you talking without hearing anyone.
  if (model.deafened && live) return { text: 'Deafened · your mic is on', tone: 'danger', full: true };
  if (model.deafened) return { text: 'Deafened', tone: 'secondary', full: false };
  if (model.phase === 'reconnecting') return live ? null : { text: 'Muted', tone: 'secondary', full: false };
  if (mic.transmitting) return { text: "You're talking", tone: 'accent', full: false };
  if (mic.mode === 'pushToTalkKey') return { text: `Hold ${mic.keyLabel ?? 'the key'} to talk`, tone: 'secondary', full: false };
  if (mic.mode === 'holdToTalk') return { text: 'Hold the mic to talk', tone: 'secondary', full: false };
  if (!mic.on) return { text: 'Muted', tone: 'secondary', full: false };
  if (model.talking) return { text: `${model.talking} is talking`, tone: 'accent', full: false };
  return { text: model.place.kind === 'dm' ? 'Call connected' : 'Voice connected', tone: 'secondary', full: false };
}

/**
 * Why the mic control can do nothing right now, said when it is pressed (it stays focusable and named, so a
 * keyboard or screen-reader user can find out). Null when pressing it acts.
 */
export function micUnavailableReason(model: CallBarModel): string | null {
  const { mic } = model;
  if (mic.blocked) return mic.title;
  if (mic.serverMuted) return 'Muted by a moderator';
  if (mic.mode === 'pushToTalkKey') return `Hold ${mic.keyLabel ?? 'the key'} to talk`;
  return null;
}
