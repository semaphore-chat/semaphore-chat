import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import JoinInvitePage from '../../pages/JoinInvitePage';
import { PublicShell } from '../fixtures/PublicShell';
import { configureMockAuth } from '../fixtures/auth';
import { makeHandlers } from '../fixtures/handlers';
import { bigCommunityScenario } from '../fixtures/scenarios';
import type { LadleStoryComponent } from '../fixtures/screenStory';
import { clearTokens } from '../../utils/tokenService';

const invite = {
  code: 'join-me',
  uses: 2,
  maxUses: 10,
  validUntil: null,
  disabled: false,
  createdBy: { username: 'owner' },
};

/** The public join page, at a code the server accepts. */
const JoinInviteScreen: LadleStoryComponent = () => (
  <PublicShell path="/join/join-me">
    <Routes>
      <Route path="/join/:inviteCode" element={<JoinInvitePage />} />
    </Routes>
  </PublicShell>
);

const inviteHandlers = [
  // A visitor without a session: the page's quiet refresh is refused.
  http.post('/api/auth/refresh', () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
  ),
  http.get('/api/invite/public/:code', () => HttpResponse.json(invite)),
  http.post('/api/invite/:code/accept', () =>
    HttpResponse.json({
      joined: [{ id: 'community-1', name: 'Design Guild' }],
      skipped: [],
    }),
  ),
  ...makeHandlers(bigCommunityScenario),
];

/** Signed in: the join page offers "Join with your account" instead of signup. */
export const JoinInviteSignedIn: LadleStoryComponent = () => {
  configureMockAuth();
  return <JoinInviteScreen />;
};
JoinInviteSignedIn.msw = inviteHandlers;

/** Signed out: the existing registration form. */
export const JoinInviteSignedOut: LadleStoryComponent = () => {
  clearTokens();
  return <JoinInviteScreen />;
};
JoinInviteSignedOut.msw = inviteHandlers;
