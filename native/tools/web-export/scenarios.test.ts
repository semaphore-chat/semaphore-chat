/**
 * Exports the web client's Ladle scenarios as JSON for native stories (unit U3).
 *
 * Run with `native/scripts/export-web.sh scenarios`; it writes
 * `native-export-out/scenarios/<name>.json`, which `scripts/gen-scenarios.sh` copies to
 * `native/fixtures/scenarios/`.
 *
 * The scenario objects are richer than the wire (cache-enriched users and messages), so every
 * value is normalised to the shape declared by `contract/openapi.json` on the way out. The
 * normalisations are listed in the U3 report; keep them here, not in the validator, so the
 * committed JSON is what a story actually sees.
 */
import { it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Scenario } from '../../stories/fixtures/types';

/**
 * `builder.ts` leaves the channel, DM-member and friendship timestamps it doesn't pass to
 * `timeAgo()` to `new Date()`, so every export would differ. Pin the clock to `rng.ts`'s epoch
 * (2026-09-22T18:00:00Z) *before* the fixtures build their presets at import time; otherwise
 * `gen-scenarios.sh --check` can never pass. Only `Date` is faked.
 */
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-22T18:00:00.000Z') });

// Loaded after the clock is pinned, because these modules build their scenarios on import.
const { buildScenario } = await import('../../stories/fixtures/builder');
const { bigCommunityScenario, emptyUserScenario } = await import(
  '../../stories/fixtures/scenarios'
);
const { showcaseScenario } = await import('../../stories/fixtures/showcase');

type Json = Record<string, unknown>;

const object = (value: unknown): Json => (value ?? {}) as Json;
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `UserEntity`: the scenario user also carries the profile-only `email`, which the entity omits. */
function wireUser(value: unknown): Json {
  const user = object(value);
  return {
    role: user.role ?? 'USER',
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl ?? null,
    bannerUrl: user.bannerUrl ?? null,
    lastSeen: user.lastSeen ?? null,
    displayName: user.displayName ?? null,
    bio: user.bio ?? null,
    status: user.status ?? null,
  };
}

/** `ChannelDto`. The factory's channels already match; listed fields keep extra ones out. */
function wireChannel(value: unknown): Json {
  const channel = object(value);
  return {
    type: channel.type,
    position: channel.position,
    slowmodeSeconds: channel.slowmodeSeconds,
    preset: channel.preset,
    id: channel.id,
    name: channel.name,
    communityId: channel.communityId,
    createdAt: channel.createdAt,
    isPrivate: channel.isPrivate,
  };
}

/**
 * `SpanDto`. The factories leave the nullable targeting fields `undefined` for plain text, and
 * `JSON.stringify` drops them; the contract requires them, so they become explicit nulls.
 */
function wireSpan(value: unknown): Json {
  const span = object(value);
  const wire: Json = {
    type: span.type,
    text: span.text ?? null,
    userId: span.userId ?? null,
    specialKind: span.specialKind ?? null,
    communityId: span.communityId ?? null,
    aliasId: span.aliasId ?? null,
  };
  for (const key of ['channelId', 'emojiId']) {
    if (span[key] !== undefined) wire[key] = span[key] ?? null;
  }
  for (const key of ['bold', 'italic', 'strikethrough', 'code']) {
    if (span[key] !== undefined) wire[key] = span[key] ?? null;
  }
  return wire;
}

/**
 * `AttachmentDto`. `builder.ts` builds the screenshot attachment inline without `hasThumbnail`,
 * which the contract requires; the factory's own default is false.
 */
function wireAttachment(value: unknown): Json {
  const attachment = object(value);
  return {
    fileType: attachment.fileType,
    size: attachment.size,
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    hasThumbnail: attachment.hasThumbnail ?? false,
  };
}

function wireReaction(value: unknown): Json {
  const reaction = object(value);
  return { emoji: reaction.emoji, userIds: array(reaction.userIds) };
}

