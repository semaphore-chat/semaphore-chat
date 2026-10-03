/**
 * Voice access revocation against a REAL LiveKit server (#554, follow-up to
 * #499 / PR #552).
 *
 * The backend takes a user out of voice when their access ends:
 *   - ban / deletion / password change: a per-user LiveKit token cutoff in
 *     Redis, removal from every LiveKit room (DM calls included) and the
 *     user's voice presence dropped (SessionRevocationHandler.revokeVoiceAccess);
 *   - logout / "revoke session": only the participants whose signed
 *     `semaphore.sessionId` attribute names a revoked session are removed
 *     (SessionRevocationHandler.revokeSessionsVoice).
 * LiveKit tokens can't be revoked, so the `participant_joined` webhook is the
 * safety net: a participant who rejoins with a revoked token is removed again
 * (LivekitAccessService.checkJoin).
 *
 * What "removed" means here is what the other participant sees: the target
 * leaves their room, so they no longer hear them. The old-token rejoins
 * simulate a client that ignores its signed-out session: the test connects a
 * second livekit-client Room in the target's page with the LiveKit token the
 * app was issued before the revocation, and asserts LiveKit closes it with
 * PARTICIPANT_REMOVED (the server removed it, not the client) and the target
 * never shows up in voice presence.
 *
 * The rejoins also prove LiveKit (1.7+) delivers the signed `semaphore.*`
 * attributes in `participant_joined`: the revoked-session rejoin is only
 * denied through its `semaphore.sessionId`, and the fresh join after a
 * password change only survives through its `semaphore.issuedAt` (a join
 * without a provable issue time is denied while a cutoff is in force).
 *
 * Each scenario uses its own seeded user and channel (seed-e2e.ts), so a ban
 * or password change never reaches the users the other voice specs share.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh
 */
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import {
  ADMIN_USER,
  TEST_USER,
  closeParticipant,
  joinVoiceChannel,
  launchParticipant,
  waitForAudioFlow,
  type Participant,
} from '../fixtures/voice.fixture';
import { API_BASE, loginViaApi } from '../fixtures/auth.fixture';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';

const VOICE_BAN_USER = { username: 'voiceban', password: 'Test123!@#' };
const VOICE_DM_BAN_USER = { username: 'voicedmban', password: 'Test123!@#' };
const VOICE_SESSION_USER = { username: 'voicesession', password: 'Test123!@#' };
const VOICE_PASSWORD_USER = { username: 'voicepassword', password: 'Test123!@#' };

const EDGE_ON_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

/** livekit-client's DisconnectReason.PARTICIPANT_REMOVED (LiveKit protocol). */
const PARTICIPANT_REMOVED = 4;

/** Window state this spec keeps in a participant's page. */
interface RevocationWindow {
  /** livekit-client's Room class, stashed while the app's Room is live. */
  __e2eRoomCtor?: new (options?: object) => ProbeRoom;
  /** Why the app's Room disconnected (DisconnectReason), once it has. */
  __e2eAppDisconnectReason?: number | null;
  __e2eProbe?: ProbeState;
  __e2eProbeRoom?: ProbeRoom;
}

interface ProbeRoom {
  connect(url: string, token: string, options?: object): Promise<void>;
  disconnect(): Promise<void>;
  once(event: string, listener: (...args: unknown[]) => void): void;
  state: string;
  /** Created by connect(); emits 'disconnected' with the leave's reason. */
  engine?: { once(event: string, listener: (...args: unknown[]) => void): void };
}

interface ProbeState {
  connected: boolean;
  /** DisconnectReason, null when none was given; undefined while connected. */
  disconnectReason?: number | null;
  error?: string;
}

interface LivekitToken {
  token: string;
  identity: string;
}

interface Admin {
  api: APIRequestContext;
  accessToken: string;
}

async function adminApi(): Promise<Admin> {
  const api = await request.newContext({ baseURL: BASE_URL });
  const { accessToken } = await loginViaApi(api, ADMIN_USER);
  return { api, accessToken };
}

