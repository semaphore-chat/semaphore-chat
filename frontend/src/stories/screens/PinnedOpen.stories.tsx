import { defineScreen } from '../fixtures/screenStory';
import { ClickOnMount } from '../fixtures/interactions';
import { findButtonByIconTestId, findMenuItemByText } from '../fixtures/domQueries';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

/**
 * The pinned-messages drawer is local state, opened differently per layout:
 *  - Desktop (`ChannelMessageContainer.tsx`): a direct toolbar button with
 *    a `PushPinIcon`.
 *  - Phone/tablet (`MobileChatPanel.tsx`): there's no direct pin button —
 *    it's a "Pinned Messages" item inside the app bar's "more options"
 *    overflow menu (`MoreVertIcon`).
 * Both `ClickOnMount`s below run on every viewport; whichever target
 * doesn't exist for a given layout just times out harmlessly, so this
 * covers desktop directly and phone/tablet via the two-step menu.
 */
export const PinnedOpen = defineScreen(
  bigCommunityScenario,
  `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
  {
    overlay: (
      <>
        <ClickOnMount find={() => findButtonByIconTestId('PushPinIcon') ?? findButtonByIconTestId('MoreVertIcon')} />
        <ClickOnMount find={() => findMenuItemByText(/Pinned Messages/i)} />
      </>
    ),
  },
);
