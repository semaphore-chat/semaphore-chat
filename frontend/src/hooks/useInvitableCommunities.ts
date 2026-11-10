import { useQueries } from "@tanstack/react-query";
import { rolesControllerGetMyRolesForCommunityOptions } from "../api-client/@tanstack/react-query.gen";
import type { CommunityResponseDto } from "../api-client/types.gen";
import { RBAC_ACTIONS } from "../constants/rbacActions";
import { useCurrentUser } from "./useCurrentUser";

/**
 * The communities an invite of yours may target: where you hold CREATE_INVITE
 * (the backend refuses the whole invite over any other). A community whose roles
 * didn't load counts as one you can't invite to: the invite still works.
 */
export function useInvitableCommunities(communities: CommunityResponseDto[], enabled: boolean) {
  const { user, isLoading: isLoadingUser } = useCurrentUser();
  const isOwner = user?.role === "OWNER";
  const roleQueries = useQueries({
    queries: communities.map((community) => ({
      ...rolesControllerGetMyRolesForCommunityOptions({ path: { communityId: community.id } }),
      enabled: enabled && !isOwner,
    })),
  });
  return {
    invitable: communities.filter(
      (_, i) =>
        isOwner ||
        roleQueries[i]?.data?.roles.some((role) =>
          (role.actions as string[]).includes(RBAC_ACTIONS.CREATE_INVITE),
        ),
    ),
    isLoading: isLoadingUser || (!isOwner && roleQueries.some((query) => query.isLoading)),
  };
}
