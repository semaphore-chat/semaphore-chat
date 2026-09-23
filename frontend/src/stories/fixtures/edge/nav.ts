/**
 * Edge-case fixture helpers for the "scale, navigation & lists" area
 * (stories in `src/stories/edge/nav/`, ids `edge-nav-*`).
 *
 * Everything here is deterministic (explicit ids + seeded RNG) and mirrors
 * real backend shapes/limits:
 *  - user `displayName` and `username` are capped at 32 chars by the backend
 *    (`update-profile.dto.ts` / `create-user.dto.ts`, username
 *    `[a-zA-Z0-9_-]+`), so "max length" names here are 32 chars, not 64;
 *  - community names cap at 100, descriptions at 500, channel names at 100;
 *  - avatar/banner fields are FILE IDS served by `/api/file/:id`. A "broken"
 *    image is a file id the file endpoint 404s on (what the real backend does
 *    for a deleted/missing file), handled by `navHandlers()`;
 *  - `/api/membership/community/:id` is cursor-paginated (`limit`, default
 *    100, `continuationToken` = last membership id, ordered by joinedAt asc)
 *    — `navHandlers()` implements that so 200+ member lists page like prod;
 *  - `/api/notifications` honours `limit` (default 50, cap 100), `offset`,
 *    `unreadOnly`; `total` is the page length, `unreadCount` the global count;
 *  - `/api/direct-messages` is sorted by last activity desc.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { createSpan } from '../../../__tests__/test-utils/factories';
import type {
  MembershipResponseDto,
  NotificationDto,
  NotificationListResponseDto,
  FriendshipWithUsersDto,
  RoleDto,
  UserEntity,
} from '../../../api-client/types.gen';
import type { Channel } from '../../../types/channel.type';
import type { Message } from '../../../types/message.type';
import type { DirectMessageGroup } from '../../../types/direct-message.type';
import { SpanType } from '../../../types/message.type';
import { avatarFileId, bannerFileId } from '../avatars';
import { buildScenario } from '../builder';
import { createRng, int, pick, chance, timeAgo } from '../rng';
import { defineScreen, type DefineScreenOptions, type LadleStoryComponent } from '../screenStory';
import type { Scenario, ScenarioCommunity, ScenarioUser } from '../types';

// ── Odd names ──────────────────────────────────────────────────────────

/** Prefix for file ids the file endpoint 404s on (see `navHandlers`). */
export const BROKEN_FILE_PREFIX = 'nav-missing-file-';

export type AvatarKind = 'ok' | 'none' | 'broken';

interface OddPerson {
  displayName: string | null;
  username: string;
  avatar: AvatarKind;
  status?: string | null;
}

/** 32 chars = backend max for both displayName and username. */
export const MAX_DISPLAY_NAME = 'Maximilian Alexander Featherston'; // 32
export const MAX_USERNAME = 'maximilian_alexander_featherston'; // 32
export const NO_SPACES_NAME = 'Wolfeschlegelsteinhausenbergerdo'; // 32, no spaces

export const ODD_PEOPLE: OddPerson[] = [
  { displayName: MAX_DISPLAY_NAME, username: MAX_USERNAME, avatar: 'ok', status: 'On a very long walk through a very long list of things to do today, back later' },
  { displayName: NO_SPACES_NAME, username: 'wolfeschlegelsteinhausenbergerd', avatar: 'broken' },
  { displayName: 'ليلى عبد الرحمن الهاشمي', username: 'layla_hashemi', avatar: 'ok', status: 'مشغولة حاليا' },
  { displayName: 'נועה בן-דוד שטרנברג', username: 'noa_ben_david', avatar: 'none' },
  { displayName: '🦄✨🌈🔥💯🎉🚀👾', username: 'emoji_only', avatar: 'ok' },
  { displayName: '🎧 DJ Mixmaster 🎛️', username: 'dj_mixmaster', avatar: 'broken', status: '🎶🎶🎶' },
  { displayName: null, username: 'no_display_name_set_1234567890ab', avatar: 'none' },
  { displayName: 'x', username: 'x', avatar: 'none' },
  { displayName: 'Zoë Ångström-Øverli', username: 'zoe_angstrom', avatar: 'ok' },
  { displayName: '李小龍 (Bruce)', username: 'bruce_lee_fan', avatar: 'ok' },
  { displayName: 'ALLCAPSSHOUTINGUSERNAMEGUYYYYYYY', username: 'ALLCAPS_SHOUTING_USER_NAME_GUYYY', avatar: 'broken' },
  { displayName: 'مستخدم with mixed English text', username: 'mixed_rtl_ltr', avatar: 'none' },
];

