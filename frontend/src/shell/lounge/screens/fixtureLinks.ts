/**
 * Where the hidden fixtures' links lead (`ThreeIslandsScreen.links`): the community fixture and the chat fixture
 * keep their dock, "All communities" sheet and channel rows on the fixtures, so the frame stays mounted.
 */
import type { LoungeLinks } from '../links';
import { loungeChatFixturePath, loungeCommunityFixturePath } from '../../loungeRoutes';

export const FIXTURE_LINKS: LoungeLinks = Object.freeze({
  community: (id: string) => `#${loungeCommunityFixturePath(id)}`,
  channel: (communityId: string, channelId: string) => `#${loungeChatFixturePath(communityId, channelId)}`,
});
