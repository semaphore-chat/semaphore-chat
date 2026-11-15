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
  /** Create an invite to this community (`CREATE_INVITE`). */
  canInvite: boolean;
}

export function useCommunityActions(communityId: string | undefined): CommunityActions {
  const canEdit = useCanPerformAction('COMMUNITY', communityId, RBAC_ACTIONS.UPDATE_COMMUNITY);
  const canInvite = useCanPerformAction('COMMUNITY', communityId, RBAC_ACTIONS.CREATE_INVITE);
  return { canEdit, canInvite };
}