function avatarFor(kind: AvatarKind, key: string, label: string): string | null {
  if (kind === 'none') return null;
  if (kind === 'broken') return `${BROKEN_FILE_PREFIX}${key}`;
  // The shared initials renderer slices by UTF-16 unit, which splits
  // astral-plane emoji into lone surrogates (URIError) — feed it only the
  // letters/digits of the label. The id is opaque either way.
  return avatarFileId(key, label.replace(/[^\p{L}\p{N}\s]/gu, '').trim() || '#');
}

function makeUser(id: string, p: OddPerson): ScenarioUser {
  return {
    id,
    username: p.username,
    displayName: p.displayName,
    avatarUrl: avatarFor(p.avatar, id, p.displayName ?? p.username),
    bannerUrl: null,
    lastSeen: null,
    bio: null,
    status: p.status ?? null,
    role: 'USER',
    email: `${id}@example.test`,
  };
}

/** The `ODD_PEOPLE` roster as scenario users (ids `nav-odd-N`). */
export function makeOddUsers(): ScenarioUser[] {
  return ODD_PEOPLE.map((p, i) => makeUser(`nav-odd-${i + 1}`, p));
}

const FIRST = ['Ava', 'Marcus', 'Priya', 'Jordan', 'Sofia', 'Kenji', 'Fatima', 'Liam', 'Noor', 'Diego', 'Yuki', 'Chidi', 'Elena', 'Omar', 'Grace', 'Theo', 'Aisha', 'Bjorn', 'Carmen', 'Dmitri'];
const LAST = ['Reyes', 'Chen', 'Okafor', 'Nilsson', 'Patel', 'Costa', 'Novak', 'Ibrahim', 'Sato', 'Moreau', 'Haddad', 'Larsen', 'Rossi', 'Kowalski', 'Singh', 'Diallo'];
const STATUSES = [null, null, 'On mobile', 'brb', null, '🎧 deep work', null, 'Building something fun'];

/**
 * `count` deterministic ordinary users (ids `${prefix}-N`); every
 * `oddEvery`th one (if > 0) is replaced by the next `ODD_PEOPLE` entry,
 * and ~1 in 6 has no avatar (the most common real-world case).
 */
export function makeUsers(count: number, opts: { seed?: string; prefix?: string; oddEvery?: number } = {}): ScenarioUser[] {
  const { seed = 'edge-nav-users', prefix = 'nav-user', oddEvery = 0 } = opts;
  const rng = createRng(seed);
  let odd = 0;
  return Array.from({ length: count }, (_, i) => {
    const id = `${prefix}-${i + 1}`;
    if (oddEvery > 0 && i % oddEvery === oddEvery - 1) {
      const p = ODD_PEOPLE[odd++ % ODD_PEOPLE.length];
      return makeUser(id, { ...p, username: `${p.username.slice(0, 28)}${i}`.slice(0, 32) });
    }
    const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    return makeUser(id, {
      displayName: name,
      username: `${name.toLowerCase().replace(/[^a-z]+/g, '_')}${i}`,
      avatar: chance(rng, 1 / 6) ? 'none' : 'ok',
      status: pick(rng, STATUSES),
    });
  });
}

function toEntity(u: ScenarioUser): UserEntity {
  const { email: _email, ...rest } = u;
  return rest;
}

function addUsers(scenario: Scenario, extra: ScenarioUser[]): ScenarioUser[] {
  const known = new Set([scenario.me.id, ...scenario.users.map((u) => u.id)]);
  return [...scenario.users, ...extra.filter((u) => !known.has(u.id))];
}

