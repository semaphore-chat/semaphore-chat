/**
 * Community members as both shells list them: the paginated membership
 * query (the key `communityMembersQueryKey` that the community socket
 * handlers keep live), the display role, and online state from the bulk
 * presence query (patched in place by `presenceHandlers`).
 *
 * Bulk presence (every visible online user) rather than one presence query per
 * list of ids: the per-ids endpoint reads at most 200 ids, so members past the
 * 200th always showed offline after "Show more" (design F4).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import {
  presenceControllerGetBulkPresenceOptions,
  voicePresenceControllerGetChannelPresenceOptions,
} from '../api-client/@tanstack/react-query.gen';
import { membershipControllerFindAllForCommunity } from '../api-client/sdk.gen';
import type { MembershipResponseDto, RoleDto } from '../api-client/types.gen';
import { communityMembersQueryKey, MEMBER_LIST_PAGE_SIZE } from '../utils/membershipQueryKeys';
import { useVoiceConnection } from '../hooks/useVoiceConnection';
import { useCommunityChannels, type QueryStatus } from './channels';

export interface MemberDisplayRole {
  id: string;
  name: string;
  position: number;
}

/** Compare two display roles by content (computeDisplayRole builds a fresh object each time). */
export function sameDisplayRole(a?: MemberDisplayRole, b?: MemberDisplayRole): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.name === b.name && a.position === b.position;
}

/**
 * A member's "display role": the role with the lowest position (highest
 * priority), excluding the default "Member" role (the catch-all).
 */
export function computeDisplayRole(roles?: RoleDto[]): MemberDisplayRole | undefined {
  if (!roles || roles.length === 0) return undefined;
  const nonMemberRoles = roles.filter((r) => !(r.isDefault && r.name === 'Member'));
  if (nonMemberRoles.length === 0) return undefined;
  const bestRole = nonMemberRoles.reduce((best, role) => (role.position < best.position ? role : best));
  return { id: bestRole.id, name: bestRole.name, position: bestRole.position };
}

/**
 * Pure: `next`, reusing the previous object for every item `same` says is
 * unchanged, so memo'd rows skip re-rendering on an event that touched
 * someone else. Returns the list and the cache for the next call (members
 * that disappeared are evicted).
 */
export function keepIdentity<T extends { id: string }>(
  next: readonly T[],
  previous: ReadonlyMap<string, T>,
  same: (a: T, b: T) => boolean,
): { items: T[]; cache: Map<string, T> } {
  const cache = new Map<string, T>();
  const items = next.map((item) => {
    const prev = previous.get(item.id);
    const kept = prev && same(prev, item) ? prev : item;
    cache.set(item.id, kept);
    return kept;
  });
  return { items, cache };
}

/** `keepIdentity` across renders. */
export function useIdentityCache<T extends { id: string }>(
  next: readonly T[],
  same: (a: T, b: T) => boolean,
): T[] {
  const cacheRef = useRef<Map<string, T>>(new Map());
  return useMemo(() => {
    const { items, cache } = keepIdentity(next, cacheRef.current, same);
    cacheRef.current = cache;
    return items;
    // `same` is a module-level comparator at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);
}

/** Every visible online user (`presenceControllerGetBulkPresence`), live via the presence handlers. */
export function useBulkPresence(enabled = true) {
  return useQuery({
    ...presenceControllerGetBulkPresenceOptions(),
    enabled,
    staleTime: 60_000,
  });
}

export interface CommunityMemberPages {
  /** Every loaded membership, in server order (undefined until the first page). */
  memberships: MembershipResponseDto[] | undefined;
  isLoading: boolean;
  error: unknown;
  status: QueryStatus;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore(): void;
  refetch(): void;
}

/** The paginated membership list ("Show more" loads the next 100). */
export function useCommunityMemberPages(communityId: string | undefined, enabled = true): CommunityMemberPages {
  const { data, isLoading, error, status, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: communityMembersQueryKey(communityId || ''),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await membershipControllerFindAllForCommunity({
        path: { communityId: communityId! },
        query: { limit: MEMBER_LIST_PAGE_SIZE, continuationToken: pageParam },
        throwOnError: true,
        signal,
      });
      return data;
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.continuationToken || undefined,
    // No `maxPages` on purpose: it's a sliding-window CACHE bound in TanStack
    // v5 (fetching page N+1 evicts page 1), which would silently drop
    // already-rendered members past the window. Memory is bounded instead by
    // the 100/page size and user-driven "Show more" pacing.
    enabled: enabled && !!communityId,
  });

  const memberships = useMemo(
    () =>
      data?.pages.flatMap((page) => {
        // Version-skew tolerance: pre-0.4.0 backends return a plain membership
        // array instead of the { members, continuationToken } envelope. Treat
        // it as one full page, and any other shape as an empty page rather
        // than letting `undefined` entries crash the screen.
        if (Array.isArray(page)) return page as MembershipResponseDto[];
        return page?.members ?? [];
      }),
    [data],
  );

  const loadMore = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) void fetchNextPage();
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const refetchPages = useCallback(() => void refetch(), [refetch]);

  return {
    memberships,
    isLoading,
    error,
    status,
    hasMore: !!hasNextPage,
    loadingMore: isFetchingNextPage,
    loadMore,
    refetch: refetchPages,
  };
}

export interface MemberSummary {
  id: string;
  name: string;
  avatarFileId: string | null;
  /** The display role's name; null for plain members. */
  role: string | null;
  presence: 'online' | 'offline';
  statusText: string | null;
  lastSeen: string | null;
  /** The name of this community's voice room the member is in, if any. */
  inRoom: string | null;
}

