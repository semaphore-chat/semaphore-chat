import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario, firstDmGroup } from '../fixtures/scenarios';

/** An open 1:1 DM conversation. */
export const DmChat = defineScreen(bigCommunityScenario, `/direct-messages/${firstDmGroup.id}`);
