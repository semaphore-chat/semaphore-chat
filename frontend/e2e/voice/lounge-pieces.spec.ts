/**
 * The Lounge's call slot against real LiveKit, on the hidden community fixture
 * `/__lounge/community/:communityId` (every piece of the shell on real data; here the seeded Test Community).
 * A is on a phone (390 px), where the call bar has mute (or hold to talk), deafen, Open and Leave:
 *
 *   1. Mute and Deafen on the Lounge bar: B stops and resumes receiving A; Mute while deafened is the
 *      classic Mute (the mic opens, A stays deafened, and the bar says so); Leave ends the call;
 *   2. push-to-talk: holding the bar's hold-to-talk control transmits, letting go stops;
 *   3. a moderator's mute: the bar shows the mic unavailable with the reason (still a Tab stop; pressing it
 *      changes nothing), and A stays silent;
 *   4. B shares a screen: the call surface offers it (nothing received yet), Watch shows a decoding video,
 *      Stop watching unsubscribes it; watched again, B stops sharing: the tile goes and nothing of the share
 *      stays subscribed; Open call view goes to the classic stage;
 *   5. a join from a room card that fails shows the voice notice in the call slot with Retry; the room is
 *      deleted meanwhile, so Retry's join is refused: the notice says so, without Retry; Dismiss clears it.
 *      (Not "the room you are in is deleted": deleting a voice channel does not end its LiveKit call, #812.)
 *
 * Then, on the room cards of the left island (A joins from a card, B classic):
 *
 *   V1. joining from a card stays on the screen and outlines the card; the server lists A; audio both ways
 *       (on the fixture and on the real community home `/community/:id`, PR 9b);
 *   V3. Leave from the card and from the bar both end the call;
 *   V4. a failed join shows once, in the voice notice; Retry joins;
 *   V6. the call survives moving between communities in the Lounge (dock and sheet), on the fixture and on the
 *       real community home;
 *   V7. signing out mid-call from the account menu leaves the call;
 *   V8. a card joiner publishes the soundboard track like a classic one: B renders A's mic and soundboard, and
 *       opening the classic shell afterwards (its Messages screen, and Back) adds no <audio> element on B;
 *   V9. in a call, the real channel chat crossing widths (390 to 1440 and back, #848 C3) keeps the call: the same
 *       Room and <audio> elements, no new getUserMedia, audio both ways, the Lounge call bar at every width.
 *
 * The soundboard warm-up runs above both shells (VoiceSessionEffects → useSoundboardWarmup), so a card joiner and a
 * classic joiner (`joinVoiceChannel`) publish the same tracks, and a shell change publishes nothing late.
 *
 * Requires the real-LiveKit stack: scripts/run-voice-e2e.sh lounge-pieces
 */
import { test, expect, type Page } from '@playwright/test';
import {
  launchParticipant,
  joinVoiceChannel,
  closeParticipant,
  waitForAudioFlow,
  expectNoAudioGrowth,
  moderatorMute,
  setMicEnabled,
  startScreenShare,
  stopScreenShare,
  getSubscriptionState,
  countScreenShareAudio,
  ADMIN_USER,
  TEST_USER,
  TEST_USER_2,
  type Participant,
} from '../fixtures/voice.fixture';
import { API_BASE, loginViaApi } from '../fixtures/auth.fixture';
import { createTestChannel } from '../fixtures/test-data';
import {
  LOUNGE_WHERES,
  expectCallUntouched,
  goTo,
  joinFromRoomCard,
  loungeUrl,
  openFixture,
  tagCall,
  countGetUserMedia,
  type LoungeWhere,
} from '../fixtures/lounge';

// Each test launches its own participants: independent, so one failing never skips the others.

const CH = 'voice-lounge';
const ROOM2 = 'voice-lounge-2';
const PHONE = { width: 390, height: 844 };
const POLL = { timeout: 15_000 };
/** The browser's own console line for a request that failed with one of these statuses. */
const failedRequest = (...statuses: number[]) =>
  `^Failed to load resource: the server responded with a status of (${statuses.join('|')})`;

/**
 * The community fixture is on screen and loaded: the new shell with the community's header (its name as the left
 * island's heading, what the fixture's screen renders at phone width, where the left pane shows).
 */
const fixture = (page: Page) =>
  page.locator('[data-shell="lounge"]').getByRole('heading', { name: 'Test Community', level: 2 });