async function adminCall(
  admin: Admin,
  method: 'GET' | 'PATCH',
  url: string,
  data?: object,
): Promise<unknown> {
  const res = await admin.api.fetch(`${API_BASE}${url}`, {
    method,
    headers: { Authorization: `Bearer ${admin.accessToken}` },
    data,
  });
  if (!res.ok()) {
    throw new Error(`${method} ${url} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** The user id of a seeded user. */
async function userIdOf(admin: Admin, username: string): Promise<string> {
  return ((await adminCall(admin, 'GET', `/users/username/${username}`)) as { id: string }).id;
}

async function setBanned(admin: Admin, userId: string, banned: boolean): Promise<void> {
  await adminCall(admin, 'PATCH', `/users/admin/${userId}/ban`, { banned });
}

/**
 * Run `join` while capturing the LiveKit token the app is issued for it
 * (POST /api/livekit/token, or /dm-token for a DM call).
 */
async function captureLivekitToken(
  p: Participant,
  join: () => Promise<void>,
): Promise<LivekitToken> {
  const response = p.page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/livekit\/(dm-)?token$/.test(new URL(r.url()).pathname) &&
      r.ok(),
    { timeout: 30_000 },
  );
  await join();
  return (await (await response).json()) as LivekitToken;
}

/**
 * After the app's Room is connected: keep livekit-client's Room class on the
 * page (for the old-token rejoin, after the app has dropped its Room) and
 * record why the app's Room disconnects.
 */
async function instrumentAppRoom(p: Participant): Promise<void> {
  await p.page.evaluate(() => {
    const w = window as unknown as RevocationWindow;
    const room = window.__lkRoom as unknown as ProbeRoom;
    w.__e2eRoomCtor = room.constructor as RevocationWindow['__e2eRoomCtor'];
    w.__e2eAppDisconnectReason = undefined;
    room.once('disconnected', (reason) => {
      w.__e2eAppDisconnectReason = typeof reason === 'number' ? reason : null;
    });
  });
}

async function remoteIdentities(p: Participant): Promise<string[]> {
  return p.page.evaluate(() => [...(window.__lkRoom?.remoteParticipants.keys() ?? [])]);
}

async function roomState(p: Participant): Promise<string> {
  return p.page.evaluate(() => window.__lkRoom?.state ?? 'none');
}

/**
 * `target` was removed from the LiveKit room `observer` is in: the observer's
 * room no longer has them (so it no longer receives their audio), and the
 * target's app Room is no longer connected.
 */
async function expectRemovedFromCall(observer: Participant, target: Participant): Promise<void> {
  await expect
    .poll(() => remoteIdentities(observer), {
      timeout: 20_000,
      message: `${observer.name} still sees ${target.name} in the room`,
    })
    .not.toContain(target.identity);
  await expect
    .poll(() => roomState(target), {
      timeout: 20_000,
      message: `${target.name}'s app Room is still connected`,
    })
    .not.toBe('connected');
}

/**
 * `observer` doesn't have `target` in their room (an old-token rejoin may
 * show up there for the moment before it's removed).
 */
async function expectGoneFrom(observer: Participant, target: Participant): Promise<void> {
  await expect
    .poll(() => remoteIdentities(observer), {
      timeout: 10_000,
      message: `${observer.name} still sees ${target.name} in the room`,
    })
    .not.toContain(target.identity);
}

/** Why the target's app Room disconnected, for the test's annotations. */
async function annotateAppDisconnect(p: Participant): Promise<void> {
  const reason = await p.page.evaluate(
    () => (window as unknown as RevocationWindow).__e2eAppDisconnectReason,
  );
  test.info().annotations.push({
    type: 'app-room-disconnect-reason',
    description: `${p.name}: ${String(reason)} (PARTICIPANT_REMOVED = ${PARTICIPANT_REMOVED})`,
  });
}