function lookupUser(scenario: Scenario, users: ScenarioUser[], id: string): ScenarioUser {
  return id === scenario.me.id ? scenario.me : users.find((u) => u.id === id)!;
}

// ── Members ────────────────────────────────────────────────────────────

/**
 * Replace a community's member list with `me` + `members` (in join order).
 * `memberCount` 0 isn't reachable for a real community page — you can only
 * open a community you belong to — so the minimum is "just me".
 */
export function withMembers(scenario: Scenario, communityId: string, members: ScenarioUser[]): Scenario {
  const community = scenario.communities.find((c) => c.id === communityId);
  if (!community) return scenario;
  const users = addUsers(scenario, members);
  const roles = scenario.rolesByCommunity[communityId] ?? [];
  const ownerRole = roles[0];
  const memberRole = roles[1] ?? roles[0];
  const memberIds = [scenario.me.id, ...members.map((m) => m.id)];
  const memberships: MembershipResponseDto[] = memberIds.map((id, idx) => ({
    id: `nav-membership-${communityId}-${String(idx).padStart(5, '0')}`,
    userId: id,
    communityId,
    // Oldest first — matches the backend's `orderBy joinedAt asc`.
    joinedAt: timeAgo(60 * 24 * 400 - idx * 60),
    roles: [id === scenario.me.id ? ownerRole : memberRole].filter(Boolean) as RoleDto[],
    user: toEntity(lookupUser(scenario, users, id)) as never,
  }));
  return {
    ...scenario,
    users,
    communities: scenario.communities.map((c) => (c.id === communityId ? { ...c, memberIds } : c)),
    membershipsByCommunity: { ...scenario.membershipsByCommunity, [communityId]: memberships },
  };
}

// ── Channels ───────────────────────────────────────────────────────────

export const LONG_CHANNEL_NAME =
  'this-is-a-really-long-channel-name-for-announcements-and-release-notes-and-other-important-stuff-ok'; // 100
const CHANNEL_WORDS = ['general', 'random', 'help', 'dev', 'design', 'ops', 'music', 'games', 'memes', 'jobs', 'books', 'pets', 'food', 'travel', 'crypto', 'art'];

/** Deterministic channel names: `count` text channel names, a few of them odd. */
export function makeChannelNames(count: number, opts: { odd?: boolean } = {}): string[] {
  const odd = opts.odd
    ? [LONG_CHANNEL_NAME, '📢-announcements-📢', 'نقاش-عام', 'שיחה-כללית', 'nospacesnohyphensjustaverylongchannelname']
    : [];
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return 'general';
    if (odd.length && i % 7 === 3) return odd[Math.floor(i / 7) % odd.length];
    return `${CHANNEL_WORDS[i % CHANNEL_WORDS.length]}-${Math.floor(i / CHANNEL_WORDS.length) + 1}`;
  });
}

/**
 * Replace a community's channels with `textNames` + `voiceNames` (ids
 * `nav-ch-<community>-t<N>` / `-v<N>`). Messages for the first text channel
 * are carried over from the old #general (if any) so a chat route still has
 * content; the rest start empty.
 */
export function withChannels(
  scenario: Scenario,
  communityId: string,
  textNames: string[],
  voiceNames: string[] = [],
  opts: { privateEvery?: number } = {},
): Scenario {
  const community = scenario.communities.find((c) => c.id === communityId);
  if (!community) return scenario;
  const oldGeneral = community.channels.find((c) => c.name === 'general');
  const created = timeAgo(60 * 24 * 300);
  const text: Channel[] = textNames.map((name, i) => ({
    id: `nav-ch-${communityId}-t${i + 1}`,
    name,
    communityId,
    type: 'TEXT',
    isPrivate: !!opts.privateEvery && i > 0 && i % opts.privateEvery === 0,
    createdAt: created,
    position: i,
    slowmodeSeconds: 0,
  }));
  const voice: Channel[] = voiceNames.map((name, i) => ({
    id: `nav-ch-${communityId}-v${i + 1}`,
    name,
    communityId,
    type: 'VOICE',
    isPrivate: false,
    createdAt: created,
    position: text.length + i,
    slowmodeSeconds: 0,
  }));
  const messagesByChannel = { ...scenario.messagesByChannel };
  for (const c of [...text, ...voice]) messagesByChannel[c.id] = [];
  if (text[0] && oldGeneral) {
    messagesByChannel[text[0].id] = (scenario.messagesByChannel[oldGeneral.id] ?? []).map((m) => ({ ...m, channelId: text[0].id }));
  }
  return {
    ...scenario,
    messagesByChannel,
    communities: scenario.communities.map((c) => (c.id === communityId ? { ...c, channels: [...text, ...voice] } : c)),
  };
}

