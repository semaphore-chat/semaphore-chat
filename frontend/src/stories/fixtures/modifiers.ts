/**
 * Scenario modifiers — small, composable functions that take a `Scenario`
 * and return a new one with one thing changed. Chain them:
 *
 *   const scenario = withEmpty(withUnread(buildScenario(), 'dm-1', 4), 'notifications');
 *
 * Each modifier only touches the slice of the scenario it names; everything
 * else is passed through by reference so unrelated stories built from the
 * same base scenario are unaffected.
 */
import { createMessage, createSpan, createFileMetadata } from '../../__tests__/test-utils/factories';
import type { Message } from '../../types/message.type';
import type { Scenario, ScenarioUser } from './types';
import { timeAgo } from './rng';
import type { VoicePresenceUserDto } from '../../api-client/types.gen';

/** Give `me` + the first few users unrealistically long names, to stress-test truncation/wrapping. */
export function withLongNames(scenario: Scenario): Scenario {
  const longen = (u: ScenarioUser): ScenarioUser => ({
    ...u,
    displayName: `${u.displayName ?? u.username} Featherstonehaugh-Worthington III`,
  });
  return {
    ...scenario,
    me: longen(scenario.me),
    users: scenario.users.map((u, i) => (i < 3 ? longen(u) : u)),
    communities: scenario.communities.map((c, i) =>
      i === 0 ? { ...c, name: `${c.name}: An Extremely Long Community Name That Should Wrap Or Truncate Somewhere` } : c,
    ),
  };
}

/** Set (or clear, with count 0) the unread badge for a DM group or channel id. */
export function withUnread(scenario: Scenario, contextId: string, unreadCount: number, mentionCount = 0): Scenario {
  const next = { ...scenario.unreadByContextId };
  if (unreadCount <= 0) {
    delete next[contextId];
  } else {
    next[contextId] = { unreadCount, mentionCount };
  }
  return { ...scenario, unreadByContextId: next };
}

/** Seed `n` scenario users (or explicit users) into a voice channel's presence list. */
export function withVoiceParticipants(
  scenario: Scenario,
  channelId: string,
  participants: number | ScenarioUser[],
): Scenario {
  const pool = [scenario.me, ...scenario.users];
  const users = Array.isArray(participants) ? participants : pool.slice(0, participants);
  const list: VoicePresenceUserDto[] = users.map((u, i) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? undefined,
    avatarUrl: u.avatarUrl ?? undefined,
    joinedAt: timeAgo(15 - i * 3),
    isDeafened: false,
    isServerMuted: false,
  }));
  return {
    ...scenario,
    voicePresenceByChannel: { ...scenario.voicePresenceByChannel, [channelId]: list },
  };
}

/** Attach `replyCount` thread replies to a message (by id) in a channel. */
export function withThread(scenario: Scenario, channelId: string, parentMessageId: string, replyCount: number): Scenario {
  const messages = scenario.messagesByChannel[channelId];
  if (!messages) return scenario;
  const parentIdx = messages.findIndex((m) => m.id === parentMessageId);
  if (parentIdx === -1) return scenario;

  const pool = [scenario.me, ...scenario.users];
  const replies: Message[] = Array.from({ length: replyCount }, (_, i) =>
    createMessage({
      channelId,
      authorId: pool[i % pool.length].id,
      parentMessageId,
      spans: [createSpan({ text: `reply #${i + 1}` })],
      sentAt: timeAgo(replyCount - i),
    }),
  );

  const updatedMessages = [...messages];
  updatedMessages[parentIdx] = {
    ...messages[parentIdx],
    replyCount,
    lastReplyAt: replies.length ? replies[replies.length - 1].sentAt : null,
  };

  return {
    ...scenario,
    messagesByChannel: { ...scenario.messagesByChannel, [channelId]: updatedMessages },
    threadRepliesByParent: { ...scenario.threadRepliesByParent, [parentMessageId]: replies },
  };
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';

const ATTACHMENT_PRESETS: Record<AttachmentKind, { mimeType: string; fileType: string; filename: string }> = {
  image: { mimeType: 'image/png', fileType: 'IMAGE', filename: 'photo.png' },
  video: { mimeType: 'video/mp4', fileType: 'VIDEO', filename: 'clip.mp4' },
  audio: { mimeType: 'audio/mpeg', fileType: 'AUDIO', filename: 'voice-note.mp3' },
  document: { mimeType: 'application/pdf', fileType: 'DOCUMENT', filename: 'notes.pdf' },
};

/** Append a message with a `kind` attachment to the end of a channel. */
export function withAttachments(scenario: Scenario, channelId: string, kind: AttachmentKind, authorId?: string): Scenario {
  const messages = scenario.messagesByChannel[channelId] ?? [];
  const preset = ATTACHMENT_PRESETS[kind];
  const author = authorId ?? scenario.me.id;
  const message = createMessage({
    channelId,
    authorId: author,
    spans: [createSpan({ text: `here's the ${kind}` })],
    sentAt: timeAgo(1),
    attachments: [
      {
        ...createFileMetadata({ ...preset, id: `attach-${kind}-${messages.length + 1}` }),
      } as never,
    ],
  });
  return {
    ...scenario,
    messagesByChannel: { ...scenario.messagesByChannel, [channelId]: [...messages, message] },
  };
}

export type EmptySection =
  | 'communities'
  | 'dmGroups'
  | 'notifications'
  | 'friends'
  | { channelMessages: string }
  | { dmMessages: string };

/** Clear out a whole section of the scenario — the basis for "empty state" stories. */
export function withEmpty(scenario: Scenario, section: EmptySection): Scenario {
  if (section === 'communities') return { ...scenario, communities: [] };
  if (section === 'dmGroups') return { ...scenario, dmGroups: [], messagesByDmGroup: {} };
  if (section === 'notifications') return { ...scenario, notifications: [] };
  if (section === 'friends') return { ...scenario, friendships: [] };
  if (typeof section === 'object' && 'channelMessages' in section) {
    return {
      ...scenario,
      messagesByChannel: { ...scenario.messagesByChannel, [section.channelMessages]: [] },
    };
  }
  if (typeof section === 'object' && 'dmMessages' in section) {
    return {
      ...scenario,
      messagesByDmGroup: { ...scenario.messagesByDmGroup, [section.dmMessages]: [] },
    };
  }
  return scenario;
}
