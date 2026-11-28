/**
 * The community home at `/community/:communityId`, the first real Lounge screen (PR 9b). Registered at every
 * width (`LOUNGE_ROUTES`): a phone shows the left pane, the community's header, channels and rooms, with
 * the dock as the bottom bar and the members as a Sheet from the header's "N around". At compact and wide the centre
 * (`CommunityRedirect`) opens the last or first text channel in its place (PR 10e). No `links`: the dock and the "All communities"
 * sheet lead to the app's routes, so moving between communities stays on this screen and the frame stays
 * mounted. A text channel opens the new shell's chat (`ChannelChatScreen`) in the same frame.
 */
import type { ThreeIslandsScreen } from '../screen';
import { useCommunityTitle } from './communityHomeParts';
import { CommunityRedirect } from './CommunityRedirect';

const communityHomeScreen: ThreeIslandsScreen = {
  template: 'threeIslands',
  place: 'community',
  phonePane: 'left',
  Centre: CommunityRedirect,
  right: 'members',
  useTitle: useCommunityTitle,
};

export default communityHomeScreen;