function wireReplyTo(value: unknown): Json | null {
  if (value == null) return null;
  const reply = object(value);
  return {
    sentAt: reply.sentAt,
    deletedAt: reply.deletedAt ?? null,
    id: reply.id,
    authorId: reply.authorId ?? null,
    spans: array(reply.spans).map(wireSpan),
  };
}

/**
 * `MessageDto`. A scenario message is a cache-enriched message: some carry a nested `author`
 * object the wire never sends (the client resolves authors itself). Every declared field is
 * emitted, so an omitted optional field can't silently change meaning.
 */
function wireMessage(value: unknown): Json {
  const message = object(value);
  return {
    pendingAttachments: message.pendingAttachments ?? 0,
    linkPreviews: message.linkPreviews ?? null,
    replyCount: message.replyCount ?? 0,
    lastReplyAt: message.lastReplyAt ?? null,
    pinnedAt: message.pinnedAt ?? null,
    sentAt: message.sentAt,
    editedAt: message.editedAt ?? null,
    deletedAt: message.deletedAt ?? null,
    replyTo: wireReplyTo(message.replyTo),
    webhook: message.webhook ?? null,
    id: message.id,
    channelId: message.channelId ?? null,
    directMessageGroupId: message.directMessageGroupId ?? null,
    authorId: message.authorId ?? null,
    spans: array(message.spans).map(wireSpan),
    attachments: array(message.attachments).map(wireAttachment),
    reactions: array(message.reactions).map(wireReaction),
    pinned: message.pinned ?? false,
    pinnedBy: message.pinnedBy ?? null,
    parentMessageId: message.parentMessageId ?? null,
    replyToId: message.replyToId ?? null,
  };
}

/** `PinnedMessageDto` is a `MessageDto` plus the author it was pinned by. */
function wirePinnedMessage(value: unknown): Json {
  const message = object(value);
  const author = message.author == null ? null : object(message.author);
  return {
    ...wireMessage(message),
    author:
      author == null
        ? null
        : {
            id: author.id,
            username: author.username,
            displayName: author.displayName ?? null,
            avatarUrl: author.avatarUrl ?? null,
          },
  };
}

function wireRole(value: unknown): Json {
  const role = object(value);
  return {
    actions: array(role.actions),
    position: role.position,
    id: role.id,
    name: role.name,
    createdAt: role.createdAt,
    isDefault: role.isDefault,
  };
}

/** `MembershipResponseDto`; its embedded `user` is a `UserEntity`. */
function wireMembership(value: unknown): Json {
  const membership = object(value);
  const wire: Json = {
    roles: array(membership.roles).map(wireRole),
    id: membership.id,
    userId: membership.userId,
    communityId: membership.communityId,
    joinedAt: membership.joinedAt,
  };
  if (membership.user !== undefined) wire.user = wireUser(membership.user);
  if (membership.community !== undefined) wire.community = membership.community;
  return wire;
}

/**
 * `VoicePresenceUserDto`. `displayName` and `avatarUrl` are optional but not nullable there, so
 * a user who never set them is omitted rather than sent as null.
 */
function wireVoicePresence(value: unknown): Json {
  const presence = object(value);
  const wire: Json = {
    id: presence.id,
    username: presence.username,
    joinedAt: presence.joinedAt,
    isDeafened: presence.isDeafened ?? false,
    isServerMuted: presence.isServerMuted ?? false,
  };
  if (typeof presence.displayName === 'string') wire.displayName = presence.displayName;
  if (typeof presence.avatarUrl === 'string') wire.avatarUrl = presence.avatarUrl;
  return wire;
}

function mapValues<T>(record: Record<string, T[]>, map: (value: T) => unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, values]) => [key, values.map(map)]));
}

/**
 * The `Scenario` shape from `types.ts`, with the entities the contract covers (and every
 * embedded `UserEntity`) normalised to the wire. Everything else passes through.
 */
