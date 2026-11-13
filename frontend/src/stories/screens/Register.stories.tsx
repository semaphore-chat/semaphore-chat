import RegisterPage from '../../pages/RegisterPage';
import { PublicShell } from '../fixtures/PublicShell';
import { makeHandlers } from '../fixtures/handlers';
import { bigCommunityScenario } from '../fixtures/scenarios';
import type { LadleStoryComponent } from '../fixtures/screenStory';
import { http, HttpResponse } from 'msw';
import { withHangingEndpoint } from '../fixtures/edge/states';

const Register: LadleStoryComponent = () => (
  <PublicShell path="/register">
    <RegisterPage />
  </PublicShell>
);

const withMode = (mode: 'OPEN' | 'INVITE_ONLY' | 'CLOSED') => [
  http.get('/api/instance/settings/public', () =>
    HttpResponse.json({
      name: bigCommunityScenario.instanceName,
      registrationMode: mode,
      maxFileSizeBytes: 25 * 1024 * 1024,
      gifSearchEnabled: false,
      passwordResetEnabled: true,
    }),
  ),
  ...makeHandlers(bigCommunityScenario),
];

/** Invite-only server: the invite code is required. */
export const RegisterInviteOnly: LadleStoryComponent = () => <Register />;
RegisterInviteOnly.msw = withMode('INVITE_ONLY');

/** Open registration: the invite code is optional. */
export const RegisterOpen: LadleStoryComponent = () => <Register />;
RegisterOpen.msw = withMode('OPEN');

/** Registration closed: no form, a message and a link back to sign in. */
export const RegisterClosed: LadleStoryComponent = () => <Register />;
RegisterClosed.msw = withMode('CLOSED');

/** The registration mode is still loading. */
export const RegisterLoading: LadleStoryComponent = () => <Register />;
RegisterLoading.msw = [
  withHangingEndpoint('get', '/api/instance/settings/public'),
  ...makeHandlers(bigCommunityScenario),
];
