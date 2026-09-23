import React from "react";
import MemberList, { type MemberData } from "./MemberList";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  presenceControllerGetMultipleUserPresenceOptions,
  directMessagesControllerFindDmGroupOptions,
  channelMembershipControllerFindAllForChannelOptions,
  channelsControllerFindOneOptions,
} from "../../api-client/@tanstack/react-query.gen";
import { membershipControllerFindAllForCommunity } from "../../api-client/sdk.gen";
import type { RoleDto, MembershipResponseDto } from "../../api-client/types.gen";
import {
  communityMembersQueryKey,
  MEMBER_LIST_PAGE_SIZE,
} from "../../utils/membershipQueryKeys";
import { VoiceSessionType } from "../../contexts/VoiceContext";

interface MemberListContainerProps {
  contextType: VoiceSessionType;
  contextId: string;
  communityId?: string;
  isPrivate?: boolean;
}

/**
 * Compare two `displayRole` values by content rather than reference, since
 * `computeDisplayRole` builds a fresh object every time `baseMembers`
 * recomputes even when the underlying role hasn't changed.
 */
function sameDisplayRole(
  a?: MemberData["displayRole"],
  b?: MemberData["displayRole"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.name === b.name && a.position === b.position;
}

/**
 * Compute a member's "display role" from their roles list.
 * The display role is the role with the lowest position (highest priority),
 * excluding the default "Member" role (position 100, isDefault=true).
 */
function computeDisplayRole(
  roles?: RoleDto[],
): MemberData["displayRole"] | undefined {
  if (!roles || roles.length === 0) return undefined;

  // Filter out the default Member role (catch-all)
  const nonMemberRoles = roles.filter(
    (r) => !(r.isDefault && r.name === "Member"),
  );

  if (nonMemberRoles.length === 0) return undefined;

  // Find the role with the lowest position (highest priority)
  const bestRole = nonMemberRoles.reduce((best, role) =>
    role.position < best.position ? role : best,
  );

  return {
    id: bestRole.id,
    name: bestRole.name,
    position: bestRole.position,
  };
}

const MemberListContainer: React.FC<MemberListContainerProps> = ({
  contextType,
  contextId,
  communityId,
  isPrivate: isPrivateProp,
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
    data: communityMembersData,
    isLoading: isCommunityLoading,
    error: communityError,
    refetch: refetchCommunityMembers,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: communityMembersQueryKey(communityId || ""),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await membershipControllerFindAllForCommunity({
        path: { communityId: communityId! },
        query: { limit: MEMBER_LIST_PAGE_SIZE, continuationToken: pageParam },
        throwOnError: true,
        signal,
      });
      return data;
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.continuationToken || undefined,
    // No `maxPages` here on purpose: it's a sliding-window CACHE bound in
    // TanStack v5 (fetching page N+1 evicts page 1), which would silently
    // drop already-rendered members from the flatMap'd list past the
    // window — defeating the "Show more" pagination UX. Memory growth is
    // bounded instead by the 100/page size and user-driven "Show more"
    // pacing (each click is one explicit fetch).
    enabled: contextType === VoiceSessionType.Channel && !!communityId && isPrivate === false,
  });

  const communityMembers = React.useMemo(
    () =>
      communityMembersData?.pages.flatMap((page) => {
        // Version-skew tolerance: pre-0.4.0 backends return a plain
        // membership array instead of the { members, continuationToken }
        // envelope (auto-updated desktop clients can race ahead of
        // self-hosted servers). Treat the array as a single full page, and
        // fall back to an empty page for any other unrecognized shape
        // rather than letting `undefined` entries reach the filter/map
        // below and crash the whole community screen.
        if (Array.isArray(page)) return page as MembershipResponseDto[];
        return page?.members ?? [];
      }),
    [communityMembersData],
  );

  const handleLoadMoreMembers = React.useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) {
      void fetchNextPage();
    }
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

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

  // Extract user IDs for presence lookup
  const userIds = React.useMemo(() =>
    baseMembers.map(member => member.id),
    [baseMembers]
  );

  // Fetch presence data for all members
  const {
    data: presenceData,
    isLoading: isPresenceLoading,
    error: presenceError,
    refetch: refetchPresence,
  } = useQuery({
    ...presenceControllerGetMultipleUserPresenceOptions({ path: { userIds: userIds.join(',') } }),
    enabled: userIds.length > 0,
    staleTime: 60_000,
  });

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
    />
  );
};

export default MemberListContainer;