function wireScenario(scenario: Scenario): Json {
  return {
    seed: scenario.seed,
    me: wireUser(scenario.me),
    users: scenario.users.map(wireUser),
    communities: scenario.communities.map((community) => ({
      ...community,
      channels: community.channels.map(wireChannel),
    })),
    messagesByChannel: mapValues(scenario.messagesByChannel, wireMessage),
    threadRepliesByParent: mapValues(scenario.threadRepliesByParent, wireMessage),
    pinnedByChannel: mapValues(scenario.pinnedByChannel, wirePinnedMessage),
    voicePresenceByChannel: mapValues(scenario.voicePresenceByChannel, wireVoicePresence),
    dmGroups: scenario.dmGroups,
    messagesByDmGroup: mapValues(scenario.messagesByDmGroup, wireMessage),
    unreadByContextId: scenario.unreadByContextId,
    notifications: scenario.notifications,
    friendships: scenario.friendships.map((friendship) => ({
      ...friendship,
      userA: wireUser(friendship.userA),
      userB: wireUser(friendship.userB),
    })),
    membershipsByCommunity: mapValues(scenario.membershipsByCommunity, wireMembership),
    rolesByCommunity: mapValues(scenario.rolesByCommunity, wireRole),
    instanceName: scenario.instanceName,
  };
}

/**
 * What the web scenarios don't model but the native client's DM, friends and notification screens
 * and the fake server need, added to the showcase only (so the other fixtures stay as they were):
 *
 * - an outgoing friend request (the scenario has only an incoming one),
 * - one dismissed notification (read and dismissed, so the list shows a row the client must keep),
 * - the signed-in user's notification settings, at the server's defaults,
 * - one per-channel override (the Trail Ridge general channel, muted).
 *
 * The ids are readable like the rest; the fake server serves them as UUIDs.
 */
function withNotifyData(scenario: Scenario, wire: Json): Json {
  const epoch = '2026-09-22T18:00:00.000Z';
  const other = scenario.users.find((user) => user.id === 'u-tomas');
  if (!other) throw new Error('the showcase has no u-tomas');
  const dismissId = 'sc-notif-sc-trail-ridge';
  if (!array(wire.notifications).some((n) => object(n).id === dismissId)) {
    throw new Error(`the showcase has no ${dismissId}`);
  }
  return {
    ...wire,
    friendships: [
      ...array(wire.friendships),
      {
        id: 'sc-friend-out-u-tomas',
        status: 'PENDING',
        userAId: scenario.me.id,
        userA: wireUser(scenario.me),
        userBId: other.id,
        userB: wireUser(other),
        createdAt: '2026-08-17T14:00:00.000Z',
      },
    ],
    notifications: array(wire.notifications).map((n) =>
      object(n).id === dismissId ? { ...object(n), read: true, dismissed: true } : n,
    ),
    notificationSettings: {
      id: 'sc-notif-settings',
      userId: scenario.me.id,
      desktopEnabled: true,
      playSound: true,
      soundType: 'default',
      doNotDisturb: false,
      dndStartTime: null,
      dndEndTime: null,
      dndTimezone: null,
      defaultChannelLevel: 'mentions',
      dmNotifications: true,
      createdAt: epoch,
      updatedAt: epoch,
    },
    channelOverrides: [
      {
        id: 'sc-notif-override-tr-general',
        userId: scenario.me.id,
        channelId: 'tr-general',
        level: 'none',
        createdAt: epoch,
        updatedAt: epoch,
      },
    ],
  };
}

/** Key-sorted, so a re-export is byte-identical unless the scenario changed. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Json)
        .sort()
        .map((key) => [key, sorted((value as Json)[key])]),
    );
  }
  return value;
}

it('exports the web scenarios', () => {
  const scenarios: Record<string, Scenario> = {
    'big-community': bigCommunityScenario,
    'empty-user': emptyUserScenario,
    showcase: showcaseScenario,
    'long-history': buildScenario({ seed: 'long-history', messagesInGeneral: 2000 }),
  };
  mkdirSync('native-export-out/scenarios', { recursive: true });
  for (const [name, scenario] of Object.entries(scenarios)) {
    const wire = wireScenario(scenario);
    writeFileSync(
      `native-export-out/scenarios/${name}.json`,
      `${JSON.stringify(sorted(name === 'showcase' ? withNotifyData(scenario, wire) : wire), null, 2)}\n`,
    );
  }
});