/** Mark every text channel of a community unread; every `mentionEvery`th also gets mentions (some 99+). */
export function withAllChannelsUnread(scenario: Scenario, communityId: string, mentionEvery = 3): Scenario {
  const community = scenario.communities.find((c) => c.id === communityId);
  if (!community) return scenario;
  const next = { ...scenario.unreadByContextId };
  community.channels
    .filter((c) => c.type === 'TEXT')
    .forEach((c, i) => {
      const heavy = i % 10 === 1;
      next[c.id] = {
        unreadCount: heavy ? 250 : (i % 9) + 1,
        mentionCount: i % mentionEvery === 1 ? (heavy ? 120 : 1 + (i % 4)) : 0,
      };
    });
  return { ...scenario, unreadByContextId: next };
}

// ── Communities ────────────────────────────────────────────────────────

export const LONG_COMMUNITY_NAME =
  'The International Association of Extremely Long Community Names and Their Many Wonderful Members'; // < 100
export const LONG_COMMUNITY_DESCRIPTION =
  'A community whose description is right at the 500-character limit. '.repeat(7).slice(0, 500);

const COMMUNITY_WORDS = ['Pixel', 'Night', 'Owl', 'Forge', 'Harbor', 'Lantern', 'Orbit', 'Atlas', 'Summit', 'Echo', 'Maple', 'Nova', 'Quartz', 'River', 'Signal', 'Tundra'];
const COMMUNITY_KINDS = ['Collective', 'Club', 'Guild', 'Lab', 'Crew', 'Society', 'Hub', 'Den'];
const ODD_COMMUNITY_NAMES = [LONG_COMMUNITY_NAME, '🎮🎲 Game Night 🎲🎮', 'مجتمع المطورين العرب', 'קהילת המפתחים', 'Supercalifragilisticexpialidociousandthensome', 'a'];

/**
 * Append generated communities until `me` belongs to `total` communities.
 * Each extra community has one #general text channel and just `me` as a
 * member; roughly 1 in 5 has no avatar and 1 in 11 a broken one; a handful
 * use `ODD_COMMUNITY_NAMES`.
 */
export function withCommunityCount(scenario: Scenario, total: number, seed = 'edge-nav-communities'): Scenario {
  const rng = createRng(seed);
  const extraCount = Math.max(0, total - scenario.communities.length);
  const communities: ScenarioCommunity[] = [...scenario.communities];
  const membershipsByCommunity = { ...scenario.membershipsByCommunity };
  const rolesByCommunity = { ...scenario.rolesByCommunity };
  const messagesByChannel = { ...scenario.messagesByChannel };
  for (let i = 0; i < extraCount; i++) {
    const n = scenario.communities.length + i + 1;
    const id = `nav-community-${n}`;
    const name =
      i % 9 === 4
        ? ODD_COMMUNITY_NAMES[Math.floor(i / 9) % ODD_COMMUNITY_NAMES.length]
        : `${pick(rng, COMMUNITY_WORDS)} ${pick(rng, COMMUNITY_WORDS)} ${pick(rng, COMMUNITY_KINDS)}`;
    const avatarKind: AvatarKind = i % 11 === 7 ? 'broken' : i % 5 === 2 ? 'none' : 'ok';
    const createdAt = timeAgo(int(rng, 60 * 24 * 10, 60 * 24 * 900));
    const channel: Channel = {
      id: `${id}-general`,
      name: 'general',
      communityId: id,
      type: 'TEXT',
      isPrivate: false,
      createdAt,
      position: 0,
      slowmodeSeconds: 0,
    };
    messagesByChannel[channel.id] = [];
    const ownerRole: RoleDto = {
      actions: ['CREATE_MESSAGE', 'READ_MESSAGE', 'READ_CHANNEL', 'READ_COMMUNITY'] as never,
      id: `role-member-${id}`,
      name: 'Member',
      createdAt,
      isDefault: true,
      position: 1,
    };
    rolesByCommunity[id] = [ownerRole];
    membershipsByCommunity[id] = [
      { id: `nav-membership-${id}-0`, userId: scenario.me.id, communityId: id, joinedAt: createdAt, roles: [ownerRole], user: toEntity(scenario.me) as never },
    ];
    communities.push({
      id,
      name,
      description: null,
      avatar: avatarFor(avatarKind, id, name),
      banner: null,
      createdAt,
      channels: [channel],
      memberIds: [scenario.me.id],
      ownerId: 'someone-else',
    });
  }
  return { ...scenario, communities, membershipsByCommunity, rolesByCommunity, messagesByChannel };
}

