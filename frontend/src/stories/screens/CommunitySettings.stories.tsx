import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, primaryCommunity } from '../fixtures/scenarios';

/** Community settings / edit page. */
export const CommunitySettings = defineScreen(bigCommunityScenario, `/community/${primaryCommunity.id}/edit`);
