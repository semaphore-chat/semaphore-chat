import type {
  UserEntity,
  FriendshipWithUsersDto,
  MembershipResponseDto,
  RoleDto,
  NotificationDto,
  VoicePresenceUserDto,
  PinnedMessageDto,
} from '../../api-client/types.gen';
import type { Channel } from '../../types/channel.type';
import type { Message } from '../../types/message.type';
import type { DirectMessageGroup } from '../../types/direct-message.type';

/** A user as returned by the profile/user-list endpoints (email is profile-only). */
export type ScenarioUser = UserEntity & { email: string };

export interface ScenarioCommunity {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  banner: string | null;
  createdAt: string;
  /** Text + voice channels, in display order. */
  channels: Channel[];
  /** Member ids (subset of scenario.users + scenario.me). */
  memberIds: string[];
  ownerId: string;
}

/**
 * A fully-built, self-consistent fake dataset for the Ladle sandbox.
 *
 * Built by `buildScenario()` and optionally reshaped by the `with*`
 * modifiers in `modifiers.ts`. Everything MSW needs to answer a request is
 * reachable from this object — `makeHandlers()` never invents data beyond
 * generic fallbacks.
 */
export interface Scenario {
  seed: string;
  me: ScenarioUser;
  /** Every other user (not including `me`). */
  users: ScenarioUser[];
  communities: ScenarioCommunity[];
  /** Messages for every channel, text or voice, keyed by channel id. */
  messagesByChannel: Record<string, Message[]>;
  /** Thread replies keyed by the parent message id. */
  threadRepliesByParent: Record<string, Message[]>;
  /** Pinned messages keyed by channel id. */
  pinnedByChannel: Record<string, PinnedMessageDto[]>;
  /** Voice presence keyed by channel id. */
  voicePresenceByChannel: Record<string, VoicePresenceUserDto[]>;
  dmGroups: DirectMessageGroup[];
  /** Messages for every DM group, keyed by dm group id. */
  messagesByDmGroup: Record<string, Message[]>;
  /** Unread channel-message counts, keyed by dm group id or channel id. */
  unreadByContextId: Record<string, { unreadCount: number; mentionCount: number }>;
  notifications: NotificationDto[];
  friendships: FriendshipWithUsersDto[];
  membershipsByCommunity: Record<string, MembershipResponseDto[]>;
  rolesByCommunity: Record<string, RoleDto[]>;
  instanceName: string;
}

/** Every user, `me` included — convenient for id-based lookups. */
export function allScenarioUsers(scenario: Scenario): ScenarioUser[] {
  return [scenario.me, ...scenario.users];
}

export function findScenarioUser(scenario: Scenario, id: string): ScenarioUser | undefined {
  return allScenarioUsers(scenario).find((u) => u.id === id);
}

export function findChannel(scenario: Scenario, channelId: string): { channel: Channel; community: ScenarioCommunity } | undefined {
  for (const community of scenario.communities) {
    const channel = community.channels.find((c) => c.id === channelId);
    if (channel) return { channel, community };
  }
  return undefined;
}
