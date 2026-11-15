import type { TextTone } from '../../../../kit';
import type { CallBarModel } from '../../../../data/callBar';

/**
 * The line under the room's name: what is happening now, most important first. `tone` is the meaning; the
 * kit's ListRow draws its secondary line in one tone today, so the bar does not colour it yet (a ListRow
 * `secondaryTone` would; see the PR 7 report).
 */
export function callBarLine(model: CallBarModel): { text: string; tone: TextTone } {
  const { mic } = model;
  if (model.phase === 'connecting') return { text: 'Joining…', tone: 'secondary' };
  if (mic.blocked) return { text: mic.title, tone: 'danger' };
  if (mic.serverMuted) return { text: 'Muted by a moderator', tone: 'danger' };
  if (model.deafened) return { text: 'Deafened', tone: 'secondary' };
  if (mic.transmitting) return { text: "You're talking", tone: 'accent' };
  if (model.talking) return { text: `${model.talking} is talking`, tone: 'accent' };
  if (mic.mode === 'pushToTalkKey') return { text: `Hold ${mic.keyLabel ?? 'the key'} to talk`, tone: 'secondary' };
  if (mic.mode === 'holdToTalk') return { text: 'Hold the mic to talk', tone: 'secondary' };
  return { text: model.place.kind === 'dm' ? 'Call connected' : 'Voice connected', tone: 'secondary' };
}
