/**
 * What the current user may do in a community, from the same permission
 * checks the classic screens use (`useCanPerformAction`). The new shell's
 * community menu offers only these (design risk 2).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { communityControllerFindOneOptions } from '../api-client/@tanstack/react-query.gen';
import { useCanPerformAction } from '../features/roles/useUserPermissions';
import { RBAC_ACTIONS } from '../constants/rbacActions';
import type { QueryStatus } from './channels';

export interface CommunityActions {
  /** Community settings (classic: the edit button, `UPDATE_COMMUNITY`). */
  canEdit: boolean;
  /** Create an invite: the community's `CREATE_INVITE`, or instance invite authority (`CREATE_INSTANCE_INVITE`), as the server accepts. */
  canInvite: boolean;
}

export function useCommunityActions(communityId: string): CommunityActions {
  const canEdit = useCanPerformAction('COMMUNITY', communityId, RBAC_ACTIONS.UPDATE_COMMUNITY);
  const canInviteHere = useCanPerformAction('COMMUNITY', communityId, RBAC_ACTIONS.CREATE_INVITE);
  const canInviteInstance = useCanPerformAction('INSTANCE', undefined, RBAC_ACTIONS.CREATE_INSTANCE_INVITE);
  return { canEdit, canInvite: canInviteHere || canInviteInstance };
}

export interface CommunitySummary {
  id: string;
  name: string;
  /** The avatar's file id (an authenticated file). */
  avatarFileId: string | null;
}

/**
 * One community as both shells show it in a header (`communityControllerFindOne`, the key the
 * community socket handlers invalidate on an update). `error` is the client's error body: a 403 or
 * 404 means the user is not a member (`isPermanentAccessError`).
 */
export function useCommunity(communityId: string): {
  community: CommunitySummary | null;
  status: QueryStatus;
  error: unknown;
  refetch(): void;
} {
  const { data, status, error, refetch } = useQuery(communityControllerFindOneOptions({ path: { id: communityId } }));
  const community = useMemo<CommunitySummary | null>(
    () => (data ? { id: data.id, name: data.name, avatarFileId: data.avatar ?? null } : null),
    [data],
  );
  const refetchCommunity = useCallback(() => void refetch(), [refetch]);
  return { community, status, error, refetch: refetchCommunity };
}
