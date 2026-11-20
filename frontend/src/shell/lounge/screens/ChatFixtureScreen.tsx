/**
 * The hidden chat fixture at `/__lounge/community/:communityId/channel/:channelId` (PR 10c-1): the new shell's
 * text channel chat inside the community's frame, at every width. Reached from the community fixture's channel rows
 * (its `links`), never from the app; the real route at phone width is `ChannelChatScreen`, the same descriptor
 * without `links`. With the design off it is the old shell's not-found page.
 *
 * A phone shows the centre (the chat) with Back to the community fixture; the right content is the channel's
 * members (a private channel's own members), a Sheet below wide.
 */
import type { ThreeIslandsScreen } from '../screen';
import { ChannelMembersIsland } from '../pieces/ChannelMembersIsland';
import { ChannelChat } from './chat/ChannelChat';
import { useChannelTitle } from './chat/channelTitle';
import { FIXTURE_LINKS } from './fixtureLinks';

const chatFixtureScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'centre',
  Centre: ChannelChat,
  right: ChannelMembersIsland,
  rightLabel: 'Members',
  useTitle: useChannelTitle,
  links: FIXTURE_LINKS,
};

export default chatFixtureScreen;