/** The seeded Test Community's id, for the fixture's path. */
async function testCommunityId(p: Participant): Promise<string> {
  const mine = await p.context.request.get(`${API_BASE}/community/mine`, {
    headers: { Authorization: `Bearer ${p.accessToken}` },
  });
  expect(mine.ok(), `GET /community/mine: ${mine.status()}`).toBe(true);
  const communities = (await mine.json()) as Array<{ id: string; name: string } | null>;
  const community = communities.find((x) => x?.name === 'Test Community');
  expect(community, 'the seeded Test Community').toBeDefined();
  return community!.id;
}
const callBar = (page: Page) => page.getByTestId('lounge-call-bar');
const classicBar = (page: Page) => page.getByTestId('voice-bar-controls');
const micOn = (p: Participant) =>
  p.page.evaluate(
    () =>
      (window.__lkRoom?.localParticipant as unknown as { isMicrophoneEnabled?: boolean } | undefined)?.isMicrophoneEnabled ??
      null,
  );

/** A on the Lounge fixture at phone width, in the call it already joined. */
async function toLounge(p: Participant): Promise<void> {
  await p.page.setViewportSize(PHONE);
  await goTo(p.page, `/__lounge/community/${await testCommunityId(p)}?design=lounge`);
  await expect(fixture(p.page)).toBeVisible();
  await expect(callBar(p.page)).toBeVisible();
  await expect(classicBar(p.page)).toHaveCount(0);
}

