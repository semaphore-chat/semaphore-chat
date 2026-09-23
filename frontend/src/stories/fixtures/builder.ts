/**
 * Composable scenario builder for the Ladle sandbox.
 *
 * `buildScenario(options)` produces a fully self-consistent `Scenario`
 * (users, communities, channels, messages, DMs, notifications, friends,
 * ...) from a handful of size knobs, deterministically (seeded RNG — see
 * `rng.ts`). Reshape the result further with the `with*` modifiers in
 * `modifiers.ts` before handing it to `makeHandlers()`.
 */
import {
  createMessage,
  createChannel,
  createUser,
  createDmGroupMember,
  createSpan,
  createReaction,
  createFriendship,
} from '../../__tests__/test-utils/factories';
import type { Message } from '../../types/message.type';
import { SpanType } from '../../types/message.type';
import type { Channel } from '../../types/channel.type';
import { createRng, int, pick, pickMany, chance, timeAgo, type Rng } from './rng';
import { avatarFileId, bannerFileId } from './avatars';
import type { Scenario, ScenarioCommunity, ScenarioUser } from './types';
import type { RoleDto, MembershipResponseDto, NotificationDto } from '../../api-client/types.gen';

export interface BuildScenarioOptions {
  /** Seed for the deterministic RNG. Same seed + same options = identical output. */
  seed?: string;
  /** Number of other users besides `me`. */
  userCount?: number;
  /** Number of communities `me` belongs to. */
  communityCount?: number;
  /** Text channels created per community. */
  textChannelsPerCommunity?: number;
  /** Voice channels created per community. */
  voiceChannelsPerCommunity?: number;
  /** Messages seeded into each community's first ("general") text channel. */
  messagesInGeneral?: number;
  /** Messages seeded into every other text channel. */
  messagesPerOtherChannel?: number;
  /** Number of DM conversations (1:1 and small groups). */
  dmGroupCount?: number;
  /** Number of unread notifications. */
  notificationCount?: number;
  /** Override fields on `me`. */
  meOverrides?: Partial<ScenarioUser>;
  /** Instance display name. */
  instanceName?: string;
}

const FIRST_NAMES = [
  'Ava', 'Marcus', 'Priya', 'Jordan', 'Sofia', 'Kenji', 'Fatima', 'Liam',
  'Noor', 'Diego', 'Yuki', 'Chidi', 'Elena', 'Omar', 'Grace', 'Theo',
];
const LAST_NAMES = [
  'Reyes', 'Chen', 'Okafor', 'Nilsson', 'Patel', 'Costa', 'Novak', 'Ibrahim',
  'Sato', 'Moreau', 'Haddad', 'Larsen', 'Rossi', 'Kowalski', 'Singh', 'Diallo',
];
const STATUSES = ['Building something fun', 'brb coffee', null, 'On mobile', null, '🎧 deep work'];
const TEXT_CHANNEL_NAMES = [
  'general', 'random', 'announcements', 'introductions', 'help-desk',
  'showcase', 'off-topic', 'bugs-and-feedback', 'events', 'resources',
];
const VOICE_CHANNEL_NAMES = ['Hangout', 'Meeting Room', 'Music', 'AFK'];
const COMMUNITY_NAMES = ['Nightowl Collective', 'Pixel Foundry', 'The Basecamp'];

const MESSAGE_TEMPLATES = [
  'morning ☀️',
  "anyone around? need a second pair of eyes on something",
  "just pushed the fix, can someone take a look when they get a sec",
  'lol this is great',
  "honestly didn't expect that to work first try",
  "here's the doc I mentioned yesterday: https://example.com/notes",
  'thanks!! that fixed it',
  "we should probably talk through the plan before next week",
  "no worries, take your time",
  'wait what happened here',
  "I think we're overcomplicating this a bit",
  "can confirm, reproduced on my end too",
  "sounds good to me 👍",
  "gonna step away for lunch, back in ~30",
  "quick one: does anyone have the link to the design file?",
  "this took way longer than it should have but it's done",
  "same thing happened to me last week, restarting fixed it",
  "not gonna lie, kind of proud of this one",
  "anyone else seeing this error or just me",
  "let's sync tomorrow morning instead",
  "```\nfunction retry(fn, attempts = 3) {\n  return fn().catch(err =>\n    attempts > 1 ? retry(fn, attempts - 1) : Promise.reject(err)\n  );\n}\n```",
  "that's a really good point actually",
  "np, happy to help",
  "just circling back on this — any update?",
  "😂😂😂 no because that's exactly what happened to me",
  "alright, calling it a night. night all!",
  "the new release notes are up if anyone wants to skim them",
  "counterpoint: what if we just didn't",
  "appreciate everyone's patience on this one, it was a weird bug",
  "ok I see it now, my bad",
];

