import { defineScreen } from '../fixtures/screenStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/** Home screen — no community selected. Community rail/list + a friendly "pick a community" state. */
export const ChannelsHome = defineScreen(bigCommunityScenario, '/');