/**
 * Rejoin with an old LiveKit token, from the participant's page, with a bare
 * livekit-client Room (no app, no session): the client a revoked user keeps.
 * LiveKit accepts the token (it can't be revoked), so the participant joins;
 * the backend's participant_joined webhook then removes it, which reaches the
 * client as a leave request with PARTICIPANT_REMOVED. That usually lands
 * while the client is still setting up its peer connections, so connect()
 * may reject: the leave reason is what's asserted (a refused token would be a
 * signal error instead, with no leave).
 */
async function expectOldTokenRejoinRemoved(
  p: Participant,
  livekitUrl: string,
  token: string,
): Promise<void> {
  await p.page.evaluate(
    ({ url, token: t }) => {
      const w = window as unknown as RevocationWindow;
      const state: ProbeState = { connected: false };
      w.__e2eProbe = state;
      const Room = w.__e2eRoomCtor;
      if (!Room) throw new Error('no livekit-client Room class stashed');
      const room = new Room();
      const onLeave = (reason: unknown) => {
        if (typeof reason === 'number' && state.disconnectReason === undefined) {
          state.disconnectReason = reason;
        }
      };
      room.once('disconnected', onLeave);
      const connecting = room.connect(url, t, { autoSubscribe: false });
      // The engine reports the server's leave even before the Room is up
      room.engine?.once('disconnected', onLeave);
      connecting.then(
        () => {
          state.connected = true;
        },
        (error: unknown) => {
          state.error = error instanceof Error ? error.message : String(error);
        },
      );
      w.__e2eProbeRoom = room;
    },
    { url: livekitUrl, token },
  );

  const probe = () =>
    p.page.evaluate(() => (window as unknown as RevocationWindow).__e2eProbe ?? null);
  try {
    await expect
      .poll(async () => (await probe())?.disconnectReason, {
        timeout: 20_000,
        message: `LiveKit never removed ${p.name}'s old-token rejoin`,
      })
      .toBe(PARTICIPANT_REMOVED);
  } finally {
    test.info().annotations.push({
      type: 'old-token-rejoin',
      description: `${p.name}: ${JSON.stringify(await probe())}`,
    });
    await p.page.evaluate(() =>
      (window as unknown as RevocationWindow).__e2eProbeRoom?.disconnect(),
    );
  }
}

async function livekitUrlOf(p: Participant): Promise<string> {
  const res = await p.context.request.get(`${API_BASE}/livekit/connection-info`, {
    headers: { Authorization: `Bearer ${p.accessToken}` },
  });
  if (!res.ok()) throw new Error(`connection-info: ${res.status()}`);
  const { url } = (await res.json()) as { url?: string };
  if (!url) throw new Error('connection-info returned no url');
  return url;
}

async function channelPresence(admin: Admin, channelId: string): Promise<string[]> {
  const body = (await adminCall(admin, 'GET', `/channels/${channelId}/voice-presence`)) as {
    users: Array<{ id: string }>;
  };
  return body.users.map((u) => u.id);
}

async function dmPresence(p: Participant, dmGroupId: string): Promise<string[]> {
  const res = await p.context.request.get(`${API_BASE}/dm-groups/${dmGroupId}/voice-presence`, {
    headers: { Authorization: `Bearer ${p.accessToken}` },
  });
  if (!res.ok()) throw new Error(`DM presence: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { users: Array<{ id: string }> }).users.map((u) => u.id);
}

/**
 * `p`'s Room stays connected for `ms` (a bounded poll that fails as soon as
 * it isn't): for the participant a revocation must NOT reach.
 */
async function expectStaysConnected(p: Participant, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    expect(await roomState(p), `${p.name}'s Room was disconnected`).toBe('connected');
    await p.page.waitForTimeout(250);
  }
}

/** The signed `semaphore.*` attributes `observer` sees on a remote participant. */
async function remoteAttributes(
  observer: Participant,
  identity: string,
): Promise<Record<string, string>> {
  return observer.page.evaluate((id) => {
    const remote = window.__lkRoom?.remoteParticipants.get(id) as
      | { attributes?: Record<string, string> }
      | undefined;
    return remote?.attributes ?? {};
  }, identity);
}

