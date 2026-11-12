import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import JoinInvitePage from '../../pages/JoinInvitePage';
import { PublicShell } from '../fixtures/PublicShell';
import { configureMockAuth } from '../fixtures/auth';
import { makeHandlers } from '../fixtures/handlers';
import { bigCommunityScenario } from '../fixtures/scenarios';
import type { LadleStoryComponent } from '../fixtures/screenStory';
import { clearTokens } from '../../utils/tokenService';
import { useDriver, clickButtonByText } from '../fixtures/edge/chat';
import { ErrorCode } from '@semaphore-chat/shared';

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

/** A lookup the server refuses with the given error code (404). */
const refusedHandlers = (errorCode: ErrorCode, message: string) => [
  http.post('/api/auth/refresh', () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
  ),
  http.get('/api/invite/public/:code', () =>
    HttpResponse.json({ statusCode: 404, errorCode, message }, { status: 404 }),
  ),
  ...makeHandlers(bigCommunityScenario),
];

/** Unknown code: the generic "invalid" message. */
export const JoinInviteNotFound: LadleStoryComponent = () => {
  clearTokens();
  return <JoinInviteScreen />;
};
JoinInviteNotFound.msw = refusedHandlers(
  ErrorCode.INVITE_NOT_FOUND,
  'No invite found for the provided code.',
);

/** The invite's expiry has passed. */
export const JoinInviteExpired: LadleStoryComponent = () => {
  clearTokens();
  return <JoinInviteScreen />;
};
JoinInviteExpired.msw = refusedHandlers(
  ErrorCode.INVITE_EXPIRED,
  'This invite has expired.',
);

/** Every use of the invite is spent. */
export const JoinInviteExhausted: LadleStoryComponent = () => {
  clearTokens();
  return <JoinInviteScreen />;
};
JoinInviteExhausted.msw = refusedHandlers(
  ErrorCode.INVITE_EXHAUSTED,
  'This invite has reached its maximum number of uses.',
);

/** An admin turned the invite off. */
export const JoinInviteDisabled: LadleStoryComponent = () => {
  clearTokens();
  return <JoinInviteScreen />;
};
JoinInviteDisabled.msw = refusedHandlers(
  ErrorCode.INVITE_DISABLED,
  'This invite has been disabled.',
);

/** Signed in, and the invite was spent while the page was open: the accept answers 404. */
const ClickJoin = () => {
  useDriver([() => clickButtonByText(/join with your account/i)]);
  return null;
};

export const JoinInviteSignedInRefused: LadleStoryComponent = () => {
  configureMockAuth();
  return (
    <>
      <JoinInviteScreen />
      <ClickJoin />
    </>
  );
};
JoinInviteSignedInRefused.msw = [
  http.post('/api/invite/:code/accept', () =>
    HttpResponse.json(
      {
        statusCode: 404,
        errorCode: ErrorCode.INVITE_EXHAUSTED,
        message: 'This invite has reached its maximum number of uses.',
      },
      { status: 404 },
    ),
  ),
  ...inviteHandlers.filter((h) => !String(h.info.path).includes('/accept')),
];
