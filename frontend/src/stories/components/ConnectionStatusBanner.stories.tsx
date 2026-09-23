import { ConnectionStatusBanner } from '../../components/ConnectionStatusBanner';
import { defineComponent } from '../fixtures/componentStory';
import { bigCommunityScenario } from '../fixtures/scenarios';

/** Shows only while the socket is disconnected — see `isSocketConnected: false`. */
export const Reconnecting = defineComponent(bigCommunityScenario, () => <ConnectionStatusBanner />, {
  maxWidth: false,
  isSocketConnected: false,
});
