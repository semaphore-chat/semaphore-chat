/**
 * The current user's communities as both shells read them: the server's list
 * for this user (`communityControllerFindAllMine`, the key the classic rail and
 * drawer read and the community socket handlers invalidate), the permission to
 * create one (the check the classic rail uses), the instance heading, and which
 * community the user's call is in.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  communityControllerFindAllMineOptions,
  instanceControllerGetPublicSettingsOptions,
} from '../api-client/@tanstack/react-query.gen';
import type { CommunityResponseDto } from '../api-client/types.gen';
import { useCanPerformAction } from '../features/roles/useUserPermissions';
import { RBAC_ACTIONS } from '../constants/rbacActions';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useVoice, VoiceSessionType } from '../contexts/VoiceContext';
import { logger } from '../utils/logger';

export interface CommunitySummary {
  id: string;
  name: string;
  /** The picture's file id (an authenticated file), or null. */
  avatarFileId: string | null;
}

export type CommunitiesStatus = 'pending' | 'error' | 'success';

export interface MyCommunities {
  /** In the server's order. Empty while loading and on a first-load error. */
  communities: CommunitySummary[];
  status: CommunitiesStatus;
  refetch(): void;
  /** The query itself, for the kit's `useQueryLoadState`. */
  query: UseQueryResult<CommunityResponseDto[]>;
}

/**
 * Pure: the server's list without the null entries it can return (a community
 * deleted while the server built the response), as the classic rail skips them.
 */
export function toCommunitySummaries(raw: readonly (CommunityResponseDto | null)[] | undefined): CommunitySummary[] {
  const out: CommunitySummary[] = [];
  for (const community of raw ?? []) {
    if (community == null) continue;
    out.push({ id: community.id, name: community.name, avatarFileId: community.avatar ?? null });
  }
  return out;
}

export function useMyCommunities(): MyCommunities {
  const query = useQuery(communityControllerFindAllMineOptions());
  const { data, status, refetch } = query;
  const communities = useMemo(() => {
    const list = toCommunitySummaries(data);
    if (data && list.length !== data.length) {
      logger.warn(`[MyCommunities] skipped ${data.length - list.length} null community entries from /communities/mine`);
    }
    return list;
  }, [data]);
  // `refetch` is the observer's own (stable), so this one is too: safe in an effect's dependencies.
  const retry = useCallback(() => void refetch(), [refetch]);
  // The kit's load state reads the query's status and timestamps; it names errors with its own words,
  // so the generated client's error type (ErrorResponseDto, not an Error) does not matter to it.
  return { communities, status, refetch: retry, query: query as unknown as UseQueryResult<CommunityResponseDto[]> };
}

/** Whether the user may create a community: the instance's `CREATE_COMMUNITY`, as the classic rail checks it. */
export function useCanCreateCommunity(): boolean {
  return useCanPerformAction('INSTANCE', undefined, RBAC_ACTIONS.CREATE_COMMUNITY);
}

export interface InstanceIdentity {
  /** The instance's name from its public settings ("Semaphore Chat" until they load, as the app shell does). */
  instanceName: string;
  /** The signed-in user's username, or null while it loads. */
  username: string | null;
}

export function useInstanceIdentity(): InstanceIdentity {
  const { data } = useQuery(instanceControllerGetPublicSettingsOptions());
  const { user } = useCurrentUser();
  return { instanceName: data?.name || 'Semaphore Chat', username: user?.username ?? null };
}

/** The community the user's voice call (joining or joined) is in; null outside a channel call. */
export function useCallCommunityId(): string | null {
  const voice = useVoice();
  const inCall = voice.isConnected || voice.isConnecting;
  if (!inCall || voice.contextType !== VoiceSessionType.Channel) return null;
  return voice.communityId;
}
