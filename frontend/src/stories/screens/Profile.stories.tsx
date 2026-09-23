import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

export const Profile = defineScreen(bigCommunityScenario, `/profile/${bigCommunityScenario.me.id}`);
