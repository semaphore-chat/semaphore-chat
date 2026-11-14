/**
 * Deafen — visible to the other participants, and kept across a rejoin.
 *
 * A call participant can no longer update their own LiveKit metadata, so a
 * deafen goes client → REST (`POST .../voice-presence/deafen`) → backend →
 * LiveKit admin API (`updateParticipant` metadata `{ isDeafened }`). Other
 * participants' tiles read `participant.metadata`, and the sidebar reads the
 * REST voice presence. These specs assert both, as real users see them, through
 * real LiveKit:
 *   - the "Deafened" badge on A's tile in B's view (data-testid voice-badge-deafened)
 *   - A's own Deafen button state and A's mic being off
 *   - (channel calls) GET voice-presence reports A as deafened
 * for a channel call and a DM call.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh
 */
import { expect, test, type Page } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  forceReconnect,
  TEST_USER,
  TEST_USER_2,
  type Participant,
} from '../fixtures/voice.fixture';
import { API_BASE } from '../fixtures/auth.fixture';

const POLL = { timeout: 15_000 };

/** The "Deafened" badges visible on `viewer`'s page (tiles of other participants). */
function deafenedBadges(viewer: Participant) {
  return viewer.page.getByTestId('voice-badge-deafened');
}

/** The bottom bar's Deafen toggle (scoped: the channel is named voice-deafen too). */
function deafenButton(p: Participant) {
  return p.page.getByTestId('voice-bar-controls').getByRole('button', { name: 'Deafen', exact: true });
}

/** Click the bottom bar's Deafen toggle. */
async function setDeafened(p: Participant, deafened: boolean): Promise<void> {
  const button = deafenButton(p);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', String(deafened), POLL);
}

/** A's microphone is not publishing (the mic is off while deafened). */
async function expectMicOff(p: Participant): Promise<void> {
  await expect
    .poll(() => p.page.evaluate(() => window.__lkRoom!.localParticipant.isMicrophoneEnabled), POLL)
    .toBe(false);
}

async function presenceDeafened(
  reader: Participant,
  path: string,
  userId: string,
): Promise<boolean | undefined> {
  const res = await reader.context.request.get(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${reader.accessToken}` },
  });
  if (!res.ok()) throw new Error(`presence ${path}: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { users: Array<{ id: string; isDeafened: boolean }> };
  return body.users.find((u) => u.id === userId)?.isDeafened;
}

async function waitConnected(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__lkRoom?.state ?? 'none'), { timeout: 30_000 })
    .toBe('connected');
}

test.describe.configure({ mode: 'serial' });

test.describe('Deafen — channel call', () => {
  let a: Participant; // testuser
  let b: Participant; // testuser2

  test.beforeAll(async () => {
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(a, 'voice-deafen');
    await joinVoiceChannel(b, 'voice-deafen');
    // Both see each other before anything is toggled.
    await expect
      .poll(
        () => b.page.evaluate(() => window.__lkRoom!.remoteParticipants.size),
        POLL,
      )
      .toBe(1);
    await expect(deafenedBadges(b)).toHaveCount(0);
  });

  test.afterAll(async () => {
    await Promise.all([a, b].filter(Boolean).map(closeParticipant));
  });

  const presencePath = () => `/channels/${a.channelId}/voice-presence`;

  test('A deafens: B sees A deafened, A shows deafened with the mic off, presence agrees', async () => {
    await setDeafened(a, true);

    await expect(deafenedBadges(b).first()).toBeVisible(POLL);
    await expectMicOff(a);
    await expect
      .poll(() => presenceDeafened(b, presencePath(), a.identity), POLL)
      .toBe(true);
  });

  test('A undeafens: B no longer sees A deafened', async () => {
    await setDeafened(a, false);

    await expect(deafenedBadges(b)).toHaveCount(0, POLL);
    await expect
      .poll(() => presenceDeafened(b, presencePath(), a.identity), POLL)
      .toBe(false);
  });

  test('A deafens and hangs up: B sees A leave, and a fresh join starts undeafened for everyone', async () => {
    await setDeafened(a, true);
    await expect(deafenedBadges(b).first()).toBeVisible(POLL);

    // Hang-up resets the client's deafen state (SetDisconnected), so this is
    // not a "rejoin while deafened": the new session must not inherit a stale
    // server-side deafened flag either.
    await a.page.getByRole('button', { name: 'Disconnect' }).click();
    await expect
      .poll(() => b.page.evaluate(() => window.__lkRoom!.remoteParticipants.size), POLL)
      .toBe(0);

    await joinVoiceChannel(a, 'voice-deafen');
    await expect
      .poll(() => b.page.evaluate(() => window.__lkRoom!.remoteParticipants.size), POLL)
      .toBe(1);
    await expect(deafenButton(a)).toHaveAttribute('aria-pressed', 'false');
    await expect(deafenedBadges(b)).toHaveCount(0);
    await expect
      .poll(() => presenceDeafened(b, presencePath(), a.identity), POLL)
      .toBe(false);
  });

  test('A deafens, then a full LiveKit reconnect rebuilds the session: B still sees A deafened', async () => {
    await setDeafened(a, true);
    await expect(deafenedBadges(b).first()).toBeVisible(POLL);

    // A full reconnect is the rejoin that keeps the app's deafen state.
    await forceReconnect(a, 'full-reconnect');
    await waitConnected(a.page);

    await expect(deafenButton(a)).toHaveAttribute('aria-pressed', 'true');
    await expect(deafenedBadges(b).first()).toBeVisible(POLL);
    await expect
      .poll(() => presenceDeafened(b, presencePath(), a.identity), POLL)
      .toBe(true);
    await expectMicOff(a);
  });
});

test.describe('Deafen — DM call', () => {
  let a: Participant; // testuser
  let b: Participant; // testuser2
  let dmGroupId: string;

  async function joinDmCall(p: Participant): Promise<void> {
    await p.page.goto(`/#/direct-messages/${dmGroupId}`);
    await p.page.getByLabel('Start voice call').getByRole('button').click();
    await waitConnected(p.page);
    p.identity = await p.page.evaluate(() => window.__lkRoom!.localParticipant.identity);
  }

  test.beforeAll(async () => {
    a = await launchParticipant(TEST_USER, 'sample-a.wav');
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    const res = await a.context.request.get(`${API_BASE}/direct-messages`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    });
    expect(res.ok()).toBe(true);
    const groups = (await res.json()) as Array<{
      id: string;
      isGroup: boolean;
      members: Array<{ user?: { username: string } }>;
    }>;
    const dm = groups.find(
      (g) => !g.isGroup && g.members.some((m) => m.user?.username === TEST_USER_2.username),
    );
    if (!dm) throw new Error('no seeded DM between testuser and testuser2');
    dmGroupId = dm.id;

    await joinDmCall(a);
    await joinDmCall(b);
    await expect
      .poll(() => b.page.evaluate(() => window.__lkRoom!.remoteParticipants.size), POLL)
      .toBe(1);
  });

  test.afterAll(async () => {
    await Promise.all([a, b].filter(Boolean).map(closeParticipant));
  });

  test('A deafens and undeafens: B sees it come and go, and the mic is off while deafened', async () => {
    // No REST presence assertion here: DM presence has no per-user deafen
    // state (the deafen route only sets LiveKit metadata; see
    // VoicePresenceService.updateDmDeafenState), so tiles are the signal.
    await setDeafened(a, true);
    await expect(deafenedBadges(b).first()).toBeVisible(POLL);
    await expectMicOff(a);

    await setDeafened(a, false);
    await expect(deafenedBadges(b)).toHaveCount(0, POLL);
  });
});
