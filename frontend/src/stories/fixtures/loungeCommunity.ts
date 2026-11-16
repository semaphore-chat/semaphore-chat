/**
 * Sample data of the Lounge mock-ups (lounge-canvas STYLE.md: Couch Co-op, alexk, Squad Up, AFK) for
 * the community left island and members stories (their page is LoungeCommunityPage.tsx). The API carries no colours: a
 * person's avatar colour comes from their id (`personColour`), and the community wears the kit's default (design §6).
 */
import { personColour, useWidthRange } from '../../kit';
import type { MemberSummary } from '../../data/members';
import type { ChannelItem } from '../../shell/lounge/pieces/community/ChannelSection';
import type { VoiceRoomCardProps } from '../../shell/lounge/pieces/community/VoiceRoomCard';
import type { UserCardProps } from '../../shell/lounge/pieces/community/UserCard';
import type { CommunityHeaderProps } from '../../shell/lounge/pieces/community/CommunityHeader';
import type { LoadController } from '../../kit';

export const noop = () => undefined;

/** A load face for a view story (the app's come from the kit's useQueryLoadState). */
const face = (status: LoadController['status']): LoadController => ({
  status,
  error: null,
  retryable: true,
  refreshByUser: false,
  refresh: noop,
  retry: noop,
});
export const ready = (empty = false): LoadController => face(empty ? 'empty' : 'ready');
export const loading = (): LoadController => face('loading');
export const failed = (): LoadController => face('error');

export const YOU = 'u-alexk';

export const HEADER: CommunityHeaderProps = {
  name: 'Couch Co-op',
  aroundCount: 9,
  actions: ['settings'],
  onAction: noop,
};

export const CHANNELS: ChannelItem[] = [
  { id: 'ch-general', name: 'general', unread: false, mentions: 0, isPrivate: false, announcement: false },
  { id: 'ch-clips', name: 'clips', unread: true, mentions: 2, isPrivate: false, announcement: false },
  { id: 'ch-lfg', name: 'lfg', unread: false, mentions: 0, isPrivate: false, announcement: false },
  { id: 'ch-memes', name: 'memes', unread: false, mentions: 0, isPrivate: false, announcement: false },
];

/** Five, with a private channel and unread without a mention beside a mention. */
export const FIVE_CHANNELS: ChannelItem[] = [
  ...CHANNELS.slice(0, 2),
  { id: 'ch-news', name: 'news', unread: true, mentions: 0, isPrivate: false, announcement: true },
  { id: 'ch-lfg', name: 'lfg', unread: true, mentions: 0, isPrivate: false, announcement: false },
  { id: 'ch-mods', name: 'mods', unread: true, mentions: 1, isPrivate: true, announcement: false },
  { id: 'ch-staff', name: 'staff-room', unread: false, mentions: 0, isPrivate: true, announcement: false },
];

