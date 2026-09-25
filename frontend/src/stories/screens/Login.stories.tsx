import LoginPage, { type LoginLocationState } from '../../pages/LoginPage';
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

const signedOut = (signOutReason: LoginLocationState['signOutReason']): LoginLocationState => ({
  signOutReason,
});

/** Signed out because the password was changed (a reset, or by an admin). */
export const LoginAfterPasswordChange: LadleStoryComponent = () => (
  <PublicShell path="/login" state={signedOut('PASSWORD_CHANGED')}>
    <LoginPage />
  </PublicShell>
);
LoginAfterPasswordChange.msw = makeHandlers(bigCommunityScenario);

/** Signed out because an admin banned the account. */
export const LoginAfterBan: LadleStoryComponent = () => (
  <PublicShell path="/login" state={signedOut('ACCOUNT_BANNED')}>
    <LoginPage />
  </PublicShell>
);
LoginAfterBan.msw = makeHandlers(bigCommunityScenario);

/** Signed out because an admin deleted the account. */
export const LoginAfterAccountDeletion: LadleStoryComponent = () => (
  <PublicShell path="/login" state={signedOut('ACCOUNT_DELETED')}>
    <LoginPage />
  </PublicShell>
);
LoginAfterAccountDeletion.msw = makeHandlers(bigCommunityScenario);