/** `<value>.<base64url hmac>` (livekit-token-attributes.util.ts). */
const SIGNED_VALUE = /^[^.]+\.[A-Za-z0-9_-]+$/;

/** Join the DM call of `dmGroupId` through the DM page's call button. */
async function joinDmCall(p: Participant, dmGroupId: string): Promise<void> {
  await p.page.goto(`/#/direct-messages/${dmGroupId}`);
  await p.page.getByLabel('Start voice call').getByRole('button').click();
  await expect
    .poll(() => roomState(p), {
      timeout: 30_000,
      message: `${p.name} never reached connected state in the DM call`,
    })
    .toBe('connected');
  p.identity = await p.page.evaluate(() => window.__lkRoom!.localParticipant.identity);
}

test.describe('Voice revocation — ban removes the user from a voice channel', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Admin;
  let a: Participant; // observer (testuser)
  let b: Participant; // banned (voiceban, InstanceRole.USER)
  let bToken: LivekitToken;
  let bUserId: string;

  test.beforeAll(async () => {
    admin = await adminApi();
    bUserId = await userIdOf(admin, VOICE_BAN_USER.username);
    // A retry starts over: the ban from the failed attempt must not stay
    // (a banned user's page can't stay signed in)
    await setBanned(admin, bUserId, false);
    b = await launchParticipant(VOICE_BAN_USER, 'sample-b.wav');

    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    await joinVoiceChannel(a, 'voice-revoke-ban');
    bToken = await captureLivekitToken(b, () => joinVoiceChannel(b, 'voice-revoke-ban'));
    await instrumentAppRoom(b);
  });

  test.afterAll(async () => {
    if (admin && bUserId) await setBanned(admin, bUserId, false).catch(() => {});
    await Promise.all([a, b].filter(Boolean).map(closeParticipant));
    await admin?.api.dispose();
  });

  test('baseline: A hears B, and B carries the signed semaphore.* attributes', async () => {
    expect(bToken.identity).toBe(b.identity);
    await waitForAudioFlow(a, b);

    // LiveKit hands the token's attributes to the other clients (and to the
    // webhook, see the rejoin below)
    const attributes = await remoteAttributes(a, b.identity);
    expect(attributes['semaphore.issuedAt']).toMatch(SIGNED_VALUE);
    expect(attributes['semaphore.sessionId']).toMatch(SIGNED_VALUE);
  });

  test('ban: B is removed from the room and A no longer sees or hears B', async () => {
    await setBanned(admin, bUserId, true);

    await expectRemovedFromCall(a, b);
    await annotateAppDisconnect(b);
    await expect
      .poll(() => channelPresence(admin, a.channelId), { timeout: 15_000 })
      .not.toContain(b.identity);
  });

  test("rejoining with B's old LiveKit token is removed again, with no voice presence", async () => {
    await expectOldTokenRejoinRemoved(b, await livekitUrlOf(a), bToken.token);

    await expectGoneFrom(a, b);
    await expect
      .poll(() => channelPresence(admin, a.channelId), { timeout: 10_000 })
      .not.toContain(b.identity);
  });
});