/** Keep only the first `count` communities (and drop DM/notification refs to removed ones is unnecessary — they only point at community-1). */
export function withOnlyCommunities(scenario: Scenario, count: number): Scenario {
  return { ...scenario, communities: scenario.communities.slice(0, count) };
}

/** Rename / re-avatar a community (e.g. long name, no avatar, broken avatar, long description). */
export function withCommunityLook(
  scenario: Scenario,
  communityId: string,
  look: { name?: string; description?: string | null; avatar?: AvatarKind; banner?: AvatarKind },
): Scenario {
  return {
    ...scenario,
    communities: scenario.communities.map((c) => {
      if (c.id !== communityId) return c;
      const name = look.name ?? c.name;
      return {
        ...c,
        name,
        description: look.description !== undefined ? look.description : c.description,
        avatar: look.avatar ? avatarFor(look.avatar, c.id, name) : c.avatar,
        banner: look.banner ? (look.banner === 'ok' ? bannerFileId(c.id) : look.banner === 'none' ? null : `${BROKEN_FILE_PREFIX}banner-${c.id}`) : c.banner,
      };
    }),
  };
}

// ── DMs ────────────────────────────────────────────────────────────────

const DM_LINES = [
  'ok sounds good',
  'did you see the thing I sent earlier? it has a really long preview line that should get truncated somewhere reasonable in the list',
  'lol',
  '👍',
  'can we move the call to tomorrow?',
  'مرحبا! كيف حالك اليوم؟',
  'שלום, מה שלומך?',
  'https://example.com/a/really/long/url/that/has/no/spaces/at/all/and/keeps/going/forever/and/ever',
];

/**
 * Replace the DM list with `count` conversations over `pool` users: every
 * 4th is a group DM (every 12th a big one with `bigGroupSize` members, some
 * unnamed so the UI must build a name from members), plus a spread of
 * unread counts (0 / 1 / 7 / 150) and a few mentions. Sorted by last
 * activity desc like the backend.
 */
