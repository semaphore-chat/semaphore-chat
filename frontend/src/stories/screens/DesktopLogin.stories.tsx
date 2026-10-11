/**
 * The browser half of "Sign in with browser" for the desktop app (#442):
 * the page the app opens at /#/desktop-login, where a signed-in user
 * confirms signing the app in as themselves.
 */
import { http, HttpResponse } from 'msw';
import { buildScenario } from '../fixtures/builder';
import { bigCommunityScenario } from '../fixtures/scenarios';
import { defineScreen, type LadleStoryComponent } from '../fixtures/screenStory';
import { SandboxShell } from '../fixtures/SandboxShell';
import { makeHandlers } from '../fixtures/handlers';
import { ClickOnMount } from '../fixtures/interactions';
import DesktopLoginPage from '../../pages/DesktopLoginPage';

const LINK = `/desktop-login?challenge=${'c'.repeat(43)}&state=${'s'.repeat(43)}&port=51234`;

/** Signed in in the browser: confirm signing the desktop app in as this account. */
export const Confirm = defineScreen(bigCommunityScenario, LINK);

/** A long display name and username wrap inside the card (phone width too). */
const longNameScenario = buildScenario({
  seed: 'desktop-login-long-name',
  meOverrides: {
    displayName: 'Maximiliana Wolfeschlegelsteinhausenbergerdorff the Third',
    username: 'maximiliana_wolfeschlegelsteinhausenbergerdorff',
  },
});
export const ConfirmLongName = defineScreen(longNameScenario, LINK);

/** The server refused to approve (e.g. a session from before sessions were tracked). */
const clickApprove = () =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent === 'Sign in to the desktop app',
  );
export const ApproveFailed: LadleStoryComponent = defineScreen(bigCommunityScenario, LINK, {
  overlay: <ClickOnMount find={clickApprove} />,
});
ApproveFailed.msw = [
  http.post('/api/auth/desktop/authorize', () =>
    HttpResponse.json({ message: 'Sign in again to approve this' }, { status: 401 }),
  ),
  ...(ApproveFailed.msw ?? []),
];

/** A damaged or incomplete link (missing challenge). */
export const BrokenLink = defineScreen(bigCommunityScenario, '/desktop-login?state=abc&port=1');

/** After confirming: the browser is on its way back to the app. */
export const HandingOver: LadleStoryComponent = () => (
  <SandboxShell path={LINK} overlay={null}>
    <DesktopLoginPage redirect={() => {}} initialPhase="handing-over" />
  </SandboxShell>
);
HandingOver.msw = makeHandlers(bigCommunityScenario);

/** Cancelled in the browser: the app stops waiting. */
export const Cancelled: LadleStoryComponent = () => (
  <SandboxShell path={LINK} overlay={null}>
    <DesktopLoginPage redirect={() => {}} initialPhase="cancelled" />
  </SandboxShell>
);
Cancelled.msw = makeHandlers(bigCommunityScenario);