test.describe('Voice revocation — revoking one session removes only its participant', () => {
  test.describe.configure({ mode: 'serial' });

  let a: Participant; // observer in voice-revoke-session (testuser)
  let s1: Participant; // voicesession, session 1, in voice-revoke-session
  let s2: Participant; // voicesession, session 2, in voice-revoke-session-2
  let s1Token: LivekitToken;

  test.beforeAll(async () => {
    // Two browsers, two logins: two sessions of the same user. LiveKit allows
    // one participant per identity per room, so each is in its own room.
    s1 = await launchParticipant(VOICE_SESSION_USER, 'sample-b.wav');
    // Another device name ("Edge on Linux"): a login replaces the session
    // of the same device (AuthService.generateRefreshToken)
    s2 = await launchParticipant(VOICE_SESSION_USER, 'sample-c.wav', { userAgent: EDGE_ON_LINUX });
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    await joinVoiceChannel(a, 'voice-revoke-session');
    s1Token = await captureLivekitToken(s1, () => joinVoiceChannel(s1, 'voice-revoke-session'));
    await instrumentAppRoom(s1);
    await joinVoiceChannel(s2, 'voice-revoke-session-2');
  });

  test.afterAll(async () => {
    await Promise.all([a, s1, s2].filter(Boolean).map(closeParticipant));
  });

  test('baseline: A hears session 1, and session 2 is connected', async () => {
    await waitForAudioFlow(a, s1);
    expect(await roomState(s2)).toBe('connected');
  });

  test('revoking session 1 removes its participant; session 2 stays in its call', async () => {
    const sessions = async (p: Participant) => {
      const res = await p.context.request.get(`${API_BASE}/auth/sessions`, {
        headers: { Authorization: `Bearer ${p.accessToken}` },
      });
      if (!res.ok()) throw new Error(`sessions of ${p.name}: ${res.status()}`);
      return (await res.json()) as Array<{ id: string; isCurrent: boolean }>;
    };
    // Session 1's id, as session 1 itself sees it (its refresh cookie)
    const s1Session = (await sessions(s1)).find((s) => s.isCurrent);
    expect(s1Session, 'session 1 has no current session').toBeTruthy();

    // Session 2 revokes it ("sign out that device")
    const res = await s2.context.request.delete(`${API_BASE}/auth/sessions/${s1Session!.id}`, {
      headers: { Authorization: `Bearer ${s2.accessToken}` },
    });
    expect(res.ok(), `revoke session: ${res.status()} ${await res.text()}`).toBe(true);

    await expectRemovedFromCall(a, s1);
    await annotateAppDisconnect(s1);
    // The removal is done by now; session 2 is in its call all the same
    await expectStaysConnected(s2, 5_000);
  });

  test("rejoining with session 1's old LiveKit token is removed; session 2 stays", async () => {
    // Not banned and no token cutoff: only the token's signed session
    // attribute, delivered in participant_joined, gets this rejoin removed
    await expectOldTokenRejoinRemoved(s1, await livekitUrlOf(a), s1Token.token);
    await expectGoneFrom(a, s1);
    await expectStaysConnected(s2, 2_000);
  });
});

test.describe('Voice revocation — password reset removes the user; a fresh login rejoins', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Admin;
  let a: Participant; // observer (testuser)
  let b: Participant; // voicepassword
  let bToken: LivekitToken;
  let bUserId: string;
  let passwordResetAt = 0;

  test.beforeAll(async () => {
    admin = await adminApi();
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(VOICE_PASSWORD_USER, 'sample-b.wav');
    bUserId = await userIdOf(admin, VOICE_PASSWORD_USER.username);
    await joinVoiceChannel(a, 'voice-revoke-password');
    bToken = await captureLivekitToken(b, () => joinVoiceChannel(b, 'voice-revoke-password'));
    await instrumentAppRoom(b);
  });

  test.afterAll(async () => {
    await Promise.all([a, b].filter(Boolean).map(closeParticipant));
    await admin?.api.dispose();
  });

  test('baseline: A hears B', async () => {
    await waitForAudioFlow(a, b);
  });

  test('password reset: B is removed from the room', async () => {
    // The admin password override; the same password keeps the spec
    // repeatable, and still ends every session (PASSWORD_CHANGED)
    await adminCall(admin, 'PATCH', `/users/admin/${bUserId}/password`, {
      password: VOICE_PASSWORD_USER.password,
    });
    passwordResetAt = Date.now();

    await expectRemovedFromCall(a, b);
    await annotateAppDisconnect(b);
    await expect
      .poll(() => channelPresence(admin, a.channelId), { timeout: 15_000 })
      .not.toContain(b.identity);
  });

  test("rejoining with B's pre-reset LiveKit token is removed", async () => {
    await expectOldTokenRejoinRemoved(b, await livekitUrlOf(a), bToken.token);
    await expectGoneFrom(a, b);
  });

  test('a fresh login and join works, and stays', async () => {
    // A new browser: the signed-out tab's app is still winding down its
    // session (refresh, sign-out), which a login sharing its cookies would
    // race with
    await closeParticipant(b);
    // Known backend issue (reported with #554): the reset's access token
    // cutoff has one-second granularity (TokenBlacklistService
    // .revokeAllUserTokens, `iat <= cutoff`), so a login in the same second
    // as the reset gets a token that is already revoked. No person signs in
    // that fast; wait for the next second instead of tripping over it.
    const nextSecond = (Math.floor(passwordResetAt / 1000) + 1) * 1000;
    await expect.poll(() => Date.now(), { timeout: 5_000 }).toBeGreaterThan(nextSecond);
    b = await launchParticipant(VOICE_PASSWORD_USER, 'sample-b.wav');
    await joinVoiceChannel(b, 'voice-revoke-password');

    // A token issued after the cutoff is only let in through its signed
    // semaphore.issuedAt attribute in participant_joined: audio flowing for
    // seconds means the webhook didn't remove B
    await waitForAudioFlow(a, b, { timeout: 30_000 });
    expect(await roomState(b)).toBe('connected');
    await expect
      .poll(() => channelPresence(admin, a.channelId), { timeout: 15_000 })
      .toContain(b.identity);
  });
});

