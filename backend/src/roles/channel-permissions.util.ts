import { OverwriteTarget, RbacActions } from '@prisma/client';

/**
 * Channel permission resolution: the pure core shared by the RBAC guard
 * (PermissionsService) and the effective-permissions endpoints, so the two
 * can never disagree. Design: docs/superpowers/plans/2026-10-04-channel-permissions-design.md
 */

/** Actions a channel overwrite may change. Everything else is community-scoped. */
export const CHANNEL_SCOPED_ACTIONS: ReadonlySet<RbacActions> = new Set([
  RbacActions.READ_CHANNEL,
  RbacActions.READ_MESSAGE,
  RbacActions.CREATE_MESSAGE,
  RbacActions.ATTACH_FILES,
  RbacActions.CREATE_REACTION,
  RbacActions.PIN_MESSAGE,
  RbacActions.UNPIN_MESSAGE,
  RbacActions.DELETE_ANY_MESSAGE,
  RbacActions.JOIN_CHANNEL,
  RbacActions.SPEAK,
  RbacActions.VIDEO,
  RbacActions.SCREEN_SHARE,
  RbacActions.MUTE_PARTICIPANT,
  RbacActions.CAPTURE_REPLAY,
  RbacActions.READ_SOUNDBOARD_SOUND,
]);

/**
 * Actions the overwrite API accepts in phase 1. READ_CHANNEL (visibility)
 * waits for phase 3, when every visibility query goes through one service.
 */
export const OVERWRITABLE_ACTIONS: ReadonlySet<RbacActions> = new Set(
  [...CHANNEL_SCOPED_ACTIONS].filter(
    (a) =>
      // Visibility and history reads wait for phase 3: search, attachment
      // downloads, notifications and live message delivery check only view,
      // so a READ_MESSAGE deny would not actually hide anything yet.
      a !== RbacActions.READ_CHANNEL && a !== RbacActions.READ_MESSAGE,
  ),
);

/**
 * What a community timeout takes away (anti-spam). Connecting to voice and
 * listening (JOIN_CHANNEL) stays; thread replies are CREATE_MESSAGE.
 */
export const TIMEOUT_BLOCKED_ACTIONS: ReadonlySet<RbacActions> = new Set([
  RbacActions.CREATE_MESSAGE,
  RbacActions.CREATE_REACTION,
  RbacActions.ATTACH_FILES,
  RbacActions.SPEAK,
  RbacActions.VIDEO,
  RbacActions.SCREEN_SHARE,
]);

/**
 * Lockout safeguard: holders of MANAGE_CHANNEL_PERMISSIONS can always use
 * these on a channel, even a private one they are not a member of, so no
 * overwrite or privacy setting can stop them fixing it.
 */
export const CHANNEL_MANAGEMENT_ACTIONS: ReadonlySet<RbacActions> = new Set([
  RbacActions.MANAGE_CHANNEL_PERMISSIONS,
]);

export interface OverwriteInput {
  targetType: OverwriteTarget;
  roleId: string | null;
  userId: string | null;
  allow: RbacActions[];
  deny: RbacActions[];
}

export interface ChannelPermissionInput {
  userId: string;
  /** Union of the user's community role actions. */
  baseActions: Iterable<RbacActions>;
  /** Ids of the user's community roles (only those with an overwrite matter). */
  roleIds: Iterable<string>;
  /** Whether the user is a member of the channel's community. */
  isCommunityMember: boolean;
  isPrivate: boolean;
  /** Whether the user has a ChannelMembership row (private channels). */
  hasChannelMembership: boolean;
  overwrites: OverwriteInput[];
  timedOut: boolean;
}

function channelScoped(actions: RbacActions[]): RbacActions[] {
  return actions.filter((a) => CHANNEL_SCOPED_ACTIONS.has(a));
}

function removeChannelScoped(set: Set<RbacActions>): void {
  for (const action of CHANNEL_SCOPED_ACTIONS) set.delete(action);
}

/** Membership part of the view gate (overwrites are checked separately). */
function passesViewGate(input: ChannelPermissionInput): boolean {
  return (
    input.isCommunityMember && !(input.isPrivate && !input.hasChannelMembership)
  );
}

/**
 * Whether the user can see the channel at all: its name, id, metadata and
 * content. THE visibility rule; every listing, search, room join and
 * notification goes through it (via ChannelAccessService).
 *
 * A user whose roles never had READ_CHANNEL still sees channels that pass the
 * membership gate (as before overwrites existed); an overwrite that removes
 * READ_CHANNEL hides the channel.
 */
export function canViewChannel(input: ChannelPermissionInput): boolean {
  return passesViewGate(input) && overwritesAllowView(input);
}

/**
 * READ_CHANNEL run through the overwrite layers, starting from "visible":
 * a member always saw the channels passing the membership gate (whether or
 * not their roles list READ_CHANNEL), so only an overwrite that ends up
 * denying READ_CHANNEL hides it. Starting from the roles' READ_CHANNEL
 * instead would let users whose roles lack it see channels an EVERYONE deny
 * hides.
 */
function overwritesAllowView(input: ChannelPermissionInput): boolean {
  return computeOverwrites(
    new Set([...input.baseActions, RbacActions.READ_CHANNEL]),
    input,
  ).has(RbacActions.READ_CHANNEL);
}

