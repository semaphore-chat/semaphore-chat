import LoginPage, { type LoginLocationState } from '../../pages/LoginPage';
import { PublicShell } from '../fixtures/PublicShell';
import { makeHandlers } from '../fixtures/handlers';
import { bigCommunityScenario } from '../fixtures/scenarios';
import type { LadleStoryComponent } from '../fixtures/screenStory';
import { http, HttpResponse } from 'msw';
import { asElectron } from '../fixtures/electron';
import { ClickOnMount } from '../fixtures/interactions';
import { requestBrowserLoginOnLoad } from '../../hooks/useBrowserLogin';
import type { BrowserLoginResult } from '../../types/electron-api';

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

// ------------------------------------------------------------------ desktop app

/** The desktop app's login screen: "Sign in with browser" first, the password form below. */
export const DesktopLogin = asElectron(Login);
DesktopLogin.meta = { viewports: ['tablet', 'desktop'] };

/** Starts a browser sign-in as it renders, as after the connection wizard's "Sign in with browser". */
const StartingBrowserLogin: LadleStoryComponent = () => {
  requestBrowserLoginOnLoad();
  return <Login />;
};
StartingBrowserLogin.msw = Login.msw;

/** Waiting for the browser (with Cancel). */
export const DesktopLoginWaitingForBrowser = asElectron(StartingBrowserLogin, {
  startBrowserLogin: () => new Promise<BrowserLoginResult>(() => {}),
});
DesktopLoginWaitingForBrowser.meta = { viewports: ['tablet', 'desktop'] };

/** The browser never came back. */
export const DesktopLoginTimedOut = asElectron(StartingBrowserLogin, {
  startBrowserLogin: () => Promise.resolve<BrowserLoginResult>({ status: 'timeout' }),
});
DesktopLoginTimedOut.meta = { viewports: ['tablet', 'desktop'] };

/** Cancelled on the browser's confirm page. */
export const DesktopLoginDeniedInBrowser = asElectron(StartingBrowserLogin, {
  startBrowserLogin: () => Promise.resolve<BrowserLoginResult>({ status: 'denied' }),
});
DesktopLoginDeniedInBrowser.meta = { viewports: ['tablet', 'desktop'] };

/** A server too old for browser sign-in: the password form alone, plus "Change server". */
export const DesktopLoginOldServer = asElectron(Login);
DesktopLoginOldServer.msw = [
  http.get('/api/instance/settings/public', () =>
    HttpResponse.json({
      name: bigCommunityScenario.instanceName,
      registrationMode: 'INVITE_ONLY',
      maxFileSizeBytes: 25 * 1024 * 1024,
      gifSearchEnabled: false,
      passwordResetEnabled: true,
    }),
  ),
  ...(Login.msw ?? []),
];
DesktopLoginOldServer.meta = { viewports: ['tablet', 'desktop'] };

/** "Change server" opens the connection wizard at the server URL step. */
const ChangingServer: LadleStoryComponent = () => (
  <>
    <Login />
    <ClickOnMount
      find={() =>
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Change server')
      }
    />
  </>
);
ChangingServer.msw = Login.msw;
export const DesktopLoginChangeServer = asElectron(ChangingServer);
DesktopLoginChangeServer.meta = { viewports: ['tablet', 'desktop'] };
