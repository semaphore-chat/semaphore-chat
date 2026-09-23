import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/** DM list — ~6 conversations, some with unread badges. */
export const DmList = defineScreen(bigCommunityScenario, '/direct-messages');