export function manyChannels(count: number): ChannelItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ch-${i + 1}`,
    name: i === 0 ? 'general' : `channel-${i + 1}`,
    unread: i % 7 === 3,
    mentions: i % 23 === 5 ? (i % 4) + 1 : 0,
    isPrivate: i % 11 === 9,
    announcement: i === 1,
  }));
}

export const LONG = 'the-extremely-long-channel-name-that-somebody-thought-was-a-good-idea-at-the-time';

const person = (id: string, name: string) => ({ id, name });
export const SQUAD = [person('u-dropbear', 'dropbear'), person('u-pri', 'pri'), person(YOU, 'alexk')];
export const TWELVE = [
  ...SQUAD,
  ...['aiko', 'gracie', 'kwam3', 'Samira', 'chlo', 'tomatillo', 'Diego', 'noahbody', 'zara'].map((name) =>
    person(`u-${name.toLowerCase()}`, name),
  ),
];

export function room(overrides: Partial<VoiceRoomCardProps> & { name: string }): VoiceRoomCardProps {
  return {
    people: [],
    youId: YOU,
    speaking: new Set(),
    youAreHere: false,
    canJoin: true,
    joining: false,
    onJoin: noop,
    onLeave: noop,
    ...overrides,
  };
}

export const SQUAD_HERE = room({ name: 'Squad Up', people: SQUAD, youAreHere: true, speaking: new Set(['u-dropbear']) });
export const AFK = room({ name: 'AFK', people: [person('u-kwam3', 'kwam3')] });

export const USER_IN_CALL: UserCardProps = {
  name: 'alexk',
  colour: personColour(YOU),
  online: true,
  line: 'In Squad Up',
  call: { mic: 'on', deafened: false },
  onSettings: noop,
  onProfile: noop,
  onSignOut: noop,
};

export const USER_IDLE: UserCardProps = { ...USER_IN_CALL, line: 'keeping it chill', call: null };
export const USER_MUTED: UserCardProps = { ...USER_IN_CALL, call: { mic: 'muted', deafened: false } };
export const USER_DEAFENED: UserCardProps = { ...USER_IN_CALL, call: { mic: 'muted', deafened: true } };
export const USER_SERVER_MUTED: UserCardProps = { ...USER_IN_CALL, call: { mic: 'serverMuted', deafened: false } };

const HOUR = 3_600_000;
/** Pinned so "Seen 2h ago" never changes between captures. */
export const NOW = Date.UTC(2026, 10, 15, 20, 30);

const member = (id: string, name: string, extra: Partial<MemberSummary> = {}): MemberSummary => ({
  id,
  name,
  avatarFileId: null,
  role: null,
  presence: 'online',
  statusText: null,
  lastSeen: null,
  inRoom: null,
  ...extra,
});

export const HOSTS: MemberSummary[] = [
  member('u-samira', 'Samira', { role: 'admin', statusText: 'keeping the server warm' }),
  member('u-dropbear', 'dropbear', { role: 'mod', statusText: 'back at 9', inRoom: 'Squad Up' }),
  member('u-gracie', 'gracie', { role: 'mod', statusText: 'work tomorrow' }),
];
export const AROUND: MemberSummary[] = [
  member('u-aiko', 'aiko', { statusText: 'needs her headset back' }),
  member(YOU, 'alexk', { inRoom: 'Squad Up' }),
  member('u-chlo', 'chlo', { statusText: 'listening to lo-fi' }),
  member('u-kwam3', 'kwam3', { inRoom: 'AFK' }),
  member('u-pri', 'pri', { statusText: 'downloading 40gb update', inRoom: 'Squad Up' }),
  member('u-tomatillo', 'tomatillo', { statusText: 'playing Deep Rock' }),
];
export const AWAY: MemberSummary[] = [
  member('u-diego', 'Diego', { presence: 'offline', lastSeen: new Date(NOW - 2 * HOUR).toISOString() }),
  member('u-noahbody', 'noahbody', { presence: 'offline', lastSeen: new Date(NOW - 26 * HOUR).toISOString() }),
  member('u-zara', 'zara', { presence: 'offline', lastSeen: new Date(NOW - 74 * HOUR).toISOString() }),
];

/** `count` members: a few hosts, a third around, the rest away. */
export function manyMembers(count: number): { hosts: MemberSummary[]; around: MemberSummary[]; away: MemberSummary[] } {
  const all = Array.from({ length: count }, (_, i) =>
    member(`u-${i + 1}`, `member-${i + 1}`, {
      role: i < 4 ? (i === 0 ? 'admin' : 'mod') : null,
      presence: i % 3 === 0 ? 'online' : 'offline',
      statusText: i % 5 === 0 ? 'around tonight' : null,
      lastSeen: new Date(NOW - ((i % 30) + 1) * HOUR).toISOString(),
    }),
  );
  return {
    hosts: all.filter((m) => m.role),
    around: all.filter((m) => !m.role && m.presence === 'online'),
    away: all.filter((m) => !m.role && m.presence === 'offline'),
  };
}

/** At a phone the left island has no user card (PhoneHome); the story drops it like the piece does. */
export function useUserCardShown(): boolean {
  return useWidthRange() !== 'phone';
}