test.describe('Voice revocation — ban removes the user from a DM call', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: Admin;
  let a: Participant; // testuser
  let b: Participant; // voicedmban
  let bToken: LivekitToken;
  let bUserId: string;
  let dmGroupId: string;

  test.beforeAll(async () => {
    admin = await adminApi();
    bUserId = await userIdOf(admin, VOICE_DM_BAN_USER.username);
    // A retry starts over: the ban from the failed attempt must not stay
    // (a banned user's page can't stay signed in)
    await setBanned(admin, bUserId, false);
    b = await launchParticipant(VOICE_DM_BAN_USER, 'sample-b.wav');

    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    const res = await a.context.request.get(`${API_BASE}/direct-messages`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    });
    expect(res.ok()).toBe(true);
    const groups = (await res.json()) as Array<{
      id: string;
      isGroup: boolean;
      members: Array<{ userId: string }>;
    }>;
    const dm = groups.find((g) => !g.isGroup && g.members.some((m) => m.userId === bUserId));
    if (!dm) throw new Error('no seeded DM between testuser and voicedmban');
    dmGroupId = dm.id;

    await joinDmCall(a, dmGroupId);
    bToken = await captureLivekitToken(b, () => joinDmCall(b, dmGroupId));
    await instrumentAppRoom(b);
  });

  test.afterAll(async () => {
    if (admin && bUserId) await setBanned(admin, bUserId, false).catch(() => {});
    await Promise.all([a, b].filter(Boolean).map(closeParticipant));
    await admin?.api.dispose();
  });

  test('baseline: A and B hear each other in the DM call', async () => {
    expect(bToken.identity).toBe(b.identity);
    await waitForAudioFlow(a, b);
    await expect.poll(() => dmPresence(a, dmGroupId), { timeout: 15_000 }).toContain(b.identity);
  });

  test('ban: B is removed from the DM call', async () => {
    await setBanned(admin, bUserId, true);

    await expectRemovedFromCall(a, b);
    await annotateAppDisconnect(b);
    await expect
      .poll(() => dmPresence(a, dmGroupId), { timeout: 15_000 })
      .not.toContain(b.identity);
  });

  test("rejoining the DM call with B's old LiveKit token is removed again", async () => {
    await expectOldTokenRejoinRemoved(b, await livekitUrlOf(a), bToken.token);
    await expectGoneFrom(a, b);
    await expect
      .poll(() => dmPresence(a, dmGroupId), { timeout: 10_000 })
      .not.toContain(b.identity);
  });
});
