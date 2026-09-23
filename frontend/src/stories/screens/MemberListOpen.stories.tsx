import { defineScreen } from '../fixtures/screenStory';
import { ClickOnMount } from '../fixtures/interactions';
import { findButtonByIconTestId } from '../fixtures/domQueries';
import { bigCommunityScenario, primaryCommunity, generalChannel } from '../fixtures/scenarios';

/**
 * On desktop the member sidebar is already visible by default. On phone/tablet
 * it's behind the app bar's "members" button — click it if present so every
 * viewport in the sweep shows the member list.
 */
export const MemberListOpen = defineScreen(
  bigCommunityScenario,
  `/community/${primaryCommunity.id}/channel/${generalChannel.id}`,
  { overlay: <ClickOnMount find={() => findButtonByIconTestId('PeopleIcon')} /> },
);
