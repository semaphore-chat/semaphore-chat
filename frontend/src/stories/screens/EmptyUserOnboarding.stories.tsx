import { defineScreen } from '../fixtures/screenStory';
import { emptyUserScenario } from '../fixtures/scenarios';

/** Brand-new user: no communities, no DMs — the "create or join a community" onboarding state. */
export const EmptyUserOnboarding = defineScreen(emptyUserScenario, '/');
