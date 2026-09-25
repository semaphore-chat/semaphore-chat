import { SessionUnavailable } from '../../components/SessionUnavailable';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/**
 * AuthGate's page-load screen after the session refresh kept failing (the
 * server answered 5xx, 429 or not at all through several rounds of retries).
 */
export const Default = defineComponent(
  bigCommunityScenario,
  () => <SessionUnavailable onRetry={() => {}} onSignIn={() => {}} />,
  { maxWidth: false },
);