/**
 * Whether every community member with READ_CHANNEL sees this channel, i.e.
 * its events can go to the community room. False for private channels and
 * channels whose EVERYONE overwrite denies READ_CHANNEL.
 */
export function isVisibleToWholeCommunity(channel: {
  isPrivate: boolean;
  overwrites: OverwriteInput[];
}): boolean {
  if (channel.isPrivate) return false;
  return !channel.overwrites.some(
    (o) =>
      o.targetType === OverwriteTarget.EVERYONE &&
      o.deny.includes(RbacActions.READ_CHANNEL),
  );
}

/** The compact per-channel capability shape the frontend renders from. */
export interface ChannelCapabilities {
  view: boolean;
  post: boolean;
  attach: boolean;
  react: boolean;
  /** Thread replies follow CREATE_MESSAGE (no separate action in v1). */
  threadReply: boolean;
  /** Connect to voice and listen. A timeout keeps this. */
  connect: boolean;
  speak: boolean;
  video: boolean;
  share: boolean;
  managePermissions: boolean;
}

export const ALL_CAPABILITIES: ChannelCapabilities = {
  view: true,
  post: true,
  attach: true,
  react: true,
  threadReply: true,
  connect: true,
  speak: true,
  video: true,
  share: true,
  managePermissions: true,
};

export function toCapabilities(
  input: ChannelPermissionInput,
): ChannelCapabilities {
  const view = canViewChannel(input);
  const effective = computeChannelActions(input);
  const base = new Set(input.baseActions);
  const has = (a: RbacActions) => view && effective.has(a);
  return {
    view,
    post: has(RbacActions.CREATE_MESSAGE),
    attach: has(RbacActions.ATTACH_FILES),
    react: has(RbacActions.CREATE_REACTION),
    threadReply: has(RbacActions.CREATE_MESSAGE),
    connect: has(RbacActions.JOIN_CHANNEL),
    speak: has(RbacActions.SPEAK),
    video: has(RbacActions.VIDEO),
    share: has(RbacActions.SCREEN_SHARE),
    // Community-scoped: holds on every channel, visible or not (lockout safeguard).
    managePermissions: base.has(RbacActions.MANAGE_CHANNEL_PERMISSIONS),
  };
}

/**
 * The user's effective actions in a channel (community-scoped actions pass
 * through unchanged). Order:
 *
 *  1. base = union of community role actions
 *  2. EVERYONE overwrite: (base - deny) + allow
 *  3. ROLE overwrites of all the user's roles: (base - union deny) + union allow
 *     (any role's allow beats any role's deny)
 *  4. MEMBER overwrite: (base - deny) + allow   (data model only for now)
 *  5. view gate: a private channel without ChannelMembership, a non-member
 *     of the community, or an overwrite that removed READ_CHANNEL leaves no
 *     channel-scoped action at all
 *  6. timeout mask: TIMEOUT_BLOCKED_ACTIONS removed
 *
 * The instance OWNER bypass is applied by callers, before this runs.
 */
export function computeChannelActions(
  input: ChannelPermissionInput,
): Set<RbacActions> {
  const effective = computeOverwrites(new Set(input.baseActions), input);

  if (!canViewChannel(input)) {
    removeChannelScoped(effective);
  }

  if (input.timedOut) {
    for (const action of TIMEOUT_BLOCKED_ACTIONS) effective.delete(action);
  }

  return effective;
}

/** Applies EVERYONE, then ROLE, then MEMBER overwrites to `effective`. */
function computeOverwrites(
  effective: Set<RbacActions>,
  input: ChannelPermissionInput,
): Set<RbacActions> {
  const apply = (deny: RbacActions[], allow: RbacActions[]) => {
    for (const action of channelScoped(deny)) effective.delete(action);
    for (const action of channelScoped(allow)) effective.add(action);
  };

  const everyone = input.overwrites.find(
    (o) => o.targetType === OverwriteTarget.EVERYONE,
  );
  if (everyone) apply(everyone.deny, everyone.allow);

  const roleIds = new Set(input.roleIds);
  const roleOverwrites = input.overwrites.filter(
    (o) =>
      o.targetType === OverwriteTarget.ROLE &&
      o.roleId !== null &&
      roleIds.has(o.roleId),
  );
  if (roleOverwrites.length > 0) {
    apply(
      roleOverwrites.flatMap((o) => o.deny),
      roleOverwrites.flatMap((o) => o.allow),
    );
  }

  const member = input.overwrites.find(
    (o) => o.targetType === OverwriteTarget.MEMBER && o.userId === input.userId,
  );
  if (member) apply(member.deny, member.allow);

  return effective;
}

/**
 * Whether `required` is granted on a channel. Adds the private-channel gate
 * for community-scoped actions (today's behaviour: non-members of a private
 * channel can't act on it at all) and its one exception, the lockout
 * safeguard for channel managers.
 */
export function channelActionsGranted(
  input: ChannelPermissionInput,
  required: RbacActions[],
): boolean {
  const base = new Set(input.baseActions);
  if (input.isPrivate && !input.hasChannelMembership) {
    const managing =
      base.has(RbacActions.MANAGE_CHANNEL_PERMISSIONS) &&
      required.every((a) => CHANNEL_MANAGEMENT_ACTIONS.has(a));
    if (!managing) return false;
  }
  const effective = computeChannelActions(input);
  return required.every((a) => effective.has(a));
}
