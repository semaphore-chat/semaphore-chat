/**
 * The words the community pieces put together from data: pure, so tests and stories share them.
 */
import type { IconName } from '../../../../kit';
import type { CallBarModel } from '../../../../data/callBar';
import type { UserCardCall, UserCardMic } from './UserCard';
import type { ChannelItem } from './ChannelSection';

export interface NamedPerson {
  id: string;
  name: string;
}

/** "9 around"; null when no source knows the number (then no number is shown). */
export function aroundLine(aroundCount: number | null): string | null {
  return aroundCount === null ? null : `${aroundCount.toLocaleString()} around`;
}

const SHOWN_NAMES = 3;

/**
 * "You, dropbear and pri", "dropbear and 9 more": you first, then the room's order. When the server lists you in a
 * room this device is not connected to (you are in it on another device, or your presence is stale), you are
 * "You on another device" (classic lists your name there and still offers Join).
 */
export function peopleLine(people: readonly NamedPerson[], youId: string | null, youAreHere = true): string {
  const you = people.filter((p) => p.id === youId);
  const names = [...you.map(() => (youAreHere ? 'You' : 'You on another device')), ...people.filter((p) => p.id !== youId).map((p) => p.name || 'Unknown user')];
  if (names.length <= SHOWN_NAMES) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  const shown = names.slice(0, SHOWN_NAMES - 1);
  return `${shown.join(', ')} and ${names.length - shown.length} more`;
}

/** "dropbear is talking", "dropbear and pri are talking"; you are left out (you know). */
export function talkingLine(people: readonly NamedPerson[], speaking: ReadonlySet<string>, youId: string | null): string | null {
  const names = people.filter((p) => p.id !== youId && speaking.has(p.id)).map((p) => p.name || 'Unknown user');
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is talking`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are talking`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are talking`;
}

/** What the card says about the call: deafened wins (you hear nothing and cannot speak), then the mic. */
export function callState(call: UserCardCall): { icon: IconName; text: string } {
  if (call.deafened) return { icon: 'HeadphoneOff', text: 'Deafened' };
  switch (call.mic) {
    case 'serverMuted':
      return { icon: 'MicOff', text: 'Muted by a moderator' };
    case 'blocked':
      return { icon: 'MicOff', text: 'Listening only' };
    case 'pushToTalk':
      return { icon: 'Mic', text: call.keyLabel ? `Push to talk (${call.keyLabel})` : 'Push to talk' };
    case 'muted':
      return { icon: 'MicOff', text: 'Muted' };
    default:
      return { icon: 'Mic', text: 'Mic on' };
  }
}

/** The card's call state from the call bar model. */
export function callFromModel(model: CallBarModel): UserCardCall {
  const mic: UserCardMic = model.mic.serverMuted
    ? 'serverMuted'
    : model.mic.blocked
      ? 'blocked'
      : model.mic.mode !== 'toggle'
        ? 'pushToTalk'
        : model.mic.on
          ? 'on'
          : 'muted';
  return { mic, deafened: model.deafened, keyLabel: model.mic.keyLabel };
}


/** The words a row adds to its name after the channel's: its kind, privacy and mention count. */
export function channelTrailingLabel(channel: ChannelItem, mentions: number): string {
  return [
    channel.announcement ? 'announcement channel' : null,
    channel.isPrivate ? 'private' : null,
    mentions > 0 ? (mentions === 1 ? '1 mention' : `${mentions} mentions`) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

