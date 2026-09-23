import LoginPage from '../../pages/LoginPage';
import { PublicShell } from '../fixtures/PublicShell';
import { makeHandlers } from '../fixtures/handlers';
import { bigCommunityScenario } from '../fixtures/scenarios';
import type { LadleStoryComponent } from '../fixtures/screenStory';

/** Unauthenticated login page. */
export const Login: LadleStoryComponent = () => (
  <PublicShell path="/login">
    <LoginPage />
  </PublicShell>
);
Login.msw = makeHandlers(bigCommunityScenario);