export function withDmGroups(
  scenario: Scenario,
  pool: ScenarioUser[],
  count: number,
  opts: { bigGroupSize?: number; seed?: string } = {},
): Scenario {
  const { bigGroupSize = 14, seed = 'edge-nav-dms' } = opts;
  const rng = createRng(seed);
  const users = addUsers(scenario, pool);
  const dmGroups: DirectMessageGroup[] = [];
  const messagesByDmGroup: Record<string, Message[]> = {};
  const unread = { ...scenario.unreadByContextId };
  for (const g of scenario.dmGroups) delete unread[g.id];

  for (let i = 0; i < count; i++) {
    const id = `nav-dm-${i + 1}`;
    const isBig = i % 12 === 5;
    const isGroup = isBig || i % 4 === 3;
    const size = isBig ? bigGroupSize : isGroup ? 3 + (i % 3) : 1;
    const members = Array.from({ length: size }, (_, k) => pool[(i * 3 + k * 7) % pool.length]);
    const uniqueMembers = members.filter((m, idx) => members.findIndex((x) => x.id === m.id) === idx);
    const all = [scenario.me, ...uniqueMembers];
    const minutesAgo = i * 37 + int(rng, 0, 20);
    const author = pick(rng, all);
    const text = DM_LINES[i % DM_LINES.length];
    const msg: Message = {
      id: `nav-dm-msg-${i + 1}`,
      channelId: null,
      directMessageGroupId: id,
      authorId: author.id,
      spans: [createSpan({ text })],
      attachments: [],
      reactions: [],
      sentAt: timeAgo(minutesAgo),
    } as unknown as Message;
    messagesByDmGroup[id] = [msg];
    dmGroups.push({
      id,
      name: isGroup && i % 8 === 3 ? (i % 16 === 3 ? `${LONG_COMMUNITY_NAME} planning group` : 'weekend crew 🏕️') : null,
      isGroup,
      createdAt: timeAgo(minutesAgo + 60 * 24 * 30),
      members: all.map((u, k) => ({
        id: `nav-dm-member-${i + 1}-${k}`,
        userId: u.id,
        joinedAt: timeAgo(minutesAgo + 60 * 24 * 30),
        user: { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl },
      })),
      lastMessage: { id: msg.id, authorId: msg.authorId, spans: msg.spans as never, sentAt: msg.sentAt },
    } as DirectMessageGroup);
    const bucket = i % 5;
    if (bucket === 0) unread[id] = { unreadCount: 1, mentionCount: 0 };
    else if (bucket === 1) unread[id] = { unreadCount: 150, mentionCount: i % 10 === 1 ? 3 : 0 };
    else if (bucket === 2 && i < 30) unread[id] = { unreadCount: 7, mentionCount: 1 };
  }
  return { ...scenario, users, dmGroups, messagesByDmGroup, unreadByContextId: unread };
}

// ── Notifications ──────────────────────────────────────────────────────

const NOTIF_TYPES: NotificationDto['type'][] = ['USER_MENTION', 'DIRECT_MESSAGE', 'THREAD_REPLY', 'CHANNEL_MESSAGE', 'SPECIAL_MENTION'];

/**
 * Replace notifications with `count` mixed-type ones (newest first), the
 * first `unread` of which are unread. Authors cycle through `authors`
 * (odd names included). Channel ones point at the first community's first
 * text channel; DM ones at the first DM group.
 */
export function withNotifications(scenario: Scenario, count: number, unread: number, authors: ScenarioUser[]): Scenario {
  const community = scenario.communities[0];
  const channel = community?.channels.find((c) => c.type === 'TEXT');
  const dm = scenario.dmGroups[0];
  const users = addUsers(scenario, authors);
  const notifications: NotificationDto[] = Array.from({ length: count }, (_, i) => {
    let type = NOTIF_TYPES[i % NOTIF_TYPES.length];
    if (type === 'DIRECT_MESSAGE' && !dm) type = 'USER_MENTION';
    const author = authors[i % authors.length];
    const isDm = type === 'DIRECT_MESSAGE';
    const text =
      type === 'SPECIAL_MENTION'
        ? '@everyone heads up: the server is going down for maintenance tonight at 22:00 UTC, save your work'
        : DM_LINES[i % DM_LINES.length];
    const spans =
      type === 'USER_MENTION'
        ? [createSpan({ type: SpanType.USER_MENTION, userId: scenario.me.id, text: `@${scenario.me.username}` }), createSpan({ text: ` ${text}` })]
        : [createSpan({ text })];
    return {
      id: `nav-notif-${i + 1}`,
      type,
      userId: scenario.me.id,
      messageId: `nav-notif-msg-${i + 1}`,
      channelId: isDm ? null : channel?.id ?? null,
      directMessageGroupId: isDm ? dm.id : null,
      communityId: isDm ? null : community?.id ?? null,
      authorId: author.id,
      parentMessageId: type === 'THREAD_REPLY' ? `nav-notif-parent-${i + 1}` : null,
      read: i >= unread,
      dismissed: false,
      createdAt: timeAgo(i * 11 + 1),
      author: { id: author.id, username: author.username, displayName: author.displayName, avatarUrl: author.avatarUrl },
      message: {
        spans: spans as never,
        id: `nav-notif-msg-${i + 1}`,
        channelId: isDm ? null : channel?.id ?? null,
        directMessageGroupId: isDm ? dm.id : null,
      },
    };
  });
  return { ...scenario, users, notifications };
}

