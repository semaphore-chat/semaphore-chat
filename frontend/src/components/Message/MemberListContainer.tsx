import React from "react";
import MemberList, { type MemberData } from "./MemberList";
import { useQuery } from "@tanstack/react-query";
import {
  directMessagesControllerFindDmGroupOptions,
  channelMembershipControllerFindAllForChannelOptions,
  channelsControllerFindOneOptions,
} from "../../api-client/@tanstack/react-query.gen";
import {
  computeDisplayRole,
  sameDisplayRole,
  useBulkPresence,
  useCommunityMemberPages,
} from "../../data/members";
import { VoiceSessionType } from "../../contexts/VoiceContext";

interface MemberListContainerProps {
  contextType: VoiceSessionType;
  contextId: string;
  communityId?: string;
  isPrivate?: boolean;
  /** Fill the parent's width (e.g. the phone member drawer) instead of the 240px side column. */
  fullWidth?: boolean;
}

const MemberListContainer: React.FC<MemberListContainerProps> = ({
  contextType,
  contextId,
  communityId,
  isPrivate: isPrivateProp,
  fullWidth,
}) => {
  // The parent passes `isPrivate` from its own channel query. Until that
  // resolves — or if it fails (403 on a private channel, 404) — it's
  // undefined, and we can't pick which member endpoint to use. Subscribe to
  // the same channel query (shared cache key, so no duplicate request on the
  // happy path) so a failure surfaces as an error instead of an endless
  // skeleton.
  const isChannelContext = contextType === VoiceSessionType.Channel;
  const {
    data: channel,
    error: channelError,
    refetch: refetchChannel,
  } = useQuery({
    ...channelsControllerFindOneOptions({ path: { id: contextId } }),
    enabled: isChannelContext && isPrivateProp === undefined,
  });
  const isPrivate = isPrivateProp ?? channel?.isPrivate;
  // Only matters while we still don't know which list to load.
  const unresolvedChannelError = isChannelContext && isPrivate === undefined ? channelError : null;

  // For private channels, fetch channel-specific members
  const {
    data: channelMembers,
    isLoading: isChannelMembersLoading,
    error: channelMembersError,
    refetch: refetchChannelMembers,
  } = useQuery({
    ...channelMembershipControllerFindAllForChannelOptions({ path: { channelId: contextId } }),
    enabled: contextType === VoiceSessionType.Channel && !!isPrivate,
  });

  // For public channels, fetch community members — paginated (cursor
  // envelope), loading more progressively via the "Show more" affordance.
  const {
    memberships: communityMembers,
    isLoading: isCommunityLoading,
    error: communityError,
    refetch: refetchCommunityMembers,
    hasMore: hasNextPage,
    loadingMore: isFetchingNextPage,
    loadMore: handleLoadMoreMembers,
  } = useCommunityMemberPages(
    communityId,
    contextType === VoiceSessionType.Channel && isPrivate === false,
  );

  // For DM context, fetch DM group members
  const {
    data: dmGroup,
    isLoading: isDmLoading,
    error: dmError,
    refetch: refetchDm,
  } = useQuery({
    ...directMessagesControllerFindDmGroupOptions({ path: { id: contextId } }),
    enabled: contextType === VoiceSessionType.Dm,
  });

  // Get base member data first
  const baseMembers = React.useMemo(() => {
    if (contextType === VoiceSessionType.Channel) {
      if (isPrivate) {
        // Private channel: use channel-specific members (no roles available)
        return (channelMembers || [])
          .filter((membership) => membership.user)
          .map((membership) => ({
            id: membership.user!.id,
            username: membership.user!.username,
            displayName: membership.user!.displayName,
            avatarUrl: membership.user!.avatarUrl,
            status: membership.user!.status,
            displayRole: undefined as MemberData["displayRole"],
          }));
      }
      // Public channel: use community members (includes roles)
      return (communityMembers || [])
        .filter((membership) => membership.user)
        .map((membership) => ({
          id: membership.user!.id,
          username: membership.user!.username,
          displayName: membership.user!.displayName,
          avatarUrl: membership.user!.avatarUrl,
          status: membership.user!.status,
          displayRole: computeDisplayRole(membership.roles),
        }));
    } else {
      // DM context
      return (dmGroup?.members || [])
        .map((member) => ({
          id: member.user.id,
          username: member.user.username,
          displayName: member.user.displayName,
          avatarUrl: member.user.avatarUrl,
          // The DM members endpoint does not return a status field
          status: undefined,
          displayRole: undefined as MemberData["displayRole"],
        }));
    }
  }, [contextType, isPrivate, channelMembers, communityMembers, dmGroup]);

  // Presence for all members: every visible online user (bulk), so members
  // past the 200th are not shown offline (the per-ids endpoint reads 200).
  const {
    data: presenceData,
    isLoading: isPresenceLoading,
    error: presenceError,
    refetch: refetchPresence,
  } = useBulkPresence(baseMembers.length > 0);

  // Identity cache: preserves referential equality for member objects whose
  // row-relevant fields haven't changed, so React.memo(MemberRow) can skip
  // re-rendering members untouched by a given presence event. Rebuilt fresh
  // from baseMembers on every recompute, so members that disappear are
  // naturally evicted.
  const memberIdentityCacheRef = React.useRef<Map<string, MemberData>>(new Map());

  // Transform and normalize member data with presence
  const { members, isLoading, error, title } = React.useMemo(() => {
    const previousCache = memberIdentityCacheRef.current;
    const nextCache = new Map<string, MemberData>();

    const membersWithPresence: MemberData[] = baseMembers.map((member) => {
      const isOnline = presenceData?.presence?.[member.id] || false;
      const previous = previousCache.get(member.id);

      if (
        previous &&
        previous.username === member.username &&
        previous.displayName === member.displayName &&
        previous.avatarUrl === member.avatarUrl &&
        previous.status === member.status &&
        previous.isOnline === isOnline &&
        sameDisplayRole(previous.displayRole, member.displayRole)
      ) {
        nextCache.set(member.id, previous);
        return previous;
      }

      const next: MemberData = { ...member, isOnline };
      nextCache.set(member.id, next);
      return next;
    });

    memberIdentityCacheRef.current = nextCache;

    const combinedLoading = contextType === VoiceSessionType.Channel
      ? (isPrivate === undefined
          ? !unresolvedChannelError
          : isPrivate ? isChannelMembersLoading : isCommunityLoading) || isPresenceLoading
      : isDmLoading || isPresenceLoading;

    const combinedError = contextType === VoiceSessionType.Channel
      ? (isPrivate === undefined
          ? unresolvedChannelError
          : isPrivate ? channelMembersError : communityError) || presenceError
      : dmError || presenceError;

    const listTitle = contextType === VoiceSessionType.Channel
      ? "Members"
      : (dmGroup?.isGroup ? "Group Members" : "Participants");

    return {
      members: membersWithPresence,
      isLoading: combinedLoading,
      error: combinedError,
      title: listTitle,
    };
  }, [
    baseMembers,
    presenceData,
    contextType,
    isPrivate,
    isChannelMembersLoading,
    isCommunityLoading,
    isDmLoading,
    isPresenceLoading,
    channelMembersError,
    communityError,
    dmError,
    presenceError,
    unresolvedChannelError,
    dmGroup?.isGroup,
  ]);

  // Retry whichever request actually failed.
  const handleRetry = React.useCallback(() => {
    if (contextType === VoiceSessionType.Channel) {
      if (isPrivate === undefined) void refetchChannel();
      else if (isPrivate && channelMembersError) void refetchChannelMembers();
      else if (!isPrivate && communityError) void refetchCommunityMembers();
    } else if (dmError) {
      void refetchDm();
    }
    if (presenceError) void refetchPresence();
  }, [
    contextType,
    isPrivate,
    channelMembersError,
    communityError,
    dmError,
    presenceError,
    refetchChannel,
    refetchChannelMembers,
    refetchCommunityMembers,
    refetchDm,
    refetchPresence,
  ]);

  // Only the community members query is paginated; private-channel and DM
  // member lists are single fetches.
  const showLoadMore =
    contextType === VoiceSessionType.Channel &&
    isPrivate === false &&
    !!hasNextPage;

  return (
    <MemberList
      members={members}
      isLoading={isLoading}
      error={error}
      title={title}
      communityId={communityId}
      hasMore={showLoadMore}
      isLoadingMore={isFetchingNextPage}
      onLoadMore={handleLoadMoreMembers}
      onRetry={handleRetry}
      fullWidth={fullWidth}
    />
  );
};

export default MemberListContainer;