function fullName(rng: Rng): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
}

function makeUser(rng: Rng, opts: { long?: boolean } = {}): ScenarioUser {
  const display = opts.long
    ? `${fullName(rng)} (they/them) — Senior Something-or-Other, Nightowl Collective Founding Member`
    : fullName(rng);
  const username = display.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'user';
  const base = createUser({
    username: `${username}${int(rng, 10, 99)}`,
    displayName: display,
    status: pick(rng, STATUSES) ?? undefined,
  });
  return {
    ...base,
    avatarUrl: avatarFileId(base.id, display),
  };
}

function buildMessage(
  rng: Rng,
  channelId: string,
  authorId: string,
  minutesAgo: number,
  overrides: Partial<Message> = {},
): Message {
  const text = overrides.spans ? undefined : pick(rng, MESSAGE_TEMPLATES);
  return createMessage({
    channelId,
    authorId,
    spans: overrides.spans ?? [createSpan({ text })],
    sentAt: timeAgo(minutesAgo),
    reactions: [],
    attachments: [],
    ...overrides,
  });
}

function buildChannelMessages(
  rng: Rng,
  channel: Channel,
  users: ScenarioUser[],
  count: number,
): Message[] {
  const messages: Message[] = [];
  let minutesAgo = count * 3 + int(rng, 5, 40);
  let lastAuthor: string | null = null;
  let consecutiveRun = 0;

  for (let i = 0; i < count; i++) {
    // Bias toward runs from the same author (consecutive-message grouping).
    const keepAuthor: boolean = !!lastAuthor && consecutiveRun < 3 && chance(rng, 0.45);
    const authorId: string = keepAuthor ? lastAuthor! : pick(rng, users).id;
    consecutiveRun = authorId === lastAuthor ? consecutiveRun + 1 : 1;
    lastAuthor = authorId;

    minutesAgo -= int(rng, 1, 6);
    const msg = buildMessage(rng, channel.id, authorId, Math.max(minutesAgo, 0));
    messages.push(msg);
  }

  // A mention near the middle.
  if (messages.length > 4) {
    const idx = int(rng, 2, messages.length - 3);
    const mentioned = pick(rng, users);
    messages[idx] = {
      ...messages[idx],
      spans: [
        createSpan({ type: SpanType.USER_MENTION, userId: mentioned.id, text: `@${mentioned.username}` }),
        createSpan({ text: ' could you take a look at this when you have a sec?' }),
      ],
    };
  }

  // An edited message.
  if (messages.length > 2) {
    const idx = int(rng, 1, messages.length - 2);
    messages[idx] = { ...messages[idx], editedAt: timeAgo(int(rng, 1, 10)) };
  }

  // A reply (quote) referencing an earlier message.
  if (messages.length > 6) {
    const targetIdx = int(rng, 0, Math.floor(messages.length / 2));
    const replyIdx = int(rng, targetIdx + 2, messages.length - 1);
    const target = messages[targetIdx];
    messages[replyIdx] = {
      ...messages[replyIdx],
      replyToId: target.id,
      replyTo: {
        id: target.id,
        authorId: target.authorId,
        spans: target.spans,
        sentAt: target.sentAt,
      },
    };
  }

  // A couple of reactions scattered around.
  for (let n = 0; n < Math.min(4, Math.floor(messages.length / 5)); n++) {
    const idx = int(rng, 0, messages.length - 1);
    const reactors = pickMany(rng, users, int(rng, 1, Math.min(3, users.length)));
    messages[idx] = {
      ...messages[idx],
      reactions: [
        createReaction({ emoji: pick(rng, ['👍', '🎉', '❤️', '😂', '🔥']), userIds: reactors.map((u) => u.id) }),
      ],
    };
  }

  return messages;
}