// ── Friends ────────────────────────────────────────────────────────────

/** Replace friendships: `accepted` friends, `incoming` requests received, `outgoing` sent. */
export function withFriends(
  scenario: Scenario,
  accepted: ScenarioUser[],
  incoming: ScenarioUser[] = [],
  outgoing: ScenarioUser[] = [],
): Scenario {
  const users = addUsers(scenario, [...accepted, ...incoming, ...outgoing]);
  const me = toEntity(scenario.me);
  const mk = (u: ScenarioUser, status: 'ACCEPTED' | 'PENDING', dir: 'in' | 'out', i: number): FriendshipWithUsersDto => ({
    id: `nav-friendship-${status}-${dir}-${i + 1}`,
    status,
    createdAt: timeAgo(i * 90 + 5),
    userAId: dir === 'out' ? scenario.me.id : u.id,
    userBId: dir === 'out' ? u.id : scenario.me.id,
    userA: dir === 'out' ? me : toEntity(u),
    userB: dir === 'out' ? toEntity(u) : me,
  });
  return {
    ...scenario,
    users,
    friendships: [
      ...accepted.map((u, i) => mk(u, 'ACCEPTED', i % 2 ? 'in' : 'out', i)),
      ...incoming.map((u, i) => mk(u, 'PENDING', 'in', i)),
      ...outgoing.map((u, i) => mk(u, 'PENDING', 'out', i)),
    ],
  };
}

// ── Users (profile) ────────────────────────────────────────────────────

export const MAX_BIO = (
  'Hi! I am a person with a lot to say and exactly five hundred characters to say it in. ' +
  'I like long walks through long lists, testing text truncation, and namesthatneverbreakanywhereatallwhichisannoying. ' +
  'مرحبا بالجميع. שלום לכולם. 🦄✨🌈🔥💯 '
).repeat(4).slice(0, 500);

/** Patch any user (or `me`) in place. */
export function withUserPatch(scenario: Scenario, userId: string, patch: Partial<ScenarioUser>): Scenario {
  if (userId === scenario.me.id) return { ...scenario, me: { ...scenario.me, ...patch } };
  return { ...scenario, users: scenario.users.map((u) => (u.id === userId ? { ...u, ...patch } : u)) };
}

/** Add users to the scenario without attaching them anywhere (e.g. a profile target). */
export function withExtraUsers(scenario: Scenario, extra: ScenarioUser[]): Scenario {
  return { ...scenario, users: addUsers(scenario, extra) };
}

/** A banner file id the file endpoint 404s on. */
export function brokenBannerId(key: string): string {
  return `${BROKEN_FILE_PREFIX}banner-${key}`;
}

// ── Handlers ───────────────────────────────────────────────────────────

/**
 * Overrides for `makeHandlers` where the base handlers don't mirror the
 * backend closely enough for scale/odd-content stories (see module doc).
 */
function notFound() {
  return HttpResponse.json({ message: 'File not found', error: 'Not Found', statusCode: 404 }, { status: 404 });
}

