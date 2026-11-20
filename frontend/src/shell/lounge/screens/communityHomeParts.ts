/**
 * What the community home (`CommunityHomeScreen`, `/community/:communityId`) and its hidden fixture
 * (`CommunityFixtureScreen`) share: the title, the community's name for the centre's label and RouteFocus's
 * announcement.
 */
import { useCommunity } from '../../../data/communities';
import type { LoungeParams } from '../screen';

/** The community's name; null while it loads, or for a community the user cannot see. */
export function useCommunityTitle(params: LoungeParams): string | null {
  // The route's pattern has the param, so it is always there on a matched route.
  return useCommunity(params.communityId ?? '').community?.name ?? null;
}
