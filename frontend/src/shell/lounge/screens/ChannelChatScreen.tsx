/**
 * A text channel's chat at `/community/:communityId/channel/:channelId`, the new shell's at phone width (PR 10c-2b).
 * The chat fixture's descriptor without `links`: Back, a channel mention, the dock and the "All communities" sheet
 * lead to the app's routes. The community's frame (dock, left island, call slot) stays mounted between this screen
 * and the community home. A voice channel's route is the old shell's call view (`chooseShell`, `voiceChannelMemory`);
 * the channel's search (`.../search`) and every wider width stay the old shell's.
 *
 * A phone shows the centre (the chat) with Back to the community's home; the right content is the channel's members
 * (a private channel's own members), a Sheet.
 */
import type { ThreeIslandsScreen } from '../screen';
import { ChannelMembersIsland } from '../pieces/ChannelMembersIsland';
import { ChannelChat } from './chat/ChannelChat';
import { useChannelTitle } from './chat/channelTitle';

const channelChatScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'centre',
  Centre: ChannelChat,
  right: ChannelMembersIsland,
  rightLabel: 'Members',
  useTitle: useChannelTitle,
};

export default channelChatScreen;