/**
 * The community's members **of the loaded pages** (the first 100 until
 * `loadMore`): complete only when `allLoaded`. There is no community-wide
 * online count on the server yet, so a whole-community number is offered only
 * once every page is loaded (`aroundCount`); before that, show
 * `loadedAroundCount` as "N+" next to "Show more".
 */
export interface CommunityMembers {
  /** Loaded members with a role (any presence), by role priority, then server order. */
  hosts: MemberSummary[];
  /** Loaded online members without a role. */
  around: MemberSummary[];
  /** Loaded offline members without a role. */
  away: MemberSummary[];
  /** Online members among the loaded pages, hosts included. */
  loadedAroundCount: number;
  /** Online members in the whole community, hosts included ("9 around"): null until every page is loaded. */
  aroundCount: number | null;
  allLoaded: boolean;
  loadMore(): void;
  loadingMore: boolean;
  status: QueryStatus;
  refetch(): void;
}

const sameSummary = (a: MemberSummary, b: MemberSummary) =>
  a.name === b.name &&
  a.avatarFileId === b.avatarFileId &&
  a.role === b.role &&
  a.presence === b.presence &&
  a.statusText === b.statusText &&
  a.lastSeen === b.lastSeen &&
  a.inRoom === b.inRoom;

/** Pure: memberships, presence and room occupancy as member summaries, plus their role positions. */
export function summarizeMembers(
  memberships: readonly MembershipResponseDto[],
  online: Readonly<Record<string, boolean>> | undefined,
  roomOf: ReadonlyMap<string, string>,
): { summary: MemberSummary; rolePosition: number | null }[] {
  return memberships
    .filter((m) => m.user)
    .map((m) => {
      const user = m.user!;
      const role = computeDisplayRole(m.roles);
      return {
        summary: {
          id: user.id,
          name: user.displayName || user.username,
          avatarFileId: user.avatarUrl ?? null,
          role: role?.name ?? null,
          presence: online?.[user.id] ? 'online' : 'offline',
          statusText: user.status ?? null,
          lastSeen: user.lastSeen ?? null,
          inRoom: roomOf.get(user.id) ?? null,
        },
        rolePosition: role?.position ?? null,
      };
    });
}

/** Pure: Hosts (by role position, stable) / Around / Away. */
export function groupMembers(entries: readonly { summary: MemberSummary; rolePosition: number | null }[]) {
  const hosts = entries
    .filter((e) => e.rolePosition !== null)
    .sort((a, b) => a.rolePosition! - b.rolePosition!)
    .map((e) => e.summary);
  const rest = entries.filter((e) => e.rolePosition === null).map((e) => e.summary);
  return {
    hosts,
    around: rest.filter((m) => m.presence === 'online'),
    away: rest.filter((m) => m.presence === 'offline'),
    loadedAroundCount: entries.filter((e) => e.summary.presence === 'online').length,
  };
}

/** The community's members for the members island (Hosts / Around / Away). */
export function useCommunityMembers(communityId: string): CommunityMembers {
  const pages = useCommunityMemberPages(communityId);
  const presence = useBulkPresence((pages.memberships?.length ?? 0) > 0);
  const { voice } = useCommunityChannels(communityId);
  const { state: voiceState } = useVoiceConnection();
  // Your own room: no 120 s poll (LiveKit is the live source there, see
  // useVoiceRoomPeople); its presence entry still loads once and the voice
  // socket handlers keep it patched.
  const ownRoomId = voiceState.isConnected ? voiceState.currentChannelId : null;

  // Who is in which of this community's rooms (the same presence queries the
  // left island's voice cards read, so no extra requests).
  const rooms = useQueries({
    queries: voice.map((room) => ({
      ...voicePresenceControllerGetChannelPresenceOptions({ path: { channelId: room.id } }),
      refetchInterval: room.id === ownRoomId ? (false as const) : 120_000,
    })),
  });
  const roomData = rooms.map((r) => r.data);
  const roomKey = roomData.map((d) => d?.users.map((u) => u.id).join(',') ?? '').join('|');
  const roomOf = useMemo(() => {
    const map = new Map<string, string>();
    voice.forEach((room, i) => {
      for (const user of roomData[i]?.users ?? []) map.set(user.id, room.name);
    });
    return map;
    // roomKey captures roomData's content; roomData itself is a fresh array every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, roomKey]);

  const summaries = useMemo(
    () => summarizeMembers(pages.memberships ?? [], presence.data?.presence, roomOf),
    [pages.memberships, presence.data, roomOf],
  );
  const kept = useIdentityCache(
    useMemo(() => summaries.map((s) => s.summary), [summaries]),
    sameSummary,
  );
  const grouped = useMemo(
    () => groupMembers(summaries.map((s, i) => ({ summary: kept[i], rolePosition: s.rolePosition }))),
    [summaries, kept],
  );

  const status: QueryStatus =
    pages.status === 'error' || presence.status === 'error'
      ? 'error'
      : pages.status === 'pending' || (presence.status === 'pending' && presence.fetchStatus !== 'idle')
        ? 'pending'
        : 'success';
  const { refetch: refetchPresence, error: presenceError } = presence;
  const { error: pagesError, refetch: refetchPages } = pages;
  const refetch = useCallback(() => {
    if (pagesError) refetchPages();
    if (presenceError) void refetchPresence();
  }, [pagesError, refetchPages, presenceError, refetchPresence]);
  const allLoaded = pages.status === 'success' && !pages.hasMore;

  return {
    ...grouped,
    aroundCount: allLoaded ? grouped.loadedAroundCount : null,
    allLoaded,
    loadMore: pages.loadMore,
    loadingMore: pages.loadingMore,
    status,
    refetch,
  };
}
