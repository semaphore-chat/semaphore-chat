import { useQuery } from '@tanstack/react-query';
import {
  directMessagesControllerFindDmGroupOptions,
  directMessagesControllerFindUserDmGroupsOptions,
} from '../api-client/@tanstack/react-query.gen';

/**
 * The DM group of an open conversation (`GET /direct-messages/:id`).
 *
 * While that request is in flight, the same group from the DM list
 * (`GET /direct-messages`, usually the list the user just picked it from)
 * stands in as placeholder data, so the header can show the right name at
 * once. Both endpoints return the same DTO. With no list entry `data` stays
 * undefined until the request settles, so callers show a loading state, not a
 * made-up name.
 */
export function useDmGroup(dmGroupId: string | undefined) {
  // Read-only view of the cached DM list: never fetches (the list screens own
  // that request), but re-renders when the list lands after this mounted.
  const { data: listedGroup } = useQuery({
    ...directMessagesControllerFindUserDmGroupsOptions(),
    enabled: false,
    select: (groups) => groups.find((group) => group.id === dmGroupId),
  });

  return useQuery({
    ...directMessagesControllerFindDmGroupOptions({ path: { id: dmGroupId ?? '' } }),
    enabled: !!dmGroupId,
    // A value, not TanStack's `(previousData) => ...` form: the previous data
    // belongs to the previously open conversation and must never stand in.
    placeholderData: dmGroupId ? listedGroup : undefined,
  });
}