export function buildScenario(options: BuildScenarioOptions = {}): Scenario {
  const {
    seed = 'semaphore-ladle',
    userCount = 12,
    communityCount = 2,
    textChannelsPerCommunity = 8,
    voiceChannelsPerCommunity = 2,
    messagesInGeneral = 40,
    messagesPerOtherChannel = 6,
    dmGroupCount = 6,
    notificationCount = 5,
    meOverrides = {},
    instanceName = 'Semaphore Chat',
  } = options;

  const rng = createRng(seed);

  const meBase = createUser({
    id: 'me',
    username: 'mike',
    displayName: 'Mike',
    status: 'Reviewing UX 👀',
  });
  const me: ScenarioUser = {
    ...meBase,
    avatarUrl: avatarFileId('me', 'Mike'),
    bannerUrl: bannerFileId('me'),
    ...meOverrides,
  };

  const users: ScenarioUser[] = Array.from({ length: userCount }, () => makeUser(rng));

  const communities: ScenarioCommunity[] = [];
  const messagesByChannel: Record<string, Message[]> = {};

  for (let c = 0; c < communityCount; c++) {
    const communityName = COMMUNITY_NAMES[c % COMMUNITY_NAMES.length];
    const communityId = `community-${c + 1}`;
    const members = [me, ...pickMany(rng, users, Math.min(users.length, int(rng, 6, users.length)))];

    const channels: Channel[] = [];
    const textNames = pickMany(rng, TEXT_CHANNEL_NAMES, Math.min(textChannelsPerCommunity, TEXT_CHANNEL_NAMES.length));
    // Always include "general" first.
    const orderedTextNames = ['general', ...textNames.filter((n) => n !== 'general')].slice(0, textChannelsPerCommunity);
    orderedTextNames.forEach((name, idx) => {
      const channel = createChannel({ communityId, name, type: 'TEXT', position: idx });
      channels.push(channel);
      const count = name === 'general' ? messagesInGeneral : messagesPerOtherChannel;
      messagesByChannel[channel.id] = count > 0 ? buildChannelMessages(rng, channel, members, count) : [];
    });
    const voiceNames = VOICE_CHANNEL_NAMES.slice(0, voiceChannelsPerCommunity);
    voiceNames.forEach((name, idx) => {
      const channel = createChannel({ communityId, name, type: 'VOICE', position: orderedTextNames.length + idx });
      channels.push(channel);
      messagesByChannel[channel.id] = [];
    });

    communities.push({
      id: communityId,
      name: communityName,
      description: `${communityName} — a place to hang out and get things done.`,
      avatar: avatarFileId(communityId, communityName),
      banner: bannerFileId(communityId),
      createdAt: timeAgo(int(rng, 60 * 24 * 30, 60 * 24 * 200)),
      channels,
      memberIds: members.map((u) => u.id),
      ownerId: me.id,
    });
  }

  // A representative thread + pinned message + image attachment + custom
  // attention-grabbers live in the FIRST community's "general" channel so
  // every "busy" screen story can point at one predictable place.
  const primaryCommunity = communities[0];
  const threadRepliesByParent: Record<string, Message[]> = {};
  const pinnedByChannel: Record<string, Scenario['pinnedByChannel'][string]> = {};
  const voicePresenceByChannel: Record<string, Scenario['voicePresenceByChannel'][string]> = {};

  if (primaryCommunity) {
    const general = primaryCommunity.channels.find((c) => c.name === 'general');
    const generalMessages = general ? messagesByChannel[general.id] : undefined;

    if (general && generalMessages && generalMessages.length > 8) {
      const members = primaryCommunity.memberIds
        .map((id) => (id === me.id ? me : users.find((u) => u.id === id)))
        .filter((u): u is ScenarioUser => !!u);

      // Thread: pick a message a few rows back from the end and attach replies.
      const parentIdx = generalMessages.length - 6;
      const parent = generalMessages[parentIdx];
      const replies: Message[] = Array.from({ length: 4 }, (_, i) =>
        buildMessage(rng, general.id, pick(rng, members).id, 20 - i * 3, {
          parentMessageId: parent.id,
        }),
      );
      threadRepliesByParent[parent.id] = replies;
      generalMessages[parentIdx] = {
        ...parent,
        replyCount: replies.length,
        lastReplyAt: replies[replies.length - 1].sentAt,
      };

      // Pinned message: an early announcement-style message.
      const pinnedSource = generalMessages[1] ?? generalMessages[0];
      generalMessages[generalMessages.indexOf(pinnedSource)] = {
        ...pinnedSource,
        pinned: true,
        pinnedAt: timeAgo(60 * 24 * 3),
        pinnedBy: me.id,
      };
      const pinnedAuthor = pinnedSource.authorId === me.id ? me : findMember(members, pinnedSource.authorId);
      pinnedByChannel[general.id] = [
        {
          id: pinnedSource.id,
          channelId: general.id,
          directMessageGroupId: null,
          authorId: pinnedSource.authorId,
          spans: pinnedSource.spans as never,
          reactions: pinnedSource.reactions as never,
          sentAt: pinnedSource.sentAt,
          editedAt: pinnedSource.editedAt ?? null,
          deletedAt: null,
          pinned: true,
          pinnedAt: timeAgo(60 * 24 * 3),
          pinnedBy: me.id,
          replyCount: 0,
          lastReplyAt: null,
          searchText: null,
          pendingAttachments: 0,
          deletedBy: null,
          deletedByReason: null,
          parentMessageId: null,
          attachments: [],
          author: pinnedAuthor
            ? {
                id: pinnedAuthor.id,
                username: pinnedAuthor.username,
                displayName: pinnedAuthor.displayName,
                avatarUrl: pinnedAuthor.avatarUrl,
              }
            : null,
        },
      ];

      // Image attachment message.
      const imageAuthor = pick(rng, members);
      const imageMsg = buildMessage(rng, general.id, imageAuthor.id, 8, {
        spans: [createSpan({ text: 'check out this screenshot' })],
        attachments: [
          {
            id: 'attach-screenshot-1',
            filename: 'screenshot.png',
            mimeType: 'image/png',
            fileType: 'IMAGE',
            size: 245_760,
          } as never,
        ],
      });
      generalMessages.push(imageMsg);

      // A final "just now" message from me.
      generalMessages.push(buildMessage(rng, general.id, me.id, 1, {
        spans: [createSpan({ text: "alright, that's everything from me for today 🙂" })],
      }));
    }

    // Voice presence: 3 people hanging out in the first voice channel.
    const voiceChannel = primaryCommunity.channels.find((c) => c.type === 'VOICE');
    if (voiceChannel) {
      const members = primaryCommunity.memberIds
        .map((id) => (id === me.id ? me : users.find((u) => u.id === id)))
        .filter((u): u is ScenarioUser => !!u);
      const talkers = pickMany(rng, members, Math.min(3, members.length));
      voicePresenceByChannel[voiceChannel.id] = talkers.map((u, i) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName ?? undefined,
        avatarUrl: u.avatarUrl ?? undefined,
        joinedAt: timeAgo(20 - i * 4),
        isDeafened: false,
        isServerMuted: false,
      }));
    }
  }

  function findMember(members: ScenarioUser[], id: string | null): ScenarioUser | undefined {
    if (!id) return undefined;
    return members.find((u) => u.id === id) ?? (id === me.id ? me : undefined);
  }

  // DM groups.
  const dmGroups: Scenario['dmGroups'] = [];
  const messagesByDmGroup: Record<string, Message[]> = {};
  const unreadByContextId: Record<string, { unreadCount: number; mentionCount: number }> = {};
  const dmPartners = pickMany(rng, users, Math.min(dmGroupCount, users.length));
  dmPartners.forEach((partner, i) => {
    const dmId = `dm-${i + 1}`;
    const isGroup = i === dmPartners.length - 1 && dmPartners.length > 2;
    const extraMember = isGroup ? pick(rng, users.filter((u) => u.id !== partner.id)) : null;
    const memberList = [me, partner, ...(extraMember ? [extraMember] : [])];
    const dmMessages = Array.from({ length: int(rng, 3, 14) }, (_, m) =>
      buildMessage(rng, '', pick(rng, memberList).id, (14 - m) * 7, { channelId: null, directMessageGroupId: dmId }),
    );
    messagesByDmGroup[dmId] = dmMessages;
    const last = dmMessages[dmMessages.length - 1];
    dmGroups.push({
      id: dmId,
      name: isGroup ? `${partner.displayName?.split(' ')[0]}, ${extraMember?.displayName?.split(' ')[0]} + you` : null,
      isGroup,
      createdAt: timeAgo(int(rng, 60 * 24, 60 * 24 * 60)),
      members: memberList.map((u) => createDmGroupMember({
        userId: u.id,
        user: { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl },
      })),
      lastMessage: last
        ? { id: last.id, authorId: last.authorId, spans: last.spans as never, sentAt: last.sentAt }
        : null,
    } as never);

    if (chance(rng, 0.5)) {
      unreadByContextId[dmId] = { unreadCount: int(rng, 1, 9), mentionCount: chance(rng, 0.3) ? 1 : 0 };
    }
  });

  // Notifications: mentions + DM previews, most recent first.
  const notifications: NotificationDto[] = Array.from({ length: notificationCount }, (_, i) => {
    const author = pick(rng, users);
    const type = pick(rng, ['USER_MENTION', 'DIRECT_MESSAGE', 'THREAD_REPLY', 'CHANNEL_MESSAGE'] as const);
    const community = pick(rng, communities);
    const channel = pick(rng, community.channels.filter((c) => c.type === 'TEXT'));
    return {
      id: `notif-${i + 1}`,
      type,
      userId: me.id,
      messageId: `notif-msg-${i + 1}`,
      channelId: type === 'DIRECT_MESSAGE' ? null : channel.id,
      directMessageGroupId: type === 'DIRECT_MESSAGE' ? pick(rng, dmGroups).id : null,
      communityId: type === 'DIRECT_MESSAGE' ? null : community.id,
      authorId: author.id,
      parentMessageId: null,
      read: i > 2,
      dismissed: false,
      createdAt: timeAgo(i * 27 + int(rng, 1, 10)),
      author: { id: author.id, username: author.username, displayName: author.displayName, avatarUrl: author.avatarUrl },
      message: {
        spans: [createSpan({ text: pick(rng, MESSAGE_TEMPLATES) })] as never,
        id: `notif-msg-${i + 1}`,
        channelId: type === 'DIRECT_MESSAGE' ? null : channel.id,
        directMessageGroupId: type === 'DIRECT_MESSAGE' ? pick(rng, dmGroups).id : null,
      },
    };
  });

  // Friendships: a handful accepted, one pending incoming.
  const friendCandidates = pickMany(rng, users, Math.min(5, users.length));
  const friendships: Scenario['friendships'] = friendCandidates.map((u, i) =>
    createFriendship({
      userAId: me.id,
      userBId: u.id,
      userA: me as never,
      userB: u as never,
      status: i === 0 ? 'PENDING' : 'ACCEPTED',
    }),
  );

  // Memberships + roles per community.
  const membershipsByCommunity: Record<string, MembershipResponseDto[]> = {};
  const rolesByCommunity: Record<string, RoleDto[]> = {};
  for (const community of communities) {
    const ownerRole: RoleDto = {
      actions: ['CREATE_MESSAGE', 'READ_MESSAGE', 'READ_CHANNEL', 'READ_COMMUNITY', 'UPDATE_COMMUNITY', 'CREATE_CHANNEL', 'DELETE_CHANNEL', 'UPDATE_CHANNEL', 'CREATE_ROLE', 'PIN_MESSAGE', 'UNPIN_MESSAGE', 'BAN_USER', 'KICK_USER'] as never,
      id: `role-owner-${community.id}`,
      name: 'Owner',
      createdAt: community.createdAt,
      isDefault: true,
      position: 0,
    };
    const memberRole: RoleDto = {
      actions: ['CREATE_MESSAGE', 'READ_MESSAGE', 'READ_CHANNEL', 'READ_COMMUNITY'] as never,
      id: `role-member-${community.id}`,
      name: 'Member',
      createdAt: community.createdAt,
      isDefault: true,
      position: 1,
    };
    rolesByCommunity[community.id] = [ownerRole, memberRole];

    membershipsByCommunity[community.id] = community.memberIds.map((id, idx) => {
      const user = id === me.id ? me : users.find((u) => u.id === id)!;
      return {
        id: `membership-${community.id}-${idx}`,
        userId: id,
        communityId: community.id,
        joinedAt: timeAgo(int(rng, 60 * 24, 60 * 24 * 120)),
        roles: [id === me.id ? ownerRole : memberRole],
        user: user as never,
      };
    });
  }

  // The real backend orders strictly by `sentAt`; the extras appended above
  // (image message at 8 min ago, etc.) can land out of chronological order,
  // so normalize every list to ascending `sentAt` (handlers.ts reverses).
  const bySentAt = (a: Message, b: Message) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
  for (const list of Object.values(messagesByChannel)) list.sort(bySentAt);
  for (const list of Object.values(messagesByDmGroup)) list.sort(bySentAt);

  return {
    seed,
    me,
    users,
    communities,
    messagesByChannel,
    threadRepliesByParent,
    pinnedByChannel,
    voicePresenceByChannel,
    dmGroups,
    messagesByDmGroup,
    unreadByContextId,
    notifications,
    friendships,
    membershipsByCommunity,
    rolesByCommunity,
    instanceName,
  };
}
