/**
 * What a community's home screen and its hidden fixture (`CommunityFixtureScreen`) share: the title, the
 * community's name for the centre's label and RouteFocus's announcement. When the real community home is
 * registered (`/community/:communityId`) its descriptor uses these too.
 */
import { useCommunity } from '../../../data/communities';
import type { LoungeParams } from '../screen';

/** The community's name; null while it loads, or for a community the user cannot see. */
export function useCommunityTitle(params: LoungeParams): string | null {
  // The route's pattern has the param, so it is always there on a matched route.
  return useCommunity(params.communityId ?? '').community?.name ?? null;
}