test.describe('The Lounge call bar, call surface and room cards', () => {
  let a: Participant;
  let b: Participant;
  let c: Participant;
  const consoleErrors: string[] = [];
  /** Errors a step causes on purpose: the app's own logging of a failed join, and the browser's failed-request line. */
  let expectedErrors: RegExp | null = null;

  test.afterEach(async () => {
    await Promise.all([a, b, c].filter(Boolean).map((p) => closeParticipant(p).catch(() => {})));
    a = b = c = undefined as unknown as Participant;
    const unexpected = consoleErrors.filter((text) => !expectedErrors?.test(text));
    expect(unexpected, 'console.error on A').toEqual([]);
    consoleErrors.length = 0;
    expectedErrors = null;
  });

  async function launchA(): Promise<Participant> {
    const p = await launchParticipant(TEST_USER, 'sample-a.wav');
    p.page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    return p;
  }

  test('1: mute and deafen on the Lounge bar stop and resume what B receives; Leave ends the call', async () => {
    test.setTimeout(180_000);
    a = await launchA();
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await waitForAudioFlow(b, a);
    await toLounge(a);
    await expect(callBar(a.page)).toContainText(CH);

    const mute = callBar(a.page).getByRole('button', { name: 'Mute', exact: true });
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true', POLL);
    await expect.poll(() => micOn(a), POLL).toBe(false);
    await expectNoAudioGrowth(b, a);
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false', POLL);
    await waitForAudioFlow(b, a);

    const deafen = callBar(a.page).getByRole('button', { name: 'Deafen', exact: true });
    await deafen.click();
    await expect(deafen).toHaveAttribute('aria-pressed', 'true', POLL);
    await expect(callBar(a.page).getByText('Deafened', { exact: true })).toBeVisible();
    // Deafen also mutes (as on the classic bar): B stops receiving A.
    await expect.poll(() => micOn(a), POLL).toBe(false);
    await expectNoAudioGrowth(b, a);
    await deafen.click();
    await expect(deafen).toHaveAttribute('aria-pressed', 'false', POLL);
    await expect.poll(() => micOn(a), { ...POLL, message: 'undeafen restores the mic that was on' }).toBe(true);
    await waitForAudioFlow(b, a);

    // Mute while deafened is the classic Mute: it opens the mic and leaves A deafened. Both buttons and the
    // line say so, and Deafen is right there to undeafen.
    await deafen.click();
    await expect(deafen).toHaveAttribute('aria-pressed', 'true', POLL);
    await expect.poll(() => micOn(a), POLL).toBe(false);
    await mute.click();
    await expect.poll(() => micOn(a), { ...POLL, message: 'Mute while deafened opens the mic' }).toBe(true);
    await expect(mute).toHaveAttribute('aria-pressed', 'false', POLL);
    await expect(deafen).toHaveAttribute('aria-pressed', 'true');
    await expect(callBar(a.page).getByText('Deafened · your mic is on', { exact: true })).toBeVisible();
    await waitForAudioFlow(b, a);
    await deafen.click();
    await expect(deafen).toHaveAttribute('aria-pressed', 'false', POLL);
    await expect(callBar(a.page).getByText('Deafened · your mic is on', { exact: true })).toHaveCount(0);

    await callBar(a.page).getByRole('button', { name: 'Leave call' }).click();
    await expect.poll(() => a.page.evaluate(() => window.__lkRoom?.state ?? 'none'), POLL).not.toBe('connected');
    await expect(callBar(a.page)).toHaveCount(0);
    await expect(fixture(a.page)).toBeVisible();
  });

  test('2: push-to-talk: holding the bar control transmits, letting go stops', async () => {
    test.setTimeout(180_000);
    a = await launchA();
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await a.page.evaluate(() =>
      localStorage.setItem(
        'semaphore_voice_settings',
        JSON.stringify({ inputMode: 'push_to_talk', pushToTalkKey: 'Backquote', pushToTalkKeyDisplay: '`' }),
      ),
    );
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await expect.poll(() => micOn(a), { ...POLL, message: 'PTT starts with the mic off' }).toBe(false);
    await toLounge(a);

    const hold = callBar(a.page).getByRole('button', { name: 'Hold to talk' });
    await expect(callBar(a.page).getByText('Hold the mic to talk', { exact: true })).toBeVisible();
    const box = (await hold.boundingBox())!;
    await a.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await a.page.mouse.down();
    await expect.poll(() => micOn(a), { ...POLL, message: 'holding transmits' }).toBe(true);
    await waitForAudioFlow(b, a);
    // Slide off while holding: still transmitting (the control holds the pointer).
    await a.page.mouse.move(box.x - 150, box.y - 300, { steps: 6 });
    expect(await micOn(a)).toBe(true);
    await a.page.mouse.up();
    await expect.poll(() => micOn(a), { ...POLL, message: 'letting go stops' }).toBe(false);
    await expectNoAudioGrowth(b, a);
  });

  test("3: a moderator's mute: the bar shows the mic blocked with the reason, and A stays silent", async () => {
    test.setTimeout(180_000);
    a = await launchA();
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    c = await launchParticipant(ADMIN_USER, 'sample-c.wav');
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await joinVoiceChannel(c, CH);
    await waitForAudioFlow(b, a);
    await toLounge(a);

    await moderatorMute(c, a.identity, true, a.channelId);
    const mute = callBar(a.page).getByRole('button', { name: 'Mute', exact: true });
    await expect(mute).toHaveAttribute('aria-disabled', 'true', POLL);
    await expect(callBar(a.page).getByText('Muted by a moderator', { exact: true })).toBeVisible();
    await expect.poll(() => micOn(a), POLL).toBe(false);
    // Still a Tab stop with its name; pressing it says why and opens nothing.
    await mute.focus();
    await expect(mute).toBeFocused();
    await mute.press('Enter');
    // The press says why, through the kit's announcer (its polite live region keeps the text).
    await expect(
      a.page.locator('[data-kit-live-slot] [aria-live="polite"]', { hasText: 'Muted by a moderator' }),
    ).toHaveCount(1, POLL);
    // Playwright counts aria-disabled as not enabled; the user can still tap it.
    await mute.click({ force: true });
    expect(await micOn(a)).toBe(false);
    await setMicEnabled(a, true).catch(() => {});
    await expectNoAudioGrowth(b, a);

    await moderatorMute(c, a.identity, false, a.channelId);
    await expect(mute).not.toHaveAttribute('aria-disabled', 'true', POLL);
  });

  test('4: a peer shares a screen: offered, Watch decodes it, Stop watching unsubscribes, the share ending takes its tile, Open call view goes to the stage', async () => {
    test.setTimeout(180_000);
    a = await launchA();
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(a, CH);
    await joinVoiceChannel(b, CH);
    await toLounge(a);

    const started = await startScreenShare(b);
    // Locally a missing headless capture skips; in CI it must not hide the surface's coverage.
    if (process.env.CI) expect(started, 'headless screen capture in CI').toBe(true);
    test.skip(!started, 'Headless screen capture is unavailable in this env.');

    const surface = a.page.getByTestId('lounge-call-surface');
    const watch = surface.getByRole('button', { name: /^Watch .+'s screen$/ });
    await expect(watch).toBeVisible(POLL);
    // Offered, not received: nothing is watched by itself.
    expect((await getSubscriptionState(a, b.identity))?.screenShare.subscribed).toBe(false);

    await watch.click();
    const video = surface.locator('video');
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth).catch(() => 0), {
        timeout: 25_000,
        message: 'the shared screen decodes in the call surface',
      })
      .toBeGreaterThan(0);

    await surface.getByRole('button', { name: 'Stop watching' }).click();
    await expect
      .poll(async () => (await getSubscriptionState(a, b.identity))?.screenShare.subscribed, {
        ...POLL,
        message: 'Stop watching unsubscribes the share',
      })
      .toBe(false);
    await expect(video).toHaveCount(0);
    // Still published: offered again.
    await expect(watch).toBeVisible();

    // Watched again, then B stops sharing: the tile and the surface go, and nothing of the share (picture or
    // its audio) is left subscribed on A.
    await watch.click();
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth).catch(() => 0), { timeout: 25_000 })
      .toBeGreaterThan(0);
    await stopScreenShare(b);
    await expect(video).toHaveCount(0, POLL);
    await expect(surface).toHaveCount(0, POLL);
    await expect
      .poll(async () => (await getSubscriptionState(a, b.identity))?.screenShare.subscribed ?? false, {
        ...POLL,
        message: 'nothing of the ended share stays subscribed',
      })
      .toBe(false);
    await expect.poll(async () => (await countScreenShareAudio(a)).subscribed, POLL).toBe(0);
    await expect(callBar(a.page)).toBeVisible();

    // The room's name on the bar is the Open call view control.
    await callBar(a.page).getByRole('button', { name: /^Open call view, / }).click();
    await expect(a.page).toHaveURL(new RegExp(`#/community/[^/]+/channel/${a.channelId}`));
    await expect(fixture(a.page)).toHaveCount(0);
    await expect(callBar(a.page)).toHaveCount(0);
    await expect.poll(() => a.page.evaluate(() => window.__lkRoom?.state ?? 'none')).toBe('connected');
  });

  // Not "the room you are in is deleted": deleting a voice channel leaves its LiveKit call running (the
  // backend never deletes the room), so there is nothing for the bar to show yet. Issue #812.
  test('5: a failed join from a room card shows the notice in the call slot; Retry to a room deleted meanwhile says it is gone', async () => {
    test.setTimeout(180_000);
    a = await launchA();
    c = await launchParticipant(ADMIN_USER, 'sample-c.wav');
    const communityId = await testCommunityId(c);
    const name = `lounge-temp-${Date.now()}`;
    const channel = await createTestChannel(c.context.request, communityId, { name, type: 'VOICE' }, c.accessToken);
    const deleteChannel = () =>
      c.context.request.delete(`${API_BASE}/channels/${channel.id}`, { headers: { Authorization: `Bearer ${c.accessToken}` } });

    // The join path logs each failed join (voiceActions), and the browser each failed request: the two failures
    // this step causes (the 503, then the server refusing a room that is gone) are expected.
    expectedErrors = new RegExp(
      `Failed to join voice channel: \\{(statusCode: 503, message: Unavailable|message: Channel not found)|${failedRequest(503, 403, 404)}`,
    );
    try {
      // The temporary room's card: the fixture is opened after the room exists.
      await a.page.setViewportSize(PHONE);
      await openFixture(a.page, communityId, { communityName: 'Test Community' });
      const join = a.page.locator('[data-shell="lounge"]').getByRole('button', { name: `Join ${name}`, exact: true });
      await expect(join).toBeVisible({ timeout: 20_000 });

      // The first join fails on the server (a 503 from the token endpoint): a failure Retry can help.
      const token = '**/api/livekit/token';
      await a.page.route(token, (route) =>
        route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: 'Unavailable' }) }),
      );
      await join.click();
      const notice = a.page.getByTestId('lounge-voice-notice');
      await expect(notice).toBeVisible(POLL);
      await expect(notice).toContainText('Voice server error');
      await expect(a.page.getByTestId('voice-notice')).toHaveCount(0);
      await expect(callBar(a.page)).toHaveCount(0);

      // The room is deleted meanwhile; Retry joins it for real and the server says it is gone.
      const res = await deleteChannel();
      expect(res.ok(), `DELETE channel: ${res.status()}`).toBe(true);
      await a.page.unroute(token);
      await notice.getByRole('button', { name: 'Retry' }).click();
      await expect(notice).not.toContainText('Voice server error', { timeout: 20_000 });
      await expect(notice).toBeVisible();
      expect(await a.page.evaluate(() => window.__lkRoom?.state ?? 'none')).not.toBe('connected');
      // Nothing to retry for a room that is gone (as the classic notice).
      await expect(notice.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(callBar(a.page)).toHaveCount(0);
      await notice.getByRole('button', { name: 'Dismiss' }).click();
      await expect(notice).toHaveCount(0);
    } finally {
      await deleteChannel().catch(() => {});
    }
  });
  // ---- The room cards of the left island ------------------------------------------------------------------

  const shell = (page: Page) => page.locator('[data-shell="lounge"]');
  /** The room's card: the one Card that says "You're here" (`aria-current="true"`) holds its heading. */
  const youAreHereCard = (page: Page, room: string) =>
    shell(page).locator('[aria-current="true"]', { has: page.getByRole('heading', { name: room, level: 3, exact: true }) });
  const joinButton = (page: Page, room: string) => shell(page).getByRole('button', { name: `Join ${room}`, exact: true });
  const leaveButton = (page: Page, room: string) => shell(page).getByRole('button', { name: `Leave ${room}`, exact: true });
  const state = (p: Participant) => p.page.evaluate(() => window.__lkRoom?.state ?? 'none');

  /** Whether `viewer` (a classic participant) is told that `who` is in the room: the server's voice presence. */
  const roomLists = async (viewer: Participant, who: Participant): Promise<boolean> => {
    const res = await viewer.context.request.get(`${API_BASE}/channels/${who.channelId}/voice-presence`, {
      headers: { Authorization: `Bearer ${viewer.accessToken}` },
    });
    if (!res.ok()) throw new Error(`voice-presence: ${res.status()} ${await res.text()}`);
    const body = (await res.json()) as { users: Array<{ id: string }> };
    return body.users.some((user) => user.id === who.identity);
  };

  async function communityIdByName(p: Participant, name: string): Promise<string> {
    const mine = await p.context.request.get(`${API_BASE}/community/mine`, { headers: { Authorization: `Bearer ${p.accessToken}` } });
    expect(mine.ok(), `GET /community/mine: ${mine.status()}`).toBe(true);
    const found = ((await mine.json()) as Array<{ id: string; name: string } | null>).find((x) => x?.name === name);
    expect(found, `the seeded ${name}`).toBeDefined();
    return found!.id;
  }

  /** A on Test Community (the fixture, or the real home) at `viewport`, in no call; B (classic) is in `room` already. */
  async function aOnFixtureWithBInRoom(room: string, viewport = PHONE, where: LoungeWhere = 'fixture'): Promise<string> {
    a = await launchA();
    b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
    await joinVoiceChannel(b, room);
    await a.page.setViewportSize(viewport);
    const id = await testCommunityId(a);
    await openFixture(a.page, id, { communityName: 'Test Community', where });
    await expect(a.page).toHaveURL(loungeUrl(where, id), { timeout: 20_000 });
    return id;
  }

  for (const where of LOUNGE_WHERES) {
    test(`V1: joining from a room card stays on the screen, outlines the card "You're here", and the server lists A (${where})`, async () => {
      test.setTimeout(180_000);
      const id = await aOnFixtureWithBInRoom(CH, PHONE, where);
      await expect(youAreHereCard(a.page, CH)).toHaveCount(0);

      await joinFromRoomCard(a, CH);
      await expect(a.page).toHaveURL(loungeUrl(where, id));
      expect(await state(a)).toBe('connected');
      const card = youAreHereCard(a.page, CH);
      await expect(card).toHaveCount(1);
      await expect(card.getByText("You're here", { exact: true })).toBeVisible();
      expect(await card.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
      await expect(leaveButton(a.page, CH)).toBeVisible();
      await expect(callBar(a.page)).toBeVisible();
      await expect.poll(() => roomLists(b, a), { timeout: 20_000, message: "the server's voice presence lists A" }).toBe(true);
      await waitForAudioFlow(b, a);
      await waitForAudioFlow(a, b);
    });
  }

  test('V3: Leave from the card and from the bar both end the call', async () => {
    test.setTimeout(180_000);
    await aOnFixtureWithBInRoom(CH);

    await joinFromRoomCard(a, CH);
    await expect(callBar(a.page)).toBeVisible();
    await leaveButton(a.page, CH).click();
    await expect.poll(() => state(a), POLL).not.toBe('connected');
    await expect(youAreHereCard(a.page, CH)).toHaveCount(0, POLL);
    await expect(joinButton(a.page, CH)).toBeVisible(POLL);
    await expect(callBar(a.page)).toHaveCount(0, POLL);

    await joinFromRoomCard(a, CH);
    await expect(callBar(a.page)).toBeVisible();
    await callBar(a.page).getByRole('button', { name: 'Leave call' }).click();
    await expect.poll(() => state(a), POLL).not.toBe('connected');
    await expect(youAreHereCard(a.page, CH)).toHaveCount(0, POLL);
    await expect(joinButton(a.page, CH)).toBeVisible(POLL);
    await expect(callBar(a.page)).toHaveCount(0, POLL);
  });

  test('V4: a failed join from a card shows once, in the voice notice, and Retry joins', async () => {
    test.setTimeout(180_000);
    await aOnFixtureWithBInRoom(CH);
    // The app logs each failed join (voiceActions): the one this step causes is expected.
    expectedErrors = new RegExp(`Failed to join voice channel: \\{statusCode: 503, message: Unavailable|${failedRequest(503)}`);

    const token = '**/api/livekit/token';
    await a.page.route(token, (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusCode: 503, message: 'Unavailable' }) }),
    );
    await joinButton(a.page, CH).click();

    const notice = a.page.getByTestId('lounge-voice-notice');
    await expect(notice).toHaveCount(1, { timeout: 20_000 });
    await expect(notice).toContainText('Voice server error');
    // Said once, in the call slot: no toast, no classic notice.
    await expect(a.page.getByTestId('voice-notice')).toHaveCount(0);
    await expect(a.page.locator('[data-kit-toast-region]').getByText(/voice|join/i)).toHaveCount(0);
    await expect(youAreHereCard(a.page, CH)).toHaveCount(0);
    await expect(joinButton(a.page, CH)).not.toHaveAttribute('aria-busy', 'true', POLL);
    await expect(joinButton(a.page, CH)).toBeEnabled();
    expect(await state(a)).not.toBe('connected');
    // Still said once, after the card settled: no second notice or toast came in late.
    const saidOnce = async (step: string) => {
      await expect(a.page.getByTestId('lounge-voice-notice'), step).toHaveCount(1);
      await expect(a.page.getByTestId('voice-notice'), step).toHaveCount(0);
      await expect(a.page.locator('[data-kit-toast-region]').getByText(/voice|join/i), step).toHaveCount(0);
    };
    await saidOnce('after the card settled');

    await a.page.unroute(token);
    await notice.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => state(a), { timeout: 30_000, message: 'Retry joins' }).toBe('connected');
    await expect(youAreHereCard(a.page, CH)).toHaveCount(1, POLL);
    await expect(a.page.getByTestId('lounge-voice-notice')).toHaveCount(0, POLL);
    await expect(callBar(a.page)).toBeVisible();
    // Nothing of the failure surfaced elsewhere meanwhile.
    await expect(a.page.getByTestId('voice-notice')).toHaveCount(0);
    await expect(a.page.locator('[data-kit-toast-region]').getByText(/voice|join/i)).toHaveCount(0);
  });

  for (const where of LOUNGE_WHERES) {
    test(`V6: the call survives moving between communities in the Lounge (${where})`, async () => {
      test.setTimeout(240_000);
      a = await launchA();
      b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
      await joinVoiceChannel(b, ROOM2);
      await a.page.setViewportSize(PHONE);
      // A probe on this page only: counts getUserMedia from here on (the page is not reloaded below).
      await a.page.evaluate(countGetUserMedia);
      const testId = await testCommunityId(a);
      const secondId = await communityIdByName(a, 'Second Community');
      await openFixture(a.page, testId, { communityName: 'Test Community', where });
      await joinFromRoomCard(a, ROOM2);
      await waitForAudioFlow(a, b);
      await waitForAudioFlow(b, a);

      // Both published their soundboard tracks (A from the card, B from the classic page): tag both sides.
      const before = await tagCall(a, b);
      const onB = await tagCall(b, a);
      expect(before.gum).toBeGreaterThan(0);
      await a.page.evaluate(() => {
        (document.querySelector('nav[aria-label="Communities"]') as unknown as Record<string, unknown>).__keptDock = true;
      });

      const dock = a.page.getByRole('navigation', { name: 'Communities', exact: true });
      const dockLink = (name: string) => dock.getByRole('link', { name: new RegExp(`^${name}`) });
      const moves: Array<{ via: 'dock' | 'sheet'; name: string; id: string }> = [
        { via: 'dock', name: 'Second Community', id: secondId },
        { via: 'sheet', name: 'Test Community', id: testId },
        { via: 'dock', name: 'Second Community', id: secondId },
        { via: 'sheet', name: 'Test Community', id: testId },
        { via: 'dock', name: 'Second Community', id: secondId },
      ];
      for (const [i, move] of moves.entries()) {
        const step = `move ${i + 1}: ${move.via} to ${move.name}`;
        if (move.via === 'dock') {
          await dockLink(move.name).click();
        } else {
          await dock.getByRole('button', { name: 'All communities', exact: true }).click();
          await a.page
            .getByRole('dialog', { name: 'All communities', exact: true })
            .getByRole('link', { name: new RegExp(`^${move.name}`) })
            .click();
        }
        await expect(a.page, step).toHaveURL(loungeUrl(where, move.id), { timeout: 20_000 });
        await expect(
          shell(a.page).getByRole('heading', { name: move.name, level: 2, exact: true }),
          step,
        ).toBeVisible({ timeout: 20_000 });
        await expect(callBar(a.page), step).toBeVisible();
        await expectCallUntouched(a, before, step);
        await expectCallUntouched(b, onB, `${step} (on B)`);
        await waitForAudioFlow(b, a);
        expect(
          await a.page.evaluate(() => !!(document.querySelector('nav[aria-label="Communities"]') as unknown as Record<string, unknown>)?.__keptDock),
          `${step}: the dock was not remounted`,
        ).toBe(true);
      }

      // One channel tap into the Lounge chat and Back: the screen change publishes nothing late, so B keeps its elements.
      const firstChannel = shell(a.page).getByRole('navigation', { name: 'Community', exact: true }).getByRole('link').first();
      await firstChannel.click();
      await expect(a.page.getByRole('textbox', { name: /^Message #/ })).toBeVisible({ timeout: 20_000 });
      await a.page.goBack();
      await expect(shell(a.page).getByRole('heading', { name: 'Second Community', level: 2, exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(callBar(a.page)).toBeVisible();
      await expectCallUntouched(a, before, 'after a channel tap and Back');
      await waitForAudioFlow(b, a);
      await expectCallUntouched(b, onB, 'after a channel tap and Back (on B)');
    });
  }

  test('V9: in a call, crossing widths in the Lounge chat keeps the call (390 → 820 → 1440 → 1000 → 500 → 1440 → 390)', async () => {
    test.setTimeout(240_000);
    await aOnFixtureWithBInRoom(CH, PHONE, 'real');
    // A probe on this page only: counts getUserMedia from here on (the page is not reloaded below).
    await a.page.evaluate(countGetUserMedia);
    await joinFromRoomCard(a, CH);
    await waitForAudioFlow(a, b);
    await waitForAudioFlow(b, a);
    const before = await tagCall(a, b);
    const onB = await tagCall(b, a);
    expect(before.gum).toBeGreaterThan(0);

    // Into a text channel's chat on the real route: since C3 it is the new shell's at every width, so no resize below
    // swaps shells, and the call bar stays in the frame's call slot.
    await shell(a.page).getByRole('navigation', { name: 'Community', exact: true }).getByRole('link').first().click();
    await expect(a.page.getByRole('textbox', { name: /^Message #/ })).toBeVisible({ timeout: 20_000 });
    const chatUrl = a.page.url();
    expect(chatUrl).toMatch(/#\/community\/[^/]+\/channel\/[^/?]+$/);

    for (const width of [820, 1440, 1000, 500, 1440, 390]) {
      const step = `the chat at ${width}px`;
      await a.page.setViewportSize({ width, height: 900 });
      await expect(shell(a.page), step).toBeAttached();
      await expect(a.page.getByRole('textbox', { name: /^Message #/ }), step).toBeVisible({ timeout: 20_000 });
      await expect(callBar(a.page), step).toBeVisible();
      await expect(classicBar(a.page), step).toHaveCount(0);
      expect(a.page.url(), step).toBe(chatUrl);
      await expectCallUntouched(a, before, step);
      await waitForAudioFlow(b, a);
      await waitForAudioFlow(a, b);
      await expectCallUntouched(b, onB, `${step} (on B)`);
    }
    // After the last width settles, the call is still the one tagged before the first resize.
    await expectCallUntouched(a, before, 'after every width');
  });

  test('V8: a card joiner publishes the soundboard track once; opening the classic shell adds no <audio> element on B', async () => {
    test.setTimeout(180_000);
    await aOnFixtureWithBInRoom(CH);
    await joinFromRoomCard(a, CH);
    await waitForAudioFlow(a, b);
    await waitForAudioFlow(b, a);

    // B renders exactly one element for A's mic and one for A's soundboard track (waitForRemoteAudioElements, in
    // tagCall): before the warm-up moved above the shells, a card joiner never published the soundboard track.
    const onB = await tagCall(b, a);
    const soundboardTracks = (p: Participant) =>
      p.page.evaluate(() => {
        const lp = (window.__lkRoom as unknown as {
          localParticipant: { trackPublications: Map<string, { trackName?: string }> };
        } | null)?.localParticipant;
        return lp ? [...lp.trackPublications.values()].filter((pub) => pub.trackName === 'soundboard').length : -1;
      });
    expect(await soundboardTracks(a), "A's soundboard publications").toBe(1);

    // A opens the classic shell (its Messages screen, with the classic voice bar) and stays there while audio flows.
    // Not a channel tap: on the fixture (since 10c-1) and on the real route at phone width (since 10c-2b) a text
    // channel opens the Lounge chat, which keeps the Lounge call bar.
    await goTo(a.page, '/direct-messages');
    await expect(fixture(a.page)).toHaveCount(0, { timeout: 20_000 });
    await expect(classicBar(a.page)).toBeVisible({ timeout: 20_000 });
    await waitForAudioFlow(b, a);
    await waitForAudioFlow(a, b);
    expect(await soundboardTracks(a), "A's soundboard publications in the classic shell").toBe(1);
    await expectCallUntouched(b, onB, 'A in the classic chat (on B)');

    // And back to the Lounge.
    await a.page.goBack();
    await expect(callBar(a.page)).toBeVisible({ timeout: 20_000 });
    await waitForAudioFlow(b, a);
    expect(await soundboardTracks(a), "A's soundboard publications back in the Lounge").toBe(1);
    await expectCallUntouched(b, onB, 'A back in the Lounge (on B)');
  });

  test('V7: signing out mid-call from the account menu leaves the call', async () => {
    test.setTimeout(180_000);
    await aOnFixtureWithBInRoom(CH, { width: 820, height: 900 });
    // Signing out ends the session on purpose: requests still in flight or made on the login page get the server's
    // 401, which the browser logs (the browser's line only; the app logs nothing).
    expectedErrors = new RegExp(failedRequest(401));
    await joinFromRoomCard(a, CH);
    await expect.poll(() => roomLists(b, a), { timeout: 20_000, message: 'B lists A before the sign-out' }).toBe(true);
    await waitForAudioFlow(b, a);

    await a.page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await a.page.getByRole('menuitem', { name: 'Sign out…' }).click();
    const question = a.page.getByRole('dialog', { name: 'Sign out?' });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Sign out', exact: true }).click();

    await expect(a.page).toHaveURL(/#\/login/, { timeout: 20_000 });
    // Deterministic: the saved connection a page load would rejoin from is gone at once.
    expect(await a.page.evaluate(() => localStorage.getItem('semaphore_voice_connection')), 'no saved voice connection').toBeNull();
    await expect.poll(() => state(a), { timeout: 20_000, message: 'A left the call' }).not.toBe('connected');
    await expect.poll(() => roomLists(b, a), { timeout: 20_000, message: "B's list drops A" }).toBe(false);

    // Signing back in does not rejoin: nothing of the call was saved. A rejoin would start once the profile and
    // the LiveKit connection info are loaded (useVoiceRecovery), and would ask for a token: wait for those, then
    // for the page to settle, and check no token was asked for.
    const tokenRequests: string[] = [];
    a.page.on('request', (req) => {
      if (/\/api\/livekit\/(token|dm-token)$/.test(new URL(req.url()).pathname)) tokenRequests.push(req.url());
    });
    await loginViaApi(a.context.request, TEST_USER);
    const connectionInfo = a.page.waitForResponse((res) => new URL(res.url()).pathname === '/api/livekit/connection-info', {
      timeout: 20_000,
    });
    const profile = a.page.waitForResponse((res) => new URL(res.url()).pathname === '/api/users/profile', { timeout: 20_000 });
    await a.page.goto('/');
    await Promise.all([connectionInfo, profile]);
    // Signed in again, on the old shell's home (820 px is its mobile layout). Nothing of the previous session's
    // community is remembered, so the sidebar offers none.
    await expect(a.page.getByRole('button', { name: /^choose a community$/i })).toBeVisible({ timeout: 20_000 });
    // Settled: the network goes idle within seconds when no call starts. A started call keeps it busy, so the wait
    // is bounded and the token check below names the failure.
    await a.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await expect(a.page).not.toHaveURL(/#\/login/);
    expect(tokenRequests, 'no join was started after signing back in').toEqual([]);
    expect(await state(a)).not.toBe('connected');
    expect(await roomLists(b, a)).toBe(false);
  });
});