export function navHandlers(scenario: Scenario): HttpHandler[] {
  return [
    // Fall through (return undefined) to the base file handler for every
    // id that isn't a deliberately broken one.
    http.get('/api/file/:id', ({ params }) =>
      String(params.id).startsWith(BROKEN_FILE_PREFIX) ? notFound() : undefined),
    http.get('/api/file/:id/thumbnail', ({ params }) =>
      String(params.id).startsWith(BROKEN_FILE_PREFIX) ? notFound() : undefined),

    http.get('/api/membership/community/:communityId', ({ params, request }) => {
      const url = new URL(request.url);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
      const token = url.searchParams.get('continuationToken') || '';
      const all = scenario.membershipsByCommunity[String(params.communityId)] ?? [];
      const start = token ? all.findIndex((m) => m.id === token) + 1 : 0;
      const members = all.slice(start, start + limit);
      const continuationToken = members.length === limit ? members[members.length - 1].id : undefined;
      return HttpResponse.json({ members, continuationToken });
    }),

    http.get('/api/notifications', ({ request }) => {
      const url = new URL(request.url);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
      const offset = Number(url.searchParams.get('offset')) || 0;
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
      const source = unreadOnly ? scenario.notifications.filter((n) => !n.read) : scenario.notifications;
      const page = source.slice(offset, offset + limit);
      const response: NotificationListResponseDto = {
        notifications: page,
        total: page.length,
        unreadCount: scenario.notifications.filter((n) => !n.read).length,
      };
      return HttpResponse.json(response);
    }),

    http.get('/api/direct-messages', () => {
      const activity = (g: DirectMessageGroup) => new Date(g.lastMessage?.sentAt ?? g.createdAt).getTime();
      return HttpResponse.json([...scenario.dmGroups].sort((a, b) => activity(b) - activity(a)));
    }),
  ];
}

/** `defineScreen` + `navHandlers` prepended (before any story-specific extras). */
export function defineNavScreen(scenario: Scenario, path: string, options: DefineScreenOptions = {}): LadleStoryComponent {
  return defineScreen(scenario, path, {
    ...options,
    extraHandlers: [...(options.extraHandlers ?? []), ...navHandlers(scenario)],
  });
}

// ── Presets used by the edge-nav stories ───────────────────────────────


/** Base: the usual busy scenario, but a separate seed so it's independent of shared presets. */
export function navBase(): Scenario {
  return buildScenario({ seed: 'edge-nav', meOverrides: { role: 'OWNER' } });
}

export const NAV_COMMUNITY = 'community-1';
/** First text channel id after `withChannels(…, NAV_COMMUNITY, …)`. */
export const NAV_FIRST_CHANNEL = `nav-ch-${NAV_COMMUNITY}-t1`;

/** 240 members (every 9th odd) — pages at 100 like prod. */
export const MANY_MEMBERS = makeUsers(240, { oddEvery: 9 });
/** 120 users for DMs/friends (every 5th odd). */
export const DM_POOL = makeUsers(120, { seed: 'edge-nav-dm-pool', prefix: 'nav-dmu', oddEvery: 5 });
/** 60 text + 10 voice channel names, odd ones mixed in. */
export const SIXTY_TEXT = makeChannelNames(50, { odd: true });
export const TEN_VOICE = ['Lounge', 'Gaming 🎮', 'Music', 'AFK', 'Stage', 'Meeting Room 1', 'Meeting Room 2', 'غرفة الصوت', LONG_CHANNEL_NAME.slice(0, 60), 'Quiet'];

/** Everything at once: 1000 communities, 60 long/odd channels all unread, 240 odd members, 120 DMs, 150 notifications, odd `me`. */
export function worstCaseScenario(): Scenario {
  let s = navBase();
  s = withUserPatch(s, s.me.id, { displayName: MAX_DISPLAY_NAME, username: MAX_USERNAME, status: ODD_PEOPLE[0].status ?? null });
  s = withCommunityLook(s, NAV_COMMUNITY, { name: LONG_COMMUNITY_NAME, description: LONG_COMMUNITY_DESCRIPTION, avatar: 'broken' });
  s = withChannels(s, NAV_COMMUNITY, SIXTY_TEXT, TEN_VOICE, { privateEvery: 11 });
  s = withAllChannelsUnread(s, NAV_COMMUNITY);
  // Keep the original members (they authored #general's messages) and add the odd + bulk ones.
  const original = s.communities[0].memberIds.filter((id) => id !== s.me.id).map((id) => s.users.find((u) => u.id === id)!);
  s = withMembers(s, NAV_COMMUNITY, [...original, ...makeOddUsers(), ...MANY_MEMBERS]);
  s = withCommunityCount(s, 1000);
  s = withDmGroups(s, DM_POOL, 120);
  s = withNotifications(s, 150, 130, [...makeOddUsers(), ...DM_POOL]);
  s = withFriends(s, DM_POOL.slice(0, 60), DM_POOL.slice(60, 75), DM_POOL.slice(75, 85));
  return s;
}
