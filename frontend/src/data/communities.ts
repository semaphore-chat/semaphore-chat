/**
 * What the current user may do in a community, from the same permission
 * checks the classic screens use (`useCanPerformAction`). The new shell's
 * community menu offers only these (design risk 2).
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useCanPerformAction } from '../features/roles/useUserPermissions';
import { RBAC_ACTIONS } from '../constants/rbacActions';

